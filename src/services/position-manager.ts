/**
 * Position Manager
 * 
 * Tracks open positions and enforces risk limits.
 * Critical for preventing over-exposure and managing portfolio risk.
 */

import { Connection } from '@solana/web3.js';
import { EventEmitter } from 'events';

export interface Position {
  /** Token mint address */
  tokenMint: string;
  /** Token symbol (for display) */
  symbol?: string;
  /** Token amount held (in smallest units) */
  amount: bigint;
  /** Entry price (USDC per token) */
  entryPrice: number;
  /** Total USDC spent to build position */
  totalCostUsdc: number;
  /** When position was opened */
  entryTime: Date;
  /** Trade signatures that built this position */
  trades: string[];
  /** Number of buys */
  buyCount: number;
  /** Number of sells */
  sellCount: number;
}

export interface PositionSnapshot extends Position {
  /** Current price (USDC per token) */
  currentPrice: number;
  /** Current value in USDC */
  currentValueUsdc: number;
  /** Unrealized P&L in USDC */
  unrealizedPnlUsdc: number;
  /** Unrealized P&L as percentage */
  unrealizedPnlPercent: number;
  /** How long position has been held (seconds) */
  holdTimeSeconds: number;
}

export interface RiskLimits {
  /** Max USDC cost per single token position */
  maxPositionSizeUsdc: number;
  /** Max total USDC exposure across all positions */
  maxTotalExposureUsdc: number;
  /** Max number of different tokens held */
  maxOpenPositions: number;
  /** Min USDC balance to keep (don't trade if below this) */
  minUsdcReserve: number;
}

export interface TradeCheckResult {
  allowed: boolean;
  reason?: string;
  limits?: {
    currentPositionSize?: number;
    maxPositionSize: number;
    currentExposure?: number;
    maxExposure: number;
    currentPositions: number;
    maxPositions: number;
  };
}

export const PositionEvents = {
  POSITION_OPENED: 'position_opened',
  POSITION_UPDATED: 'position_updated',
  POSITION_CLOSED: 'position_closed',
  LIMIT_WARNING: 'limit_warning',
} as const;

export class PositionManager extends EventEmitter {
  private positions: Map<string, Position> = new Map();
  private connection: Connection; // Used for future price fetching
  private limits: RiskLimits;

  constructor(connection: Connection, limits: RiskLimits) {
    super();
    this.connection = connection; // Will be used for price fetching in getTokenPrice()
    this.limits = limits;
    
    console.log('[PositionManager] Initialized with limits:');
    console.log(`  Max position size: $${limits.maxPositionSizeUsdc}`);
    console.log(`  Max total exposure: $${limits.maxTotalExposureUsdc}`);
    console.log(`  Max open positions: ${limits.maxOpenPositions}`);
    console.log(`  Min USDC reserve: $${limits.minUsdcReserve}`);
  }

  /**
   * Check if a trade is allowed given current positions and risk limits
   */
  canTrade(
    tokenMint: string,
    direction: 'buy' | 'sell',
    amountUsdc: number,
    currentUsdcBalance: number
  ): TradeCheckResult {
    const position = this.positions.get(tokenMint);
    const totalExposure = this.getTotalExposure();

    // BUY checks
    if (direction === 'buy') {
      // Check 1: USDC reserve
      if (currentUsdcBalance - amountUsdc < this.limits.minUsdcReserve) {
        return {
          allowed: false,
          reason: `Would leave USDC below minimum reserve ($${this.limits.minUsdcReserve})`,
        };
      }

      // Check 2: Per-position size limit
      const currentPositionSize = position ? position.totalCostUsdc : 0;
      const newPositionSize = currentPositionSize + amountUsdc;
      if (newPositionSize > this.limits.maxPositionSizeUsdc) {
        return {
          allowed: false,
          reason: `Position size limit reached: $${newPositionSize.toFixed(2)} > $${this.limits.maxPositionSizeUsdc}`,
          limits: {
            currentPositionSize,
            maxPositionSize: this.limits.maxPositionSizeUsdc,
            currentExposure: totalExposure,
            maxExposure: this.limits.maxTotalExposureUsdc,
            currentPositions: this.positions.size,
            maxPositions: this.limits.maxOpenPositions,
          },
        };
      }

      // Check 3: Total exposure limit
      const newTotalExposure = totalExposure + amountUsdc;
      if (newTotalExposure > this.limits.maxTotalExposureUsdc) {
        return {
          allowed: false,
          reason: `Total exposure limit reached: $${newTotalExposure.toFixed(2)} > $${this.limits.maxTotalExposureUsdc}`,
          limits: {
            currentPositionSize,
            maxPositionSize: this.limits.maxPositionSizeUsdc,
            currentExposure: totalExposure,
            maxExposure: this.limits.maxTotalExposureUsdc,
            currentPositions: this.positions.size,
            maxPositions: this.limits.maxOpenPositions,
          },
        };
      }

      // Check 4: Max positions limit (only if opening new position)
      if (!position && this.positions.size >= this.limits.maxOpenPositions) {
        return {
          allowed: false,
          reason: `Max open positions reached: ${this.positions.size}/${this.limits.maxOpenPositions}`,
          limits: {
            currentPositionSize: 0,
            maxPositionSize: this.limits.maxPositionSizeUsdc,
            currentExposure: totalExposure,
            maxExposure: this.limits.maxTotalExposureUsdc,
            currentPositions: this.positions.size,
            maxPositions: this.limits.maxOpenPositions,
          },
        };
      }

      // Check 5: Warn if approaching limits (80%)
      if (newPositionSize > this.limits.maxPositionSizeUsdc * 0.8) {
        this.emit(PositionEvents.LIMIT_WARNING, {
          type: 'position_size',
          token: tokenMint,
          current: newPositionSize,
          max: this.limits.maxPositionSizeUsdc,
          percent: (newPositionSize / this.limits.maxPositionSizeUsdc) * 100,
        });
      }

      if (newTotalExposure > this.limits.maxTotalExposureUsdc * 0.8) {
        this.emit(PositionEvents.LIMIT_WARNING, {
          type: 'total_exposure',
          current: newTotalExposure,
          max: this.limits.maxTotalExposureUsdc,
          percent: (newTotalExposure / this.limits.maxTotalExposureUsdc) * 100,
        });
      }
    }

    // SELL checks
    if (direction === 'sell') {
      // Can only sell if we have a position
      if (!position || position.amount === 0n) {
        return {
          allowed: false,
          reason: 'No position to sell',
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Record a buy trade
   */
  recordBuy(
    tokenMint: string,
    tokenAmount: bigint,
    usdcSpent: number,
    pricePerToken: number,
    signature: string,
    symbol?: string
  ): void {
    const existing = this.positions.get(tokenMint);

    if (existing) {
      // Update existing position
      const newAmount = existing.amount + tokenAmount;
      const newCost = existing.totalCostUsdc + usdcSpent;
      
      existing.amount = newAmount;
      existing.totalCostUsdc = newCost;
      existing.entryPrice = newCost / Number(newAmount); // Update average entry price
      existing.trades.push(signature);
      existing.buyCount++;

      console.log(`[PositionManager] Updated position for ${symbol || tokenMint.slice(0, 8)}...:`);
      console.log(`  Amount: ${existing.amount}`);
      console.log(`  Avg entry: $${existing.entryPrice.toFixed(6)}`);
      console.log(`  Total cost: $${existing.totalCostUsdc.toFixed(2)}`);
      console.log(`  Trades: ${existing.trades.length}`);

      this.emit(PositionEvents.POSITION_UPDATED, existing);
    } else {
      // New position
      const position: Position = {
        tokenMint,
        symbol,
        amount: tokenAmount,
        entryPrice: pricePerToken,
        totalCostUsdc: usdcSpent,
        entryTime: new Date(),
        trades: [signature],
        buyCount: 1,
        sellCount: 0,
      };

      this.positions.set(tokenMint, position);

      console.log(`[PositionManager] ✨ Opened new position for ${symbol || tokenMint.slice(0, 8)}...:`);
      console.log(`  Amount: ${position.amount}`);
      console.log(`  Entry price: $${position.entryPrice.toFixed(6)}`);
      console.log(`  Cost: $${position.totalCostUsdc.toFixed(2)}`);
      console.log(`  Open positions: ${this.positions.size}/${this.limits.maxOpenPositions}`);

      this.emit(PositionEvents.POSITION_OPENED, position);
    }
  }

  /**
   * Record a sell trade
   */
  recordSell(
    tokenMint: string,
    tokenAmount: bigint,
    usdcReceived: number,
    signature: string
  ): { realizedPnlUsdc: number; realizedPnlPercent: number } | null {
    const position = this.positions.get(tokenMint);
    if (!position) {
      console.warn(`[PositionManager] Cannot record sell - no position for ${tokenMint}`);
      return null;
    }

    const newAmount = position.amount - tokenAmount;
    
    if (newAmount < 0n) {
      console.warn(`[PositionManager] Sell amount exceeds position size`);
      return null;
    }

    // Calculate realized P&L for this partial/full exit
    const sellPercent = Number(tokenAmount) / Number(position.amount);
    const costBasis = position.totalCostUsdc * sellPercent;
    const realizedPnlUsdc = usdcReceived - costBasis;
    const realizedPnlPercent = (realizedPnlUsdc / costBasis) * 100;

    position.amount = newAmount;
    position.totalCostUsdc = position.totalCostUsdc * (1 - sellPercent);
    position.trades.push(signature);
    position.sellCount++;

    console.log(`[PositionManager] Recorded sell for ${position.symbol || tokenMint.slice(0, 8)}...:`);
    console.log(`  Sold: ${sellPercent.toFixed(1)}% of position`);
    console.log(`  Realized P&L: $${realizedPnlUsdc.toFixed(2)} (${realizedPnlPercent.toFixed(2)}%)`);
    console.log(`  Remaining: ${position.amount}`);

    // Close position if fully sold
    if (newAmount === 0n) {
      console.log(`[PositionManager] 🔒 Position closed`);
      this.positions.delete(tokenMint);
      this.emit(PositionEvents.POSITION_CLOSED, {
        ...position,
        realizedPnlUsdc,
        realizedPnlPercent,
      });
    } else {
      this.emit(PositionEvents.POSITION_UPDATED, position);
    }

    return { realizedPnlUsdc, realizedPnlPercent };
  }

  /**
   * Get all current positions
   */
  getPositions(): Position[] {
    return Array.from(this.positions.values());
  }

  /**
   * Get position for a specific token
   */
  getPosition(tokenMint: string): Position | undefined {
    return this.positions.get(tokenMint);
  }

  /**
   * Get total USDC exposure (sum of all position costs)
   */
  getTotalExposure(): number {
    return Array.from(this.positions.values())
      .reduce((sum, pos) => sum + pos.totalCostUsdc, 0);
  }

  /**
   * Get total current value of all positions (requires price fetching)
   */
  async getTotalValue(): Promise<number> {
    const snapshots = await this.getPositionSnapshots();
    return snapshots.reduce((sum, snap) => sum + snap.currentValueUsdc, 0);
  }

  /**
   * Get position snapshots with current prices and P&L
   */
  async getPositionSnapshots(): Promise<PositionSnapshot[]> {
    const snapshots: PositionSnapshot[] = [];

    for (const position of this.positions.values()) {
      try {
        // TODO: Implement price fetching (could use Jupiter API or pool data)
        const currentPrice = await this.getTokenPrice(position.tokenMint);
        const currentValueUsdc = Number(position.amount) * currentPrice;
        const unrealizedPnlUsdc = currentValueUsdc - position.totalCostUsdc;
        const unrealizedPnlPercent = (unrealizedPnlUsdc / position.totalCostUsdc) * 100;
        const holdTimeSeconds = Math.floor((Date.now() - position.entryTime.getTime()) / 1000);

        snapshots.push({
          ...position,
          currentPrice,
          currentValueUsdc,
          unrealizedPnlUsdc,
          unrealizedPnlPercent,
          holdTimeSeconds,
        });
      } catch (error) {
        console.warn(`[PositionManager] Failed to get price for ${position.tokenMint}:`, error);
      }
    }

    return snapshots;
  }

  /**
   * Get current price of a token (placeholder - needs implementation)
   */
  private async getTokenPrice(tokenMint: string): Promise<number> {
    // TODO: Implement price fetching using this.connection
    // Options:
    // 1. Jupiter Price API: https://price.jup.ag/v4/price?ids=<tokenMint>
    // 2. Pool data from Raydium/Orca using this.connection.getAccountInfo()
    // 3. Cache prices from recent trades
    
    // Suppress unused variable warning - connection will be used when implementing price fetch
    void this.connection;
    
    // For now, return entry price (no P&L calculation)
    const position = this.positions.get(tokenMint);
    return position ? position.entryPrice : 0;
  }

  /**
   * Print current positions
   */
  async printPositions(): Promise<void> {
    const positions = this.getPositions();
    
    if (positions.length === 0) {
      console.log('\n[PositionManager] No open positions\n');
      return;
    }

    console.log('\n=== Open Positions ===');
    console.log(`Total positions: ${positions.length}`);
    console.log(`Total exposure: $${this.getTotalExposure().toFixed(2)}`);
    console.log('');

    const snapshots = await this.getPositionSnapshots();
    
    for (const snap of snapshots) {
      const symbol = snap.symbol || snap.tokenMint.slice(0, 8) + '...';
      const pnlColor = snap.unrealizedPnlUsdc >= 0 ? '🟢' : '🔴';
      const holdTime = this.formatHoldTime(snap.holdTimeSeconds);
      
      console.log(`${pnlColor} ${symbol}`);
      console.log(`  Amount: ${snap.amount.toString()}`);
      console.log(`  Entry: $${snap.entryPrice.toFixed(6)} | Current: $${snap.currentPrice.toFixed(6)}`);
      console.log(`  Cost: $${snap.totalCostUsdc.toFixed(2)} | Value: $${snap.currentValueUsdc.toFixed(2)}`);
      console.log(`  P&L: $${snap.unrealizedPnlUsdc.toFixed(2)} (${snap.unrealizedPnlPercent.toFixed(2)}%)`);
      console.log(`  Hold time: ${holdTime}`);
      console.log(`  Trades: ${snap.buyCount} buys, ${snap.sellCount} sells`);
      console.log('');
    }

    const totalValue = snapshots.reduce((sum, s) => sum + s.currentValueUsdc, 0);
    const totalPnl = snapshots.reduce((sum, s) => sum + s.unrealizedPnlUsdc, 0);
    const totalPnlPercent = (totalPnl / this.getTotalExposure()) * 100;

    console.log('=== Portfolio Summary ===');
    console.log(`Total cost: $${this.getTotalExposure().toFixed(2)}`);
    console.log(`Total value: $${totalValue.toFixed(2)}`);
    console.log(`Total P&L: $${totalPnl.toFixed(2)} (${totalPnlPercent.toFixed(2)}%)`);
    console.log('========================\n');
  }

  /**
   * Update risk limits
   */
  updateLimits(newLimits: Partial<RiskLimits>): void {
    this.limits = { ...this.limits, ...newLimits };
    console.log('[PositionManager] Risk limits updated');
  }

  /**
   * Get current risk limits
   */
  getLimits(): RiskLimits {
    return { ...this.limits };
  }

  /**
   * Format hold time in human-readable format
   */
  private formatHoldTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }
}

