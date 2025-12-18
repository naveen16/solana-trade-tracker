/**
 * Trade Filter
 * 
 * Filters out potentially bad trades (scams, low liquidity, pumped tokens, etc.)
 * Uses a cached/hybrid approach to minimize latency impact.
 */

import { Connection } from '@solana/web3.js';
import type { DetectedTrade } from '../types/trade.js';

export interface FilterConfig {
  /** Enable filtering */
  enabled: boolean;
  /** Minimum pool liquidity in USDC */
  minLiquidityUsdc: number;
  /** Maximum price impact for our trade size (percent) */
  maxPriceImpactPercent: number;
  /** Minimum token age in seconds */
  minTokenAgeSeconds: number;
  /** Minimum 24h volume in USDC */
  min24hVolumeUsdc: number;
  /** Maximum price increase in last 5 minutes (percent) */
  maxRecentPumpPercent: number;
  /** Tokens that bypass all filters */
  whitelist: string[];
}

export interface FilterResult {
  allowed: boolean;
  reason?: string;
  checks?: {
    liquidity?: { value: number; passed: boolean };
    priceImpact?: { value: number; passed: boolean };
    tokenAge?: { value: number; passed: boolean };
    volume24h?: { value: number; passed: boolean };
    recentPump?: { value: number; passed: boolean };
  };
}

interface TokenMetadata {
  mint: string;
  liquidity: number;
  volume24h: number;
  tokenAge: number;
  lastPriceCheck: number;
  priceHistory: Array<{ price: number; timestamp: number }>;
  lastUpdated: number;
}

// Cache TTL in milliseconds
const METADATA_CACHE_TTL = 60_000; // 60 seconds
const PRICE_HISTORY_WINDOW = 300_000; // 5 minutes

export class TradeFilter {
  private config: FilterConfig;
  private connection: Connection;  // Reserved for future on-chain checks
  
  // Token metadata cache
  private metadataCache: Map<string, TokenMetadata> = new Map();
  
  // Background refresh interval
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(connection: Connection, config: FilterConfig) {
    this.connection = connection;  // Will be used for on-chain token age checks
    this.config = config;
    
    // Suppress unused warning - connection will be used for future on-chain checks
    void this.connection;
    
    if (config.enabled) {
      console.log('[TradeFilter] Initialized with limits:');
      console.log(`  Min liquidity: $${config.minLiquidityUsdc.toLocaleString()}`);
      console.log(`  Max price impact: ${config.maxPriceImpactPercent}%`);
      console.log(`  Min token age: ${config.minTokenAgeSeconds / 3600}h`);
      console.log(`  Min 24h volume: $${config.min24hVolumeUsdc.toLocaleString()}`);
      console.log(`  Max recent pump: ${config.maxRecentPumpPercent}%`);
      console.log(`  Whitelist: ${config.whitelist.length} tokens`);
    }
  }

  /**
   * Start background metadata refresh
   */
  startBackgroundRefresh(intervalMs = 60000): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    this.refreshInterval = setInterval(() => {
      this.refreshStaleMetadata();
    }, intervalMs);

    console.log(`[TradeFilter] Background refresh enabled (every ${intervalMs / 1000}s)`);
  }

  /**
   * Stop background refresh
   */
  stopBackgroundRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Check if a trade should be copied
   */
  async shouldCopyTrade(trade: DetectedTrade, tradeAmountUsdc: number): Promise<FilterResult> {
    if (!this.config.enabled) {
      return { allowed: true };
    }

    // Whitelist bypass
    if (this.config.whitelist.includes(trade.tokenMint)) {
      console.log(`[TradeFilter] ✅ Whitelisted token: ${trade.tokenMint.slice(0, 8)}...`);
      return { allowed: true, reason: 'whitelisted' };
    }

    const checks: FilterResult['checks'] = {};

    try {
      // Get or fetch metadata (cached for 60s)
      const metadata = await this.getTokenMetadata(trade.tokenMint);

      // Check 1: Liquidity
      if (metadata.liquidity < this.config.minLiquidityUsdc) {
        checks.liquidity = { value: metadata.liquidity, passed: false };
        return {
          allowed: false,
          reason: `Low liquidity: $${metadata.liquidity.toLocaleString()} < $${this.config.minLiquidityUsdc.toLocaleString()}`,
          checks,
        };
      }
      checks.liquidity = { value: metadata.liquidity, passed: true };

      // Check 2: Token age
      if (metadata.tokenAge < this.config.minTokenAgeSeconds) {
        checks.tokenAge = { value: metadata.tokenAge, passed: false };
        const ageMinutes = Math.floor(metadata.tokenAge / 60);
        const minMinutes = Math.floor(this.config.minTokenAgeSeconds / 60);
        return {
          allowed: false,
          reason: `Token too new: ${ageMinutes}min < ${minMinutes}min`,
          checks,
        };
      }
      checks.tokenAge = { value: metadata.tokenAge, passed: true };

      // Check 3: 24h Volume
      if (metadata.volume24h < this.config.min24hVolumeUsdc) {
        checks.volume24h = { value: metadata.volume24h, passed: false };
        return {
          allowed: false,
          reason: `Low 24h volume: $${metadata.volume24h.toLocaleString()} < $${this.config.min24hVolumeUsdc.toLocaleString()}`,
          checks,
        };
      }
      checks.volume24h = { value: metadata.volume24h, passed: true };

      // Check 4: Price impact (estimate from Jupiter quote if available)
      const priceImpact = await this.estimatePriceImpact(trade.tokenMint, tradeAmountUsdc);
      if (priceImpact > this.config.maxPriceImpactPercent) {
        checks.priceImpact = { value: priceImpact, passed: false };
        return {
          allowed: false,
          reason: `High price impact: ${priceImpact.toFixed(2)}% > ${this.config.maxPriceImpactPercent}%`,
          checks,
        };
      }
      checks.priceImpact = { value: priceImpact, passed: true };

      // Check 5: Recent pump detection
      const recentPump = this.detectRecentPump(metadata);
      if (recentPump > this.config.maxRecentPumpPercent) {
        checks.recentPump = { value: recentPump, passed: false };
        return {
          allowed: false,
          reason: `Already pumped: +${recentPump.toFixed(1)}% in 5min > +${this.config.maxRecentPumpPercent}%`,
          checks,
        };
      }
      checks.recentPump = { value: recentPump, passed: true };

      // All checks passed!
      console.log(`[TradeFilter] ✅ All checks passed for ${trade.tokenMint.slice(0, 8)}...`);
      return { allowed: true, checks };

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[TradeFilter] Error checking trade: ${errorMsg}`);
      // On error, allow trade (fail-open) but log warning
      return {
        allowed: true,
        reason: 'filter_error',
      };
    }
  }

  /**
   * Get token metadata (cached or fresh)
   */
  private async getTokenMetadata(tokenMint: string): Promise<TokenMetadata> {
    const cached = this.metadataCache.get(tokenMint);
    const now = Date.now();

    // Return cached if fresh
    if (cached && now - cached.lastUpdated < METADATA_CACHE_TTL) {
      return cached;
    }

    // Fetch fresh metadata
    console.log(`[TradeFilter] Fetching metadata for ${tokenMint.slice(0, 8)}...`);
    const metadata = await this.fetchTokenMetadata(tokenMint);
    
    // Store in cache
    this.metadataCache.set(tokenMint, metadata);
    
    return metadata;
  }

  /**
   * Fetch token metadata from various sources
   */
  private async fetchTokenMetadata(tokenMint: string): Promise<TokenMetadata> {
    const now = Date.now();

    // Fetch from DexScreener (free public API)
    // Provides liquidity, volume, token age, price
    const dexData = await this.fetchDexScreenerData(tokenMint);

    const metadata: TokenMetadata = {
      mint: tokenMint,
      liquidity: dexData.liquidity || 0,
      volume24h: dexData.volume24h || 0,
      tokenAge: dexData.tokenAge || 0,
      lastPriceCheck: now,
      priceHistory: [{ price: dexData.price || 0, timestamp: now }],
      lastUpdated: now,
    };

    return metadata;
  }

  /**
   * Fetch data from DexScreener API
   */
  private async fetchDexScreenerData(tokenMint: string): Promise<{
    liquidity: number;
    volume24h: number;
    tokenAge: number;
    price: number;
  }> {
    try {
      // DexScreener public API (no key required)
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`);
      
      if (!response.ok) {
        throw new Error(`DexScreener API error: ${response.status}`);
      }

      const data = await response.json() as any;
      
      // Get the first (usually largest) pair
      const pair = data.pairs?.[0];
      
      if (!pair) {
        // Token not found on DexScreener
        return { liquidity: 0, volume24h: 0, tokenAge: 0, price: 0 };
      }

      // Calculate token age from pair creation
      const pairCreatedAt = new Date(pair.pairCreatedAt).getTime();
      const tokenAge = Math.floor((Date.now() - pairCreatedAt) / 1000);

      return {
        liquidity: parseFloat(pair.liquidity?.usd || '0'),
        volume24h: parseFloat(pair.volume?.h24 || '0'),
        tokenAge,
        price: parseFloat(pair.priceUsd || '0'),
      };
    } catch (error) {
      console.warn(`[TradeFilter] DexScreener fetch failed:`, error);
      // Return safe defaults (will likely fail filters, which is good for unknown tokens)
      return { liquidity: 0, volume24h: 0, tokenAge: 0, price: 0 };
    }
  }

  /**
   * Estimate price impact for our trade size
   * Uses cached quote data or fetches fresh
   */
  private async estimatePriceImpact(tokenMint: string, amountUsdc: number): Promise<number> {
    // For now, use a simple heuristic:
    // Price impact ≈ (trade size / liquidity) * 100
    const metadata = this.metadataCache.get(tokenMint);
    if (!metadata || metadata.liquidity === 0) {
      return 0; // Unknown, assume OK
    }

    const estimatedImpact = (amountUsdc / metadata.liquidity) * 100;
    return Math.min(estimatedImpact, 100); // Cap at 100%
  }

  /**
   * Detect if token has pumped significantly in last 5 minutes
   */
  private detectRecentPump(metadata: TokenMetadata): number {
    const now = Date.now();
    const fiveMinutesAgo = now - PRICE_HISTORY_WINDOW;

    // Filter price history to last 5 minutes
    const recentPrices = metadata.priceHistory.filter(p => p.timestamp >= fiveMinutesAgo);

    if (recentPrices.length < 2) {
      return 0; // Not enough data
    }

    // Compare first and last price in window
    const oldestPrice = recentPrices[0].price;
    const newestPrice = recentPrices[recentPrices.length - 1].price;

    if (oldestPrice === 0) {
      return 0;
    }

    const pumpPercent = ((newestPrice / oldestPrice) - 1) * 100;
    return Math.max(pumpPercent, 0); // Only care about pumps, not dumps
  }

  /**
   * Update price history for a token
   */
  updatePriceHistory(tokenMint: string, price: number): void {
    const metadata = this.metadataCache.get(tokenMint);
    if (!metadata) return;

    const now = Date.now();
    metadata.priceHistory.push({ price, timestamp: now });
    metadata.lastPriceCheck = now;

    // Keep only last 5 minutes of history
    const cutoff = now - PRICE_HISTORY_WINDOW;
    metadata.priceHistory = metadata.priceHistory.filter(p => p.timestamp >= cutoff);
  }

  /**
   * Refresh stale metadata in cache
   */
  private async refreshStaleMetadata(): Promise<void> {
    const now = Date.now();
    const tokensToRefresh: string[] = [];

    // Find tokens with stale metadata
    for (const [tokenMint, metadata] of this.metadataCache.entries()) {
      if (now - metadata.lastUpdated >= METADATA_CACHE_TTL) {
        tokensToRefresh.push(tokenMint);
      }
    }

    if (tokensToRefresh.length > 0) {
      console.log(`[TradeFilter] Refreshing ${tokensToRefresh.length} stale metadata entries`);
      
      // Refresh in parallel (but don't block)
      for (const tokenMint of tokensToRefresh) {
        this.fetchTokenMetadata(tokenMint)
          .then(metadata => this.metadataCache.set(tokenMint, metadata))
          .catch(() => {}); // Ignore refresh errors
      }
    }
  }

  /**
   * Update config
   */
  updateConfig(newConfig: Partial<FilterConfig>): void {
    this.config = { ...this.config, ...newConfig };
    console.log('[TradeFilter] Config updated');
  }

  /**
   * Get current config
   */
  getConfig(): FilterConfig {
    return { ...this.config };
  }

  /**
   * Get cache stats
   */
  getCacheStats(): { size: number; tokens: string[] } {
    return {
      size: this.metadataCache.size,
      tokens: Array.from(this.metadataCache.keys()),
    };
  }
}

