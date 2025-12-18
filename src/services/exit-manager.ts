/**
 * Exit Manager
 * 
 * Automatically exits positions based on take profit, stop loss, and time-based rules.
 * Runs in background checking positions periodically.
 */

import { EventEmitter } from 'events';
import { PositionManager, Position } from './position-manager.js';
import { JupiterExecutor } from './jupiter-executor.js';

export interface ExitStrategy {
  /** Take profit levels */
  takeProfitTargets: Array<{
    profitPercent: number;  // e.g., 100 = 2x (100% profit)
    sellPercent: number;    // e.g., 50 = sell 50% of position
  }>;
  
  /** Stop loss percent (negative) */
  stopLossPercent: number;  // e.g., -30 = sell all at -30%
  
  /** Max hold time in hours */
  maxHoldTimeHours?: number;  // e.g., 24 = auto-sell after 24h
  
  /** Trailing stop (advanced) */
  trailingStopPercent?: number;  // e.g., 20 = lock in gains if price drops 20% from high
  trailingActivationPercent?: number; // e.g., 50 = start trailing after +50% profit
}

export interface ExitEvent {
  position: Position;
  exitType: 'take_profit' | 'stop_loss' | 'time_limit' | 'trailing_stop';
  sellPercent: number;
  currentPrice: number;
  profitPercent: number;
  reason: string;
}

export const ExitEvents = {
  EXIT_TRIGGERED: 'exit_triggered',
  EXIT_EXECUTED: 'exit_executed',
  EXIT_FAILED: 'exit_failed',
} as const;

// Track which take profits have been hit for each position
interface PositionExitState {
  tpHit: Set<number>;  // Track which TP levels executed
  highWaterMark: number;  // Highest price seen (for trailing stops)
}

export class ExitManager extends EventEmitter {
  private strategy: ExitStrategy;
  private positionManager: PositionManager;
  private jupiterExecutor: JupiterExecutor;
  
  // Track exit state per position
  private exitStates: Map<string, PositionExitState> = new Map();
  
  // Background checker
  private checkInterval: NodeJS.Timeout | null = null;
  private checkIntervalSeconds: number;
  
  // Statistics
  private stats = {
    checksPerformed: 0,
    exitsTriggered: 0,
    takeProfitsHit: 0,
    stopLossesHit: 0,
    timeLimitsHit: 0,
    trailingStopsHit: 0,
    exitsFailed: 0,
  };

  constructor(
    strategy: ExitStrategy,
    positionManager: PositionManager,
    jupiterExecutor: JupiterExecutor,
    checkIntervalSeconds = 30
  ) {
    super();
    this.strategy = strategy;
    this.positionManager = positionManager;
    this.jupiterExecutor = jupiterExecutor;
    this.checkIntervalSeconds = checkIntervalSeconds;
    
    console.log('[ExitManager] Initialized with strategy:');
    console.log(`  Take profits: ${strategy.takeProfitTargets.map(tp => `${tp.profitPercent}%:${tp.sellPercent}%`).join(', ')}`);
    console.log(`  Stop loss: ${strategy.stopLossPercent}%`);
    if (strategy.maxHoldTimeHours) {
      console.log(`  Max hold time: ${strategy.maxHoldTimeHours}h`);
    }
    if (strategy.trailingStopPercent) {
      console.log(`  Trailing stop: ${strategy.trailingStopPercent}% (activate at +${strategy.trailingActivationPercent}%)`);
    }
    console.log(`  Check interval: ${checkIntervalSeconds}s`);
  }

  /**
   * Start background position checking
   */
  start(): void {
    if (this.checkInterval) {
      console.log('[ExitManager] Already running');
      return;
    }

    this.checkInterval = setInterval(() => {
      this.checkAllPositions().catch(error => {
        console.error('[ExitManager] Error checking positions:', error);
      });
    }, this.checkIntervalSeconds * 1000);

    console.log(`[ExitManager] Started (checking every ${this.checkIntervalSeconds}s)`);
    
    // Initial check
    this.checkAllPositions().catch(() => {});
  }

  /**
   * Stop background checking
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      console.log('[ExitManager] Stopped');
    }
  }

  /**
   * Check all positions for exit conditions
   */
  private async checkAllPositions(): Promise<void> {
    const positions = this.positionManager.getPositions();
    
    if (positions.length === 0) {
      return;
    }

    this.stats.checksPerformed++;

    // Fetch current prices for all positions
    const prices = await this.fetchPrices(positions.map(p => p.tokenMint));

    for (const position of positions) {
      const currentPrice = prices.get(position.tokenMint);
      if (!currentPrice || currentPrice === 0) {
        continue; // Skip if no price data
      }

      // Get or create exit state
      let exitState = this.exitStates.get(position.tokenMint);
      if (!exitState) {
        exitState = {
          tpHit: new Set(),
          highWaterMark: currentPrice,
        };
        this.exitStates.set(position.tokenMint, exitState);
      }

      // Update high water mark
      if (currentPrice > exitState.highWaterMark) {
        exitState.highWaterMark = currentPrice;
      }

      // Calculate profit/loss
      const profitPercent = ((currentPrice / position.entryPrice) - 1) * 100;

      // Check exit conditions
      await this.checkTakeProfits(position, currentPrice, profitPercent, exitState);
      await this.checkStopLoss(position, currentPrice, profitPercent);
      await this.checkTimeLimit(position, currentPrice, profitPercent);
      await this.checkTrailingStop(position, currentPrice, profitPercent, exitState);
    }
  }

  /**
   * Check take profit targets
   */
  private async checkTakeProfits(
    position: Position,
    currentPrice: number,
    profitPercent: number,
    exitState: PositionExitState
  ): Promise<void> {
    for (const tp of this.strategy.takeProfitTargets) {
      // Check if this TP level hit and not yet executed
      if (profitPercent >= tp.profitPercent && !exitState.tpHit.has(tp.profitPercent)) {
        console.log(`\n[ExitManager] 💰 Take profit ${tp.profitPercent}% hit for ${position.symbol || position.tokenMint.slice(0, 8)}...`);
        console.log(`  Current: ${profitPercent.toFixed(2)}% profit`);
        console.log(`  Action: Sell ${tp.sellPercent}% of position`);

        await this.executeSell(
          position,
          currentPrice,
          profitPercent,
          tp.sellPercent,
          'take_profit',
          `TP ${tp.profitPercent}% hit`
        );

        // Mark this TP as hit
        exitState.tpHit.add(tp.profitPercent);
        this.stats.takeProfitsHit++;
      }
    }
  }

  /**
   * Check stop loss
   */
  private async checkStopLoss(
    position: Position,
    currentPrice: number,
    profitPercent: number
  ): Promise<void> {
    if (profitPercent <= this.strategy.stopLossPercent) {
      console.log(`\n[ExitManager] 🛑 Stop loss hit for ${position.symbol || position.tokenMint.slice(0, 8)}...`);
      console.log(`  Current: ${profitPercent.toFixed(2)}% (threshold: ${this.strategy.stopLossPercent}%)`);
      console.log(`  Action: Sell 100% of position`);

      await this.executeSell(
        position,
        currentPrice,
        profitPercent,
        100,
        'stop_loss',
        `Stop loss ${this.strategy.stopLossPercent}% hit`
      );

      this.stats.stopLossesHit++;
    }
  }

  /**
   * Check time-based exit
   */
  private async checkTimeLimit(
    position: Position,
    currentPrice: number,
    profitPercent: number
  ): Promise<void> {
    if (!this.strategy.maxHoldTimeHours) {
      return;
    }

    const hoursHeld = (Date.now() - position.entryTime.getTime()) / 3600000;
    
    if (hoursHeld >= this.strategy.maxHoldTimeHours) {
      console.log(`\n[ExitManager] ⏰ Time limit reached for ${position.symbol || position.tokenMint.slice(0, 8)}...`);
      console.log(`  Held: ${hoursHeld.toFixed(1)}h (max: ${this.strategy.maxHoldTimeHours}h)`);
      console.log(`  Current P&L: ${profitPercent.toFixed(2)}%`);
      console.log(`  Action: Sell 100% of position`);

      await this.executeSell(
        position,
        currentPrice,
        profitPercent,
        100,
        'time_limit',
        `Max hold time ${this.strategy.maxHoldTimeHours}h reached`
      );

      this.stats.timeLimitsHit++;
    }
  }

  /**
   * Check trailing stop
   */
  private async checkTrailingStop(
    position: Position,
    currentPrice: number,
    profitPercent: number,
    exitState: PositionExitState
  ): Promise<void> {
    if (!this.strategy.trailingStopPercent || !this.strategy.trailingActivationPercent) {
      return;
    }

    // Only activate trailing stop after reaching activation threshold
    if (profitPercent < this.strategy.trailingActivationPercent) {
      return;
    }

    // Calculate drawdown from high water mark
    const drawdownPercent = ((exitState.highWaterMark - currentPrice) / exitState.highWaterMark) * 100;

    if (drawdownPercent >= this.strategy.trailingStopPercent) {
      console.log(`\n[ExitManager] 📉 Trailing stop hit for ${position.symbol || position.tokenMint.slice(0, 8)}...`);
      console.log(`  High: $${exitState.highWaterMark.toFixed(6)}`);
      console.log(`  Current: $${currentPrice.toFixed(6)} (-${drawdownPercent.toFixed(2)}%)`);
      console.log(`  Profit: ${profitPercent.toFixed(2)}%`);
      console.log(`  Action: Sell 100% of position`);

      await this.executeSell(
        position,
        currentPrice,
        profitPercent,
        100,
        'trailing_stop',
        `Trailing stop ${this.strategy.trailingStopPercent}% from high`
      );

      this.stats.trailingStopsHit++;
    }
  }

  /**
   * Execute sell order
   */
  private async executeSell(
    position: Position,
    currentPrice: number,
    profitPercent: number,
    sellPercent: number,
    exitType: ExitEvent['exitType'],
    reason: string
  ): Promise<void> {
    this.stats.exitsTriggered++;

    const exitEvent: ExitEvent = {
      position,
      exitType,
      sellPercent,
      currentPrice,
      profitPercent,
      reason,
    };

    this.emit(ExitEvents.EXIT_TRIGGERED, exitEvent);

    try {
      // Calculate how many tokens to sell
      const tokensToSell = (position.amount * BigInt(sellPercent)) / 100n;
      
      // Execute sell via JupiterExecutor
      const result = await this.jupiterExecutor.sellToken(
        position.tokenMint,
        tokensToSell.toString()
      );

      if (result.error) {
        throw new Error(result.error);
      }

      console.log(`[ExitManager] ✅ Exit executed: ${result.signature}`);
      
      // Position manager will be updated by CopyTradeEngine if it's listening
      // Or we could update it directly here
      
      this.emit(ExitEvents.EXIT_EXECUTED, {
        ...exitEvent,
        signature: result.signature,
      });

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.error(`[ExitManager] ❌ Exit failed: ${errorMsg}`);
      this.stats.exitsFailed++;
      this.emit(ExitEvents.EXIT_FAILED, {
        ...exitEvent,
        error: errorMsg,
      });
    }
  }

  /**
   * Fetch current prices for tokens
   * Uses Jupiter Price API for batch fetching
   */
  private async fetchPrices(tokenMints: string[]): Promise<Map<string, number>> {
    const prices = new Map<string, number>();

    if (tokenMints.length === 0) {
      return prices;
    }

    try {
      // Jupiter Price API v4
      const ids = tokenMints.join(',');
      const response = await fetch(`https://price.jup.ag/v4/price?ids=${ids}`);
      
      if (!response.ok) {
        throw new Error(`Jupiter Price API error: ${response.status}`);
      }

      const data = await response.json() as any;
      
      for (const mint of tokenMints) {
        const priceData = data.data?.[mint];
        if (priceData && priceData.price) {
          prices.set(mint, priceData.price);
        }
      }

    } catch (error) {
      console.warn('[ExitManager] Price fetch failed:', error);
      // Return empty map, positions will be skipped
    }

    return prices;
  }

  /**
   * Update exit strategy
   */
  updateStrategy(newStrategy: Partial<ExitStrategy>): void {
    this.strategy = { ...this.strategy, ...newStrategy };
    console.log('[ExitManager] Strategy updated');
  }

  /**
   * Get current strategy
   */
  getStrategy(): ExitStrategy {
    return { ...this.strategy };
  }

  /**
   * Get statistics
   */
  getStats() {
    return { ...this.stats };
  }

  /**
   * Print statistics
   */
  printStats(): void {
    console.log('\n=== Exit Manager Statistics ===');
    console.log(`Checks performed: ${this.stats.checksPerformed}`);
    console.log(`Exits triggered: ${this.stats.exitsTriggered}`);
    console.log(`  Take profits: ${this.stats.takeProfitsHit}`);
    console.log(`  Stop losses: ${this.stats.stopLossesHit}`);
    console.log(`  Time limits: ${this.stats.timeLimitsHit}`);
    console.log(`  Trailing stops: ${this.stats.trailingStopsHit}`);
    console.log(`Exits failed: ${this.stats.exitsFailed}`);
    console.log('================================\n');
  }
}

