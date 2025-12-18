/**
 * Copy Trade Engine
 * 
 * Listens to trade events and executes copy trades.
 * Optimized for low latency between detection and execution.
 */

import { EventEmitter } from 'events';
import { JupiterExecutor, SwapResult } from './jupiter-executor.js';
import { WalletManager } from './wallet-manager.js';
import { PositionManager } from './position-manager.js';
import { TradeFilter } from './trade-filter.js';
import type { DetectedTrade } from '../types/trade.js';
import { TradeEvents } from '../constants/events.js';

export interface CopyTradeConfig {
  /** Fixed USDC amount per copy trade */
  tradeAmountUsdc: number;
  /** Token mints to copy (empty = all tokens) */
  allowedTokens: string[];
  /** Only copy buy trades */
  copyBuysOnly: boolean;
  /** Minimum trade size to copy (in USDC) */
  minTradeUsdc: number;
}

export interface CopyTradeResult {
  /** Original trade that was copied */
  originalTrade: DetectedTrade;
  /** Copy trade result */
  copyResult: SwapResult;
  /** Time from original trade detection to copy trade sent (ms) */
  copyLatencyMs: number;
  /** Total time from original trade slot to copy sent */
  endToEndLatencyMs: number;
}

// Events emitted by CopyTradeEngine
export const CopyTradeEvents = {
  COPY_INITIATED: 'copy_initiated',
  COPY_COMPLETE: 'copy_complete',
  COPY_SKIPPED: 'copy_skipped',
  COPY_FAILED: 'copy_failed',
} as const;

export class CopyTradeEngine extends EventEmitter {
  private config: CopyTradeConfig;
  private jupiterExecutor: JupiterExecutor;
  readonly walletManager: WalletManager;
  private positionManager: PositionManager | undefined;
  private tradeFilter: TradeFilter | undefined;
  
  // Track pending copies to prevent duplicates
  private pendingCopies: Set<string> = new Set();
  
  // Statistics
  private stats = {
    tradesDetected: 0,
    tradesFiltered: 0,
    tradesRiskRejected: 0,
    copyAttempts: 0,
    copySuccesses: 0,
    copyFailures: 0,
    totalCopyLatencyMs: 0,
  };

  constructor(
    config: CopyTradeConfig,
    jupiterExecutor: JupiterExecutor,
    walletManager: WalletManager,
    positionManager?: PositionManager,
    tradeFilter?: TradeFilter
  ) {
    super();
    this.config = config;
    this.jupiterExecutor = jupiterExecutor;
    this.walletManager = walletManager;
    this.positionManager = positionManager;
    this.tradeFilter = tradeFilter;

    console.log(`[CopyTradeEngine] Initialized`);
    console.log(`  Trade amount: $${config.tradeAmountUsdc}`);
    console.log(`  Allowed tokens: ${config.allowedTokens.length > 0 ? config.allowedTokens.join(', ') : 'ALL'}`);
    console.log(`  Copy buys only: ${config.copyBuysOnly}`);
    console.log(`  Min trade size: $${config.minTradeUsdc}`);
    console.log(`  Position tracking: ${positionManager ? 'ENABLED' : 'DISABLED'}`);
    console.log(`  Trade filtering: ${tradeFilter?.getConfig().enabled ? 'ENABLED' : 'DISABLED'}`);
    console.log(`  (Target wallets managed by TradeAnalyzer)`);
  }

  /**
   * Subscribe to trade events from TradeAnalyzer
   */
  subscribe(tradeAnalyzer: EventEmitter): void {
    tradeAnalyzer.on(TradeEvents.TRADE, (trade: DetectedTrade) => {
      // Process immediately - don't block event loop
      this.processTrade(trade).catch(error => {
        console.error('[CopyTradeEngine] Error processing trade:', error);
        this.emit(CopyTradeEvents.COPY_FAILED, { trade, error });
      });
    });
    
    console.log('[CopyTradeEngine] Subscribed to trade events');
  }

  /**
   * Process a detected trade and decide whether to copy it
   */
  private async processTrade(trade: DetectedTrade): Promise<void> {
    const startTime = Date.now();
    this.stats.tradesDetected++;

    // Log all trades (already filtered by TradeAnalyzer to only tracked wallets)
    console.log(`\n[CopyTradeEngine] Trade detected from ${trade.userAddress.slice(0, 8)}...:`);
    console.log(`  Direction: ${trade.direction}`);
    console.log(`  Token: ${trade.tokenMint}`);
    console.log(`  USDC Amount: $${trade.usdcAmount.toFixed(2)}`);
    console.log(`  Signature: ${trade.signature}`);

    // Filter 1: Only copy buys (if configured)
    if (this.config.copyBuysOnly && trade.direction !== 'buy') {
      console.log(`[CopyTradeEngine] Skipping SELL trade (copy buys only)`);
      this.stats.tradesFiltered++;
      this.emit(CopyTradeEvents.COPY_SKIPPED, { trade, reason: 'sell_trade' });
      return;
    }

    // Filter 2: Token allowlist
    if (this.config.allowedTokens.length > 0 && !this.config.allowedTokens.includes(trade.tokenMint)) {
      console.log(`[CopyTradeEngine] Skipping trade - token not in allowlist: ${trade.tokenMint}`);
      this.stats.tradesFiltered++;
      this.emit(CopyTradeEvents.COPY_SKIPPED, { trade, reason: 'token_not_allowed' });
      return;
    }

    // Filter 3: Minimum trade size
    if (trade.usdcAmount < this.config.minTradeUsdc) {
      console.log(`[CopyTradeEngine] Skipping trade - below minimum size: $${trade.usdcAmount}`);
      this.stats.tradesFiltered++;
      this.emit(CopyTradeEvents.COPY_SKIPPED, { trade, reason: 'below_minimum' });
      return;
    }

    // Filter 4: Prevent duplicate copies
    if (this.pendingCopies.has(trade.signature)) {
      console.log(`[CopyTradeEngine] Skipping trade - already copying`);
      this.stats.tradesFiltered++;
      this.emit(CopyTradeEvents.COPY_SKIPPED, { trade, reason: 'already_copying' });
      return;
    }

    // Filter 5: Smart trade filters (scam detection, liquidity, etc.)
    if (this.tradeFilter) {
      const filterResult = await this.tradeFilter.shouldCopyTrade(trade, this.config.tradeAmountUsdc);
      
      if (!filterResult.allowed) {
        console.log(`[CopyTradeEngine] 🚫 Trade filtered: ${filterResult.reason}`);
        this.stats.tradesFiltered++;
        this.emit(CopyTradeEvents.COPY_SKIPPED, { 
          trade, 
          reason: 'smart_filter',
          details: filterResult.reason,
          checks: filterResult.checks,
        });
        return;
      }
    }

    // Filter 6: Position risk limits (if position manager enabled)
    if (this.positionManager) {
      const usdcBalance = await this.walletManager.getUsdcBalance();
      const riskCheck = this.positionManager.canTrade(
        trade.tokenMint,
        trade.direction,
        this.config.tradeAmountUsdc,
        usdcBalance
      );

      if (!riskCheck.allowed) {
        console.log(`[CopyTradeEngine] ⛔ Risk limit reached: ${riskCheck.reason}`);
        this.stats.tradesRiskRejected++;
        this.emit(CopyTradeEvents.COPY_SKIPPED, { 
          trade, 
          reason: 'risk_limit',
          details: riskCheck.reason,
          limits: riskCheck.limits,
        });
        return;
      }
    }

    // Execute copy trade!
    console.log(`\n[CopyTradeEngine] === COPYING TRADE ===`);
    console.log(`  Original: ${trade.direction} ${trade.tokenMint.slice(0, 8)}... for $${trade.usdcAmount.toFixed(2)}`);
    const copyDirectionLabel = trade.direction === 'buy' ? 'BUY' : 'SELL';
    console.log(`  Copy: ${copyDirectionLabel} ${trade.tokenMint.slice(0, 8)}... for $${this.config.tradeAmountUsdc}`);

    this.pendingCopies.add(trade.signature);
    this.stats.copyAttempts++;
    this.emit(CopyTradeEvents.COPY_INITIATED, { trade });

    try {
      // Execute the copy trade
      let copyResult: SwapResult;

      if (trade.direction === 'buy') {
        // Mirror buy with fixed USDC size
        copyResult = await this.jupiterExecutor.buyToken(
          trade.tokenMint,
          this.config.tradeAmountUsdc
        );
      } else {
        // Mirror sell with fixed USDC size (ExactOut USDC)
        copyResult = await this.jupiterExecutor.sellTokenForUsdcAmount(
          trade.tokenMint,
          this.config.tradeAmountUsdc
        );
      }

      const copyLatencyMs = Date.now() - startTime;
      const endToEndLatencyMs = Date.now() - trade.detectedAt.getTime();

      this.stats.totalCopyLatencyMs += copyLatencyMs;

      if (copyResult.error) {
        this.stats.copyFailures++;
        console.error(`[CopyTradeEngine] Copy trade FAILED: ${copyResult.error}`);
        this.emit(CopyTradeEvents.COPY_FAILED, { trade, error: copyResult.error });
      } else {
        this.stats.copySuccesses++;
        console.log(`[CopyTradeEngine] Copy trade SENT!`);
        console.log(`  Signature: ${copyResult.signature}`);
        console.log(`  Copy latency: ${copyLatencyMs}ms`);
        console.log(`  End-to-end latency: ${endToEndLatencyMs}ms`);

        // Record position (if position manager enabled)
        if (this.positionManager) {
          const tokenAmount = BigInt(copyResult.outAmount);
          const usdcAmount = this.config.tradeAmountUsdc;
          const pricePerToken = usdcAmount / Number(tokenAmount);

          if (trade.direction === 'buy') {
            this.positionManager.recordBuy(
              trade.tokenMint,
              tokenAmount,
              usdcAmount,
              pricePerToken,
              copyResult.signature
            );
          } else {
            this.positionManager.recordSell(
              trade.tokenMint,
              tokenAmount,
              usdcAmount,
              copyResult.signature
            );
          }
        }

        const result: CopyTradeResult = {
          originalTrade: trade,
          copyResult,
          copyLatencyMs,
          endToEndLatencyMs,
        };

        this.emit(CopyTradeEvents.COPY_COMPLETE, result);
      }
    } catch (error) {
      this.stats.copyFailures++;
      console.error(`[CopyTradeEngine] Copy trade error:`, error);
      this.emit(CopyTradeEvents.COPY_FAILED, { trade, error });
    } finally {
      this.pendingCopies.delete(trade.signature);
    }
  }

  /**
   * Get current statistics
   */
  getStats() {
    const avgLatency = this.stats.copyAttempts > 0 
      ? this.stats.totalCopyLatencyMs / this.stats.copyAttempts 
      : 0;

    return {
      ...this.stats,
      averageCopyLatencyMs: avgLatency,
      successRate: this.stats.copyAttempts > 0 
        ? (this.stats.copySuccesses / this.stats.copyAttempts * 100).toFixed(1) + '%'
        : 'N/A',
    };
  }

  /**
   * Print statistics
   */
  printStats(): void {
    const stats = this.getStats();
    console.log('\n=== Copy Trade Statistics ===');
    console.log(`Trades detected: ${stats.tradesDetected}`);
    console.log(`Trades filtered: ${stats.tradesFiltered}`);
    console.log(`Trades risk-rejected: ${stats.tradesRiskRejected}`);
    console.log(`Copy attempts: ${stats.copyAttempts}`);
    console.log(`Copy successes: ${stats.copySuccesses}`);
    console.log(`Copy failures: ${stats.copyFailures}`);
    console.log(`Success rate: ${stats.successRate}`);
    console.log(`Average copy latency: ${stats.averageCopyLatencyMs.toFixed(0)}ms`);
    console.log('=============================\n');
  }

  /**
   * Get position manager (if enabled)
   */
  getPositionManager(): PositionManager | undefined {
    return this.positionManager;
  }
}

