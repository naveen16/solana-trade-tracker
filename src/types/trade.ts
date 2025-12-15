/**
 * Trade-related type definitions
 */

/**
 * Trade direction
 */
export type TradeDirection = 'buy' | 'sell';

/**
 * Aggregator that routed the trade
 */
export type Aggregator = 'okx' | 'dflow' | 'unknown';

/**
 * Detected trade from a transaction
 */
export interface DetectedTrade {
  /** Transaction signature */
  signature: string;
  /** Slot number */
  slot: number;
  /** Trade direction (buy = USDC → Token, sell = Token → USDC) */
  direction: TradeDirection;
  /** Token mint address being traded */
  tokenMint: string;
  /** Trade size in USDC (as a number, 6 decimals) */
  usdcAmount: number;
  /** Token amount (raw, depends on token decimals) */
  tokenAmount: bigint;
  /** User wallet address that made the trade */
  userAddress: string;
  /** Aggregator that routed the trade */
  aggregator: Aggregator;
  /** Timestamp when trade was detected */
  detectedAt: Date;
}

/**
 * Trade notification sent to subscribers
 */
export interface TradeNotification {
  /** User address being tracked */
  userAddress: string;
  /** The detected trade */
  trade: DetectedTrade;
}
