/**
 * Jupiter Trade Executor
 * 
 * Executes swaps via Jupiter aggregator API.
 * Optimized for low latency copy trading.
 * 
 * Latency optimizations:
 * - Skip preflight checks (configurable)
 * - Priority fees for faster inclusion
 * - Fire-and-forget execution with async confirmation tracking
 * - Connection keep-alive with periodic warming
 * - Jito bundle submission for faster block inclusion
 */

import { Connection, Keypair, VersionedTransaction, TransactionSignature, SendOptions, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { Agent } from 'undici';
import { searcherClient, SearcherClient } from 'jito-ts/dist/sdk/block-engine/searcher.js';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types.js';
import { USDC_MINT } from '../constants/tokens.js';

// Jito block engine endpoints
const JITO_BLOCK_ENGINE_URL = 'mainnet.block-engine.jito.wtf';
// Default tip amount (0.001 SOL = 1,000,000 lamports)
const DEFAULT_JITO_TIP_LAMPORTS = 1_000_000;

// Create a persistent HTTP agent with keep-alive for connection reuse
const jupiterAgent = new Agent({
  keepAliveTimeout: 30_000, // Keep connections alive for 30s
  keepAliveMaxTimeout: 60_000, // Max keep-alive time
  connections: 10, // Connection pool size
  pipelining: 1, // Enable HTTP pipelining
});

// Jupiter API endpoints (requires free API key from https://portal.jup.ag/)
const JUPITER_BASE_URL = 'https://api.jup.ag';
const JUPITER_QUOTE_API = `${JUPITER_BASE_URL}/swap/v1/quote`;
const JUPITER_SWAP_API = `${JUPITER_BASE_URL}/swap/v1/swap`;

export interface JupiterExecutorConfig {
  /** RPC connection */
  connection: Connection;
  /** Wallet keypair for signing */
  keypair: Keypair;
  /** Jupiter API key (get free key at https://portal.jup.ag/) */
  apiKey: string;
  /** Slippage in basis points (100 = 1%) */
  slippageBps?: number;
  /** Priority fee in microlamports per compute unit */
  priorityFeeMicroLamports?: number;
  /** Skip preflight checks for speed (default: true) */
  skipPreflight?: boolean;
  /** Use Jito bundles for faster block inclusion (default: false) */
  useJito?: boolean;
  /** Jito tip amount in lamports (default: 1,000,000 = 0.001 SOL) */
  jitoTipLamports?: number;
}

export interface QuoteResult {
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  priceImpactPct: string;
  routePlan: unknown[];
  quoteResponse: JupiterQuoteResponse;
}

interface JupiterQuoteResponse {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpactPct: string;
  routePlan: unknown[];
  contextSlot?: number;
  timeTaken?: number;
}

export interface SwapResult {
  signature: TransactionSignature;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  confirmed: boolean;
  error?: string;
  latencyMs: number;
}

// Quote cache entry
interface CachedQuote {
  quote: QuoteResult;
  timestamp: number;
  amount: string;
}

// Pre-built transaction cache entry
interface PreBuiltTransaction {
  transaction: VersionedTransaction;
  signature: string;
  quote: QuoteResult;
  blockhash: string;
  createdAt: number;
  expiresAt: number;
}

// Cache TTL in milliseconds (quotes are valid for ~5 seconds due to price changes)
const QUOTE_CACHE_TTL = 5000;
// Pre-built transactions valid for 45s (blockhash valid ~60-150s, being conservative)
const PREBUILT_TX_TTL = 45_000;
// Refresh pre-built transactions every 30s
const PREBUILT_TX_REFRESH_INTERVAL = 30_000;

export class JupiterExecutor {
  private connection: Connection;
  private keypair: Keypair;
  private apiKey: string;
  private slippageBps: number;
  private priorityFeeMicroLamports: number;
  private skipPreflight: boolean;
  
  // Jito bundle support
  private useJito: boolean;
  private jitoTipLamports: number;
  private jitoClient: SearcherClient | null = null;
  private jitoTipAccounts: string[] = [];
  
  // Quote cache: keyed by (inputMint, outputMint, amount, swapMode)
  private quoteCache: Map<string, CachedQuote> = new Map();
  
  // Pre-built transaction cache: tokenMint -> pre-signed transaction
  private txCache: Map<string, PreBuiltTransaction> = new Map();
  
  // Pre-fetch interval handles
  private preFetchInterval: NodeJS.Timeout | null = null;
  private txRefreshInterval: NodeJS.Timeout | null = null;
  
  // Tokens and amount for pre-building
  private allowedTokens: string[] = [];
  private tradeAmountUsdc: number = 0;

  constructor(config: JupiterExecutorConfig) {
    this.connection = config.connection;
    this.keypair = config.keypair;
    this.apiKey = config.apiKey;
    this.slippageBps = config.slippageBps || 100; // 1% default
    this.priorityFeeMicroLamports = config.priorityFeeMicroLamports || 200000; // 200k default for faster inclusion
    this.skipPreflight = config.skipPreflight ?? true; // Skip by default for speed
    this.useJito = config.useJito ?? false;
    this.jitoTipLamports = config.jitoTipLamports || DEFAULT_JITO_TIP_LAMPORTS;

    console.log(`[JupiterExecutor] Initialized with slippage: ${this.slippageBps}bps, priority fee: ${this.priorityFeeMicroLamports} microlamports`);
    if (this.useJito) {
      console.log(`[JupiterExecutor] Jito bundles ENABLED with ${this.jitoTipLamports / LAMPORTS_PER_SOL} SOL tip`);
      this.initJito();
    }
    
    // Warm up connection on startup
    this.warmConnection().catch(() => {});
  }

  /**
   * Initialize Jito client and fetch tip accounts
   * Retries up to 3 times with exponential backoff
   */
  private async initJito(): Promise<void> {
    const maxRetries = 3;
    const baseDelay = 2000; // 2 seconds

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Create Jito searcher client (no auth keypair needed for basic bundle submission)
        this.jitoClient = searcherClient(JITO_BLOCK_ENGINE_URL);
        
        // Get tip accounts
        const tipAccountsResult = await this.jitoClient.getTipAccounts();
        if (tipAccountsResult.ok) {
          this.jitoTipAccounts = tipAccountsResult.value;
          console.log(`[JupiterExecutor] Jito initialized with ${this.jitoTipAccounts.length} tip accounts`);
          return; // Success!
        } else {
          throw new Error(tipAccountsResult.error.message);
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        
        if (attempt < maxRetries) {
          const delay = baseDelay * Math.pow(2, attempt - 1); // Exponential backoff
          console.warn(`[JupiterExecutor] Jito init failed (attempt ${attempt}/${maxRetries}): ${errorMsg}`);
          console.warn(`[JupiterExecutor] Retrying in ${delay / 1000}s...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        } else {
          console.warn(`[JupiterExecutor] Jito init failed after ${maxRetries} attempts: ${errorMsg}`);
          console.warn('[JupiterExecutor] Falling back to regular RPC (Jito disabled)');
          this.useJito = false;
        }
      }
    }
  }

  /**
   * Build a cache key for a quote
   */
  private getCacheKey(
    inputMint: string,
    outputMint: string,
    amount: string,
    swapMode: 'ExactIn' | 'ExactOut'
  ): string {
    return `${inputMint}|${outputMint}|${amount}|${swapMode}`;
  }

  /**
   * Start pre-fetching quotes and pre-building transactions for allowed tokens
   * @param tokens - List of token mints to pre-fetch quotes for
   * @param amountUsdc - USDC amount for quotes (in UI units, e.g., 2 for $2)
   * @param intervalMs - How often to refresh quotes (default: 3000ms)
   */
  startQuotePreFetch(tokens: string[], amountUsdc: number, intervalMs = 3000): void {
    if (this.preFetchInterval) {
      clearInterval(this.preFetchInterval);
    }
    if (this.txRefreshInterval) {
      clearInterval(this.txRefreshInterval);
    }

    this.allowedTokens = tokens;
    this.tradeAmountUsdc = amountUsdc;
    const amountRaw = Math.floor(amountUsdc * 1_000_000).toString();
    
    console.log(`[JupiterExecutor] Starting quote pre-fetch for ${tokens.length} tokens every ${intervalMs}ms`);
    console.log(`[JupiterExecutor] Starting transaction pre-build for ${tokens.length} tokens every ${PREBUILT_TX_REFRESH_INTERVAL / 1000}s`);

    // Pre-fetch quotes immediately
    this.preFetchQuotes(tokens, amountRaw);

    // Pre-build transactions immediately (in background)
    this.preBuildTransactions(tokens, amountUsdc).catch(err => {
      console.warn('[JupiterExecutor] Initial transaction pre-build failed:', err.message);
    });

    // Periodically refresh quotes
    this.preFetchInterval = setInterval(() => {
      this.preFetchQuotes(tokens, amountRaw);
    }, intervalMs);

    // Periodically refresh pre-built transactions
    this.txRefreshInterval = setInterval(() => {
      this.refreshPreBuiltTransactions().catch(err => {
        console.warn('[JupiterExecutor] Transaction refresh failed:', err.message);
      });
    }, PREBUILT_TX_REFRESH_INTERVAL);
  }

  /**
   * Stop pre-fetching quotes and pre-building transactions
   */
  stopQuotePreFetch(): void {
    if (this.preFetchInterval) {
      clearInterval(this.preFetchInterval);
      this.preFetchInterval = null;
      console.log('[JupiterExecutor] Stopped quote pre-fetch');
    }
    if (this.txRefreshInterval) {
      clearInterval(this.txRefreshInterval);
      this.txRefreshInterval = null;
      console.log('[JupiterExecutor] Stopped transaction pre-build');
    }
  }

  /**
   * Pre-fetch quotes for multiple tokens in parallel
   */
  private async preFetchQuotes(tokens: string[], amountRaw: string): Promise<void> {
    const promises = tokens.map(async (tokenMint) => {
      try {
        const quote = await this.getQuote(USDC_MINT, tokenMint, amountRaw, 'ExactIn');
        const key = this.getCacheKey(USDC_MINT, tokenMint, amountRaw, 'ExactIn');
        this.quoteCache.set(key, {
          quote,
          timestamp: Date.now(),
          amount: amountRaw,
        });
      } catch {
        // Ignore pre-fetch errors
      }
    });

    await Promise.allSettled(promises);
  }

  /**
   * Pre-build transactions for multiple tokens in parallel
   */
  private async preBuildTransactions(tokens: string[], amountUsdc: number): Promise<void> {
    const promises = tokens.map(tokenMint => this.preBuildTransaction(tokenMint, amountUsdc));
    await Promise.allSettled(promises);
  }

  /**
   * Pre-build a single transaction for a token
   * This is the core optimization - build and sign tx in advance
   */
  private async preBuildTransaction(tokenMint: string, amountUsdc: number): Promise<void> {
    try {
      const startTime = Date.now();
      const usdcAmountRaw = Math.floor(amountUsdc * 1_000_000).toString();

      // 1. Get quote (may use cache)
      const quote = await this.getQuoteWithCache(USDC_MINT, tokenMint, usdcAmountRaw, 'ExactIn');

      // 2. Get swap transaction from Jupiter API (this is the slow part we're pre-doing)
      const swapResponse = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          quoteResponse: quote.quoteResponse,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          computeUnitPriceMicroLamports: this.priorityFeeMicroLamports,
          dynamicComputeUnitLimit: true,
        }),
        dispatcher: jupiterAgent,
      } as RequestInit);

      if (!swapResponse.ok) {
        throw new Error(`Jupiter swap API failed: ${await swapResponse.text()}`);
      }

      const swapData = await swapResponse.json() as { swapTransaction: string };

      // 3. Deserialize and sign transaction NOW
      const swapTransactionBuf = Buffer.from(swapData.swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([this.keypair]);

      // 4. Extract signature
      const bs58 = await import('bs58');
      const signature = bs58.default.encode(transaction.signatures[0]);

      // 5. Store in cache with expiry
      const now = Date.now();
      this.txCache.set(tokenMint, {
        transaction,
        signature,
        quote,
        blockhash: Buffer.from(transaction.message.recentBlockhash).toString('base64'),
        createdAt: now,
        expiresAt: now + PREBUILT_TX_TTL,
      });

      const buildTime = Date.now() - startTime;
      console.log(`[JupiterExecutor] Pre-built transaction for ${tokenMint.slice(0, 8)}... in ${buildTime}ms (valid for ${PREBUILT_TX_TTL / 1000}s)`);
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.warn(`[JupiterExecutor] Failed to pre-build transaction for ${tokenMint.slice(0, 8)}...:`, errorMsg);
    }
  }

  /**
   * Refresh pre-built transactions
   * Called periodically in background
   * Ensures we always have fresh pre-built transactions for all allowed tokens
   */
  private async refreshPreBuiltTransactions(): Promise<void> {
    const now = Date.now();
    const tokensToRefresh: string[] = [];

    // Check all allowed tokens
    for (const tokenMint of this.allowedTokens) {
      const cached = this.txCache.get(tokenMint);
      
      // Refresh if: no cached tx OR cached tx is expired/close to expiring
      if (!cached || (cached.expiresAt - now) < 15_000) {
        tokensToRefresh.push(tokenMint);
      }
    }

    if (tokensToRefresh.length > 0) {
      console.log(`[JupiterExecutor] Refreshing ${tokensToRefresh.length} pre-built transactions`);
      await this.preBuildTransactions(tokensToRefresh, this.tradeAmountUsdc);
    }
  }

  /**
   * Get a cached quote if fresh, otherwise fetch new
   */
  async getQuoteWithCache(
    inputMint: string,
    outputMint: string,
    amount: string,
    swapMode: 'ExactIn' | 'ExactOut' = 'ExactIn'
  ): Promise<QuoteResult> {
    const key = this.getCacheKey(inputMint, outputMint, amount, swapMode);
    const cached = this.quoteCache.get(key);

    if (cached && Date.now() - cached.timestamp < QUOTE_CACHE_TTL) {
      console.log(
        `[JupiterExecutor] Using cached quote (age: ${Date.now() - cached.timestamp}ms) ` +
        `for ${inputMint.slice(0, 8)}... -> ${outputMint.slice(0, 8)}... (${swapMode})`
      );
      return cached.quote;
    }

    // Cache miss or stale - fetch fresh quote
    return this.getQuote(inputMint, outputMint, amount, swapMode);
  }

  /**
   * Warm up the connection to Jupiter API
   * Reduces latency for the first real request by establishing HTTP connections
   */
  async warmConnection(): Promise<void> {
    const startTime = Date.now();
    
    // Warm multiple endpoints in parallel to establish connections
    const warmingPromises = [
      // Tokens endpoint (lightweight)
      fetch(`${JUPITER_BASE_URL}/swap/v1/tokens`, {
        headers: { 'x-api-key': this.apiKey },
        dispatcher: jupiterAgent,
      } as RequestInit).catch(() => {}),
      
      // Quote endpoint (make minimal valid request)
      fetch(`${JUPITER_QUOTE_API}?inputMint=${USDC_MINT}&outputMint=${USDC_MINT}&amount=1000000&slippageBps=50`, {
        headers: { 'x-api-key': this.apiKey },
        dispatcher: jupiterAgent,
      } as RequestInit).catch(() => {}),
      
      // Swap endpoint (will fail validation but establishes connection)
      fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({ userPublicKey: this.keypair.publicKey.toBase58() }),
        dispatcher: jupiterAgent,
      } as RequestInit).catch(() => {}),
    ];
    
    await Promise.allSettled(warmingPromises);
    console.log(`[JupiterExecutor] Connections warmed (${warmingPromises.length} endpoints) in ${Date.now() - startTime}ms`);
  }

  /**
   * Get a quote for a swap
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: string, // In smallest units (e.g., lamports for SOL, 6 decimals for USDC)
    swapMode: 'ExactIn' | 'ExactOut' = 'ExactIn'
  ): Promise<QuoteResult> {
    const startTime = Date.now();

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount,
      slippageBps: this.slippageBps.toString(),
      swapMode,
    });

    const response = await fetch(`${JUPITER_QUOTE_API}?${params}`, {
      headers: {
        'x-api-key': this.apiKey,
      },
      dispatcher: jupiterAgent,
    } as RequestInit);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Jupiter quote failed: ${error}`);
    }

    const quoteResponse = await response.json() as JupiterQuoteResponse;
    
    const latency = Date.now() - startTime;
    console.log(`[JupiterExecutor] Quote received in ${latency}ms: ${quoteResponse.inAmount} ${inputMint.slice(0, 8)}... -> ${quoteResponse.outAmount} ${outputMint.slice(0, 8)}...`);

    return {
      inputMint: quoteResponse.inputMint,
      outputMint: quoteResponse.outputMint,
      inAmount: quoteResponse.inAmount,
      outAmount: quoteResponse.outAmount,
      otherAmountThreshold: quoteResponse.otherAmountThreshold,
      priceImpactPct: quoteResponse.priceImpactPct,
      routePlan: quoteResponse.routePlan,
      quoteResponse,
    };
  }

  /**
   * Execute a swap using a quote
   * Returns immediately after sending - doesn't wait for confirmation
   */
  async executeSwap(quote: QuoteResult): Promise<SwapResult> {
    const startTime = Date.now();

    try {
      // Get the swap transaction from Jupiter
      const swapResponse = await fetch(JUPITER_SWAP_API, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
        },
        body: JSON.stringify({
          quoteResponse: quote.quoteResponse,
          userPublicKey: this.keypair.publicKey.toBase58(),
          wrapAndUnwrapSol: true,
          computeUnitPriceMicroLamports: this.priorityFeeMicroLamports,
          // Use dynamic compute unit limit for efficiency
          dynamicComputeUnitLimit: true,
        }),
        dispatcher: jupiterAgent,
      } as RequestInit);

      if (!swapResponse.ok) {
        const error = await swapResponse.text();
        throw new Error(`Jupiter swap transaction failed: ${error}`);
      }

      const swapData = await swapResponse.json() as { swapTransaction: string };
      const { swapTransaction } = swapData;

      // Deserialize and sign the transaction
      const swapTransactionBuf = Buffer.from(swapTransaction, 'base64');
      const transaction = VersionedTransaction.deserialize(swapTransactionBuf);
      transaction.sign([this.keypair]);

      let signature: TransactionSignature;

      // Use Jito bundle if enabled
      if (this.useJito && this.jitoClient && this.jitoTipAccounts.length > 0) {
        signature = await this.sendViaJito(transaction);
      } else {
        // Send via regular RPC
        const sendOptions: SendOptions = {
          skipPreflight: this.skipPreflight,
          preflightCommitment: 'processed',
          maxRetries: 2,
        };
        signature = await this.connection.sendTransaction(transaction, sendOptions);
      }
      
      const latencyMs = Date.now() - startTime;
      console.log(`[JupiterExecutor] Swap sent${this.useJito ? ' (Jito+RPC parallel)' : ''} in ${latencyMs}ms: ${signature}`);

      // Start async confirmation tracking (don't block)
      this.trackConfirmation(signature, latencyMs);

      return {
        signature,
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        confirmed: false, // Will be updated by confirmation tracker
        latencyMs,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`[JupiterExecutor] Swap failed in ${latencyMs}ms:`, errorMessage);
      
      return {
        signature: '',
        inputMint: quote.inputMint,
        outputMint: quote.outputMint,
        inAmount: quote.inAmount,
        outAmount: quote.outAmount,
        confirmed: false,
        error: errorMessage,
        latencyMs,
      };
    }
  }

  /**
   * Convenience method: Buy a token with USDC
   * FAST PATH: Uses pre-built transaction if available (~50ms)
   * FALLBACK: Builds transaction on-demand if cache miss (~192ms)
   * @param tokenMint - Token to buy
   * @param usdcAmount - Amount of USDC to spend (in UI units, e.g., 2.0 for $2)
   */
  async buyToken(tokenMint: string, usdcAmount: number): Promise<SwapResult> {
    const startTime = Date.now();
    
    console.log(`[JupiterExecutor] Buying ${tokenMint.slice(0, 8)}... with $${usdcAmount} USDC`);
    
    // FAST PATH: Check for pre-built transaction
    const cached = this.txCache.get(tokenMint);
    if (cached && Date.now() < cached.expiresAt) {
      console.log(`[JupiterExecutor] ⚡ Using pre-built transaction (age: ${Date.now() - cached.createdAt}ms)`);
      
      try {
        // Use the pre-signed transaction
        const signature = await this.sendPreBuiltTransaction(cached);
        
        // CRITICAL: Delete from cache (single-use!)
        this.txCache.delete(tokenMint);
        
        // Start rebuilding replacement in background (non-blocking)
        this.preBuildTransaction(tokenMint, usdcAmount).catch(() => {});
        
        const latencyMs = Date.now() - startTime;
        console.log(`[JupiterExecutor] Swap sent (pre-built) in ${latencyMs}ms: ${signature}`);
        
        // Track confirmation async
        this.trackConfirmation(signature, latencyMs);
        
        return {
          signature,
          inputMint: cached.quote.inputMint,
          outputMint: cached.quote.outputMint,
          inAmount: cached.quote.inAmount,
          outAmount: cached.quote.outAmount,
          confirmed: false,
          latencyMs,
        };
      } catch (error) {
        // Pre-built tx failed, fall through to on-demand
        console.warn('[JupiterExecutor] Pre-built transaction failed, falling back to on-demand:', error);
        this.txCache.delete(tokenMint);
      }
    }
    
    // FALLBACK: Build transaction on-demand (current behavior)
    console.log(`[JupiterExecutor] Building transaction on-demand (no pre-built available)`);
    const usdcAmountRaw = Math.floor(usdcAmount * 1_000_000).toString();
    const quote = await this.getQuoteWithCache(USDC_MINT, tokenMint, usdcAmountRaw, 'ExactIn');
    return this.executeSwap(quote);
  }

  /**
   * Convenience method: Sell a token for USDC
   * @param tokenMint - Token to sell
   * @param tokenAmount - Amount of tokens to sell (in smallest units)
   */
  async sellToken(tokenMint: string, tokenAmount: string): Promise<SwapResult> {
    console.log(`[JupiterExecutor] Selling ${tokenAmount} of ${tokenMint.slice(0, 8)}... for USDC`);
    
    const quote = await this.getQuote(tokenMint, USDC_MINT, tokenAmount, 'ExactIn');
    return this.executeSwap(quote);
  }

  /**
   * Convenience method: Sell a token for a fixed USDC amount (ExactOut)
   * @param tokenMint - Token to sell
   * @param usdcAmount - Desired USDC proceeds (in UI units, e.g., 2.0 for $2)
   */
  async sellTokenForUsdcAmount(tokenMint: string, usdcAmount: number): Promise<SwapResult> {
    // Convert desired USDC out amount to smallest units (6 decimals)
    const usdcAmountRaw = Math.floor(usdcAmount * 1_000_000).toString();

    console.log(`[JupiterExecutor] Selling ${tokenMint.slice(0, 8)}... for $${usdcAmount} USDC (ExactOut)`);

    // Use ExactOut so we specify how much USDC we want to receive
    // Use cache so repeated sells within a few seconds don't re-hit Jupiter
    const quote = await this.getQuoteWithCache(tokenMint, USDC_MINT, usdcAmountRaw, 'ExactOut');
    return this.executeSwap(quote);
  }

  /**
   * Send a pre-built transaction (already signed)
   * Uses same parallel Jito+RPC strategy as regular swaps
   */
  private async sendPreBuiltTransaction(cached: PreBuiltTransaction): Promise<TransactionSignature> {
    // Transaction is already signed, just send it
    if (this.useJito && this.jitoClient && this.jitoTipAccounts.length > 0) {
      return this.sendViaJito(cached.transaction);
    } else {
      // Send via regular RPC
      const sendOptions: SendOptions = {
        skipPreflight: this.skipPreflight,
        preflightCommitment: 'processed',
        maxRetries: 2,
      };
      await this.connection.sendTransaction(cached.transaction, sendOptions);
      return cached.signature;
    }
  }

  /**
   * Send transaction via BOTH Jito and RPC in parallel
   * Uses whichever succeeds first - both send the same signed transaction
   * so only one will land on-chain (same signature = deduplicated by validators)
   */
  private async sendViaJito(transaction: VersionedTransaction): Promise<TransactionSignature> {
    // Get the signature upfront (same for both paths since tx is already signed)
    const bs58 = await import('bs58');
    const signature = bs58.default.encode(transaction.signatures[0]);
    
    const sendOptions: SendOptions = {
      skipPreflight: this.skipPreflight,
      preflightCommitment: 'processed',
      maxRetries: 2,
    };

    // If Jito isn't ready, just use RPC
    if (!this.jitoClient || this.jitoTipAccounts.length === 0) {
      console.log('[JupiterExecutor] Jito not ready, using RPC only');
      await this.connection.sendTransaction(transaction, sendOptions);
      return signature;
    }

    // Prepare Jito bundle
    const tipAccount = this.jitoTipAccounts[Math.floor(Math.random() * this.jitoTipAccounts.length)];
    const { blockhash } = await this.connection.getLatestBlockhash('confirmed');
    const bundle = new Bundle([transaction], 5);
    const bundleWithTip = bundle.addTipTx(
      this.keypair,
      this.jitoTipLamports,
      new PublicKey(tipAccount),
      blockhash
    );

    if (bundleWithTip instanceof Error) {
      console.warn('[JupiterExecutor] Failed to create Jito bundle, using RPC only');
      await this.connection.sendTransaction(transaction, sendOptions);
      return signature;
    }

    // Race Jito and RPC in parallel - first success wins
    // Both send the SAME signed transaction, so validators deduplicate by signature
    const jitoPromise = this.sendJitoBundle(bundleWithTip)
      .then(() => ({ source: 'jito' as const, success: true }))
      .catch((err) => ({ source: 'jito' as const, success: false, error: err }));

    const rpcPromise = this.connection.sendTransaction(transaction, sendOptions)
      .then(() => ({ source: 'rpc' as const, success: true }))
      .catch((err) => ({ source: 'rpc' as const, success: false, error: err }));

    // Wait for both to settle
    const [jitoResult, rpcResult] = await Promise.allSettled([jitoPromise, rpcPromise]);

    // Check results
    const jitoOk = jitoResult.status === 'fulfilled' && jitoResult.value.success;
    const rpcOk = rpcResult.status === 'fulfilled' && rpcResult.value.success;

    if (jitoOk && rpcOk) {
      console.log(`[JupiterExecutor] Sent via BOTH Jito + RPC (parallel)`);
    } else if (jitoOk) {
      console.log(`[JupiterExecutor] Sent via Jito (RPC failed)`);
    } else if (rpcOk) {
      const jitoError = jitoResult.status === 'fulfilled' && !jitoResult.value.success 
        ? (jitoResult.value as { error: Error }).error?.message 
        : 'unknown';
      console.log(`[JupiterExecutor] Sent via RPC (Jito failed: ${jitoError})`);
    } else {
      // Both failed - throw the RPC error (more informative usually)
      const rpcError = rpcResult.status === 'rejected' 
        ? rpcResult.reason 
        : (rpcResult.value as { error: Error }).error;
      throw rpcError;
    }

    return signature;
  }

  /**
   * Send a Jito bundle (helper for parallel submission)
   */
  private async sendJitoBundle(bundle: Bundle): Promise<void> {
    if (!this.jitoClient) {
      throw new Error('Jito client not initialized');
    }

    const result = await this.jitoClient.sendBundle(bundle);
    
    if (!result.ok) {
      throw new Error(result.error.message);
    }

    console.log(`[JupiterExecutor] Jito bundle submitted: ${result.value}`);
  }

  /**
   * Track transaction confirmation asynchronously
   */
  private async trackConfirmation(signature: string, initialLatencyMs: number): Promise<void> {
    try {
      const startTime = Date.now();
      
      // Wait for confirmation with timeout
      const confirmation = await this.connection.confirmTransaction(
        signature,
        'confirmed'
      );
      
      const confirmationTime = Date.now() - startTime;
      const totalTime = initialLatencyMs + confirmationTime;

      if (confirmation.value.err) {
        console.error(`[JupiterExecutor] Transaction failed: ${signature}`, confirmation.value.err);
      } else {
        console.log(`[JupiterExecutor] Transaction confirmed in ${confirmationTime}ms (total: ${totalTime}ms): ${signature}`);
      }
    } catch (error) {
      console.error(`[JupiterExecutor] Confirmation tracking failed for ${signature}:`, error);
    }
  }
}

