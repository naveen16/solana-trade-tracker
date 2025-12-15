/**
 * Trade Analyzer Service
 * 
 * Analyzes decoded transactions to detect trades routed through OKX and DFlow aggregators.
 * Determines trade direction (buy/sell), token mint, and USDC amount.
 * 
 * Note: For full trade details (token mint, USDC amount), an RPC connection is needed
 * to resolve Address Lookup Tables used in versioned transactions.
 */

import { EventEmitter } from 'events';
import { VersionedTransaction, Transaction, Connection, AddressLookupTableAccount, ParsedTransactionWithMeta } from '@solana/web3.js';
import type { DecodedTransaction } from '../types/transaction.js';
import type { DetectedTrade, TradeDirection, Aggregator } from '../types/trade.js';
import { OKX_PROGRAM_ID, DFLOW_PROGRAM_ID, OKX_SWAP_DISCRIMINATORS, DFLOW_SWAP_DISCRIMINATORS } from '../constants/aggregators.js';
import { USDC_MINT } from '../constants/tokens.js';
import { VOTE_PROGRAM_ID } from '../constants/programs.js';
import { TradeEvents, TransactionEvents } from '../constants/events.js';

export interface TradeAnalyzerConfig {
  /** RPC URL (required for balance delta parsing and Address Lookup Table resolution) */
  rpcUrl: string;
}

export class TradeAnalyzer extends EventEmitter {

  private trackedUsers: Set<string> = new Set();
  private tradeCount = 0;
  private aggregatorTradeCount = 0;
  private rpcConnection: Connection;
  private lookupTableCache: Map<string, AddressLookupTableAccount> = new Map();

  constructor(config: TradeAnalyzerConfig) {
    super();
    this.rpcConnection = new Connection(config.rpcUrl);
    console.log(`[TradeAnalyzer] RPC connection enabled: ${config.rpcUrl}`);
  }

  /**
   * Add a user address to track for trades
   */
  addTrackedUser(address: string): void {
    this.trackedUsers.add(address);
    console.log(`[TradeAnalyzer] Tracking user: ${address}`);
  }

  /**
   * Remove a user from tracking
   */
  removeTrackedUser(address: string): void {
    this.trackedUsers.delete(address);
  }

  /**
   * Subscribe to transaction events from TransactionProcessor
   */
  subscribe(transactionProcessor: EventEmitter): void {
    transactionProcessor.on(TransactionEvents.TRANSACTION, (decodedTx: DecodedTransaction) => {
      // Fire and forget - we don't want to block the event loop
      this.analyzeTransaction(decodedTx).catch((error) => {
        this.emit(TradeEvents.ERROR, error);
      });
    });
  }

  /**
   * Analyze a decoded transaction for trades
   */
  async analyzeTransaction(decodedTx: DecodedTransaction): Promise<void> {
    try {
      // Skip vote transactions (they make up ~88% of all transactions)
      if (decodedTx.accountKeys.includes(VOTE_PROGRAM_ID)) {
        return;
      }

      // Resolve full account keys including lookup tables
      // This is critical because OKX/DFlow program IDs are typically in lookup tables
      let fullAccountKeys = decodedTx.accountKeys;
      if (decodedTx.isVersioned) {
        try {
          fullAccountKeys = await this.resolveAccountKeys(decodedTx);
        } catch {
          // Fall back to static keys (will miss lookup table programs)
        }
      }

      // Find the user address (signer) that we're tracking
      const userAddress = this.findTrackedUserFromKeys(fullAccountKeys);
      
      if (!userAddress && this.trackedUsers.size > 0) {
        return; // Transaction doesn't involve any tracked users
      }

      // Parse the trade details - this will identify the aggregator and verify it's a swap
      const trade = await this.parseTradeDetails(
        decodedTx, 
        userAddress || decodedTx.accountKeys[0],
        fullAccountKeys
      );
      
      if (trade) {
        this.aggregatorTradeCount++;
      }
      
      if (trade) {
        this.tradeCount++;
        this.emit(TradeEvents.TRADE, trade);
      }
    } catch (error) {
      this.emit(TradeEvents.ERROR, error);
    }
  }

  private lastRpcCall = 0;
  private rpcCallCount = 0;

  /**
   * Resolve full account keys including Address Lookup Tables
   * Includes rate limiting to avoid 429 errors
   */
  private async resolveAccountKeys(decodedTx: DecodedTransaction): Promise<string[]> {
    if (!decodedTx.isVersioned) {
      return decodedTx.accountKeys;
    }

    const vTx = decodedTx.transaction as VersionedTransaction;
    const lookups = vTx.message.addressTableLookups;
    
    if (!lookups || lookups.length === 0) {
      return decodedTx.accountKeys;
    }

    const fullKeys = [...decodedTx.accountKeys];

    for (const lookup of lookups) {
      const tableKey = lookup.accountKey.toBase58();
      
      // Check cache first
      let tableAccount = this.lookupTableCache.get(tableKey);
      
      if (!tableAccount) {
        // Rate limiting: max 2 RPC calls per second
        const now = Date.now();
        if (now - this.lastRpcCall < 500) {
          await new Promise(resolve => setTimeout(resolve, 500 - (now - this.lastRpcCall)));
        }
        this.lastRpcCall = Date.now();
        this.rpcCallCount++;

        try {
          // Fetch from RPC
          const result = await this.rpcConnection.getAddressLookupTable(lookup.accountKey);
          if (result.value) {
            tableAccount = result.value;
            this.lookupTableCache.set(tableKey, tableAccount);
          }
        } catch {
          // Skip this lookup table on error
          continue;
        }
      }

      if (tableAccount) {
        // Add writable addresses
        for (const idx of lookup.writableIndexes) {
          const addr = tableAccount.state.addresses[idx];
          if (addr) {
            fullKeys.push(addr.toBase58());
          }
        }
        // Add readonly addresses
        for (const idx of lookup.readonlyIndexes) {
          const addr = tableAccount.state.addresses[idx];
          if (addr) {
            fullKeys.push(addr.toBase58());
          }
        }
      }
    }

    return fullKeys;
  }

  /**
   * Identify aggregator by checking for actual swap instructions
   * More accurate than checking account keys since it verifies swap discriminators
   */
  private identifyAggregatorFromInstructions(instructions: ParsedInstruction[]): Aggregator {
    for (const ix of instructions) {
      // Check OKX swap instructions
      if (ix.programId === OKX_PROGRAM_ID && ix.data.length >= 8) {
        if (this.isOkxSwapInstruction(ix.data)) {
          return 'okx';
        }
      }
      
      // Check DFlow swap instructions
      if (ix.programId === DFLOW_PROGRAM_ID && ix.data.length >= 8) {
        if (this.isDFlowSwapInstruction(ix.data)) {
          return 'dflow';
        }
      }
    }
    
    return 'unknown';
  }

  /**
   * Find which tracked user is involved in this transaction
   * Uses full account keys (including resolved lookup tables)
   */
  private findTrackedUserFromKeys(accountKeys: string[]): string | null {
    for (const address of accountKeys) {
      if (this.trackedUsers.has(address)) {
        return address;
      }
    }
    return null;
  }

  /**
   * Parse trade details using token balance deltas (preTokenBalances + postTokenBalances)
   * This is the most reliable method as balance deltas show the actual result of trades
   * Works for OKX, DFlow, Jupiter, and any aggregator regardless of instruction format
   * 
   * This is the recommended approach as it's immune to instruction format changes and
   * works with multi-hop swaps, CPI-heavy transactions, and wrapped SOL.
   * 
   * @param decodedTx - Decoded transaction from Shredstream
   * @param aggregator - Aggregator type (okx/dflow)
   * @param userAddress - User address making the trade
   * @param rpcConnection - RPC connection for fetching parsed transaction
   * @returns DetectedTrade or null if parsing fails
   */
  private async parseTradeDetailsFromBalanceDeltas(
    decodedTx: DecodedTransaction,
    aggregator: Aggregator,
    userAddress: string,
    rpcConnection: Connection
  ): Promise<DetectedTrade | null> {
    try {
      const { signature, slot } = decodedTx;

      // Note: We need to fetch the executed transaction from RPC to get balance metadata
      // (preTokenBalances/postTokenBalances). Shredstream only provides raw transaction bytes,
      // not execution results. The signature from decodedTx is used to fetch the metadata.
      // Even though we have the transaction object, RPC requires the signature to look up
      // the specific executed transaction and its metadata.
      const tx = await rpcConnection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed',
      });

      if (!tx || !tx.meta) {
        return null;
      }

      // Extract token balance deltas for the user
      const deltas = this.extractTokenBalanceDeltas(tx, userAddress);

      if (deltas.length === 0) {
        return null;
      }

      // Find USDC delta and the other token delta
      const usdcDelta = deltas.find(d => d.mint === USDC_MINT);
      const otherTokenDelta = deltas.find(d => d.mint !== USDC_MINT);

      // Must involve USDC to be a trade we care about
      if (!usdcDelta) {
        return null;
      }

      // Must have another token (not just USDC)
      if (!otherTokenDelta) {
        return null;
      }

      // Determine direction based on USDC flow
      // If USDC delta is positive: user received USDC → SELL (sold tokens)
      // If USDC delta is negative: user spent USDC → BUY (bought tokens)
      const direction: TradeDirection = usdcDelta.delta > 0 ? 'sell' : 'buy';

      // Get token mint (the non-USDC token)
      const tokenMint = otherTokenDelta.mint;

      // Get USDC amount (absolute value, calculated precisely from raw amount)
      // Use the delta which is now calculated from raw amount for precision
      const usdcAmount = Math.abs(usdcDelta.delta);

      // Get token amount (absolute value in raw units)
      // Use the raw delta which is already in the token's native units
      const tokenDeltaRawValue = BigInt(otherTokenDelta.deltaRaw);
      const tokenAmountRaw = tokenDeltaRawValue < 0 ? -tokenDeltaRawValue : tokenDeltaRawValue;

      return {
        signature,
        slot,
        direction,
        tokenMint,
        usdcAmount,
        tokenAmount: tokenAmountRaw,
        userAddress,
        aggregator,
        detectedAt: new Date(),
      };
    } catch (error) {
      console.error('[TradeAnalyzer] Error parsing from balance deltas:', error);
      return null;
    }
  }

  /**
   * Extract token balance deltas (post - pre) for a specific user
   * Returns array of { mint, delta, deltaRaw, decimals } where:
   * - delta is the change in UI amount (for display, calculated from raw for precision)
   * - deltaRaw is the change in raw amount (for precision)
   * - decimals is the token's decimals
   */
  private extractTokenBalanceDeltas(
    tx: ParsedTransactionWithMeta,
    userAddress: string
  ): Array<{ mint: string; delta: number; deltaRaw: string; decimals: number }> {
    const pre = tx.meta?.preTokenBalances || [];
    const post = tx.meta?.postTokenBalances || [];

    // Map to track balance changes: mint -> { rawDelta, decimals }
    const balanceMap = new Map<string, { rawDelta: bigint; decimals: number }>();

    // Subtract pre balances (what user had before)
    for (const balance of pre) {
      if (balance.owner === userAddress) {
        const rawAmount = BigInt(balance.uiTokenAmount?.amount || '0');
        const decimals = balance.uiTokenAmount?.decimals || 0;
        balanceMap.set(balance.mint, { rawDelta: -rawAmount, decimals });
      }
    }

    // Add post balances (what user has after)
    for (const balance of post) {
      if (balance.owner === userAddress) {
        const rawAmount = BigInt(balance.uiTokenAmount?.amount || '0');
        const decimals = balance.uiTokenAmount?.decimals || 0;
        const current = balanceMap.get(balance.mint) || { rawDelta: BigInt(0), decimals };
        balanceMap.set(balance.mint, {
          rawDelta: current.rawDelta + rawAmount,
          decimals: decimals || current.decimals, // Use decimals from post if available
        });
      }
    }

    // Convert to array and calculate precise UI delta from raw amount
    return Array.from(balanceMap.entries())
      .map(([mint, data]) => {
        const rawDelta = data.rawDelta;
        const decimals = data.decimals;
        
        // Calculate precise UI amount from raw: divide by 10^decimals
        // Use string manipulation to preserve full precision for decimal division
        const rawDeltaStr = rawDelta.toString();
        const isNegative = rawDeltaStr.startsWith('-');
        const absRawDeltaStr = isNegative ? rawDeltaStr.slice(1) : rawDeltaStr;
        
        // Pad with zeros if needed for decimal point placement
        const padded = absRawDeltaStr.padStart(decimals + 1, '0');
        const integerPart = padded.slice(0, -decimals) || '0';
        const decimalPart = padded.slice(-decimals);
        
        // Construct the UI amount string with proper decimal point
        const uiDeltaStr = `${isNegative ? '-' : ''}${integerPart}.${decimalPart}`;
        const uiDelta = parseFloat(uiDeltaStr);
        
        return {
          mint,
          delta: uiDelta,
          deltaRaw: rawDelta.toString(),
          decimals,
        };
      })
      .filter(x => Math.abs(x.delta) > 0.000001); // Filter out effectively zero deltas
  }

  /**
   * Parse trade details from a transaction
   * Uses balance deltas (preTokenBalances/postTokenBalances) as the primary source of truth
   */
  private async parseTradeDetails(
    decodedTx: DecodedTransaction,
    userAddress: string,
    fullAccountKeys: string[]
  ): Promise<DetectedTrade | null> {
    try {
      const { transaction, accountKeys } = decodedTx;
      
      // Use full account keys (with resolved lookup tables) if available
      const keysToUse = fullAccountKeys.length > accountKeys.length ? fullAccountKeys : accountKeys;
      
      // Get instructions from the transaction
      const instructions = this.getInstructions(transaction, keysToUse);
      
      // Identify aggregator by checking for actual swap instructions
      const aggregator = this.identifyAggregatorFromInstructions(instructions);
      
      if (aggregator === 'unknown') {
        return null; // Not an aggregator trade
      }

      // Use balance deltas as the primary source of truth
      const balanceDeltaTrade = await this.parseTradeDetailsFromBalanceDeltas(
        decodedTx,
        aggregator,
        userAddress,
        this.rpcConnection
      );
      
      if (balanceDeltaTrade) {
        return balanceDeltaTrade;
      }

      // If balance delta parsing fails, return null (don't create fallback trades)
      return null;
    } catch (error) {
      console.error('[TradeAnalyzer] Error parsing trade:', error);
      return null;
    }
  }


  /**
   * Get instructions from transaction
   */
  private getInstructions(
    transaction: Transaction | VersionedTransaction,
    accountKeys: string[]
  ): ParsedInstruction[] {
    const instructions: ParsedInstruction[] = [];

    if ('version' in transaction && transaction.message) {
      // Versioned transaction
      const message = transaction.message;
      const compiledInstructions = message.compiledInstructions;
      
      for (const ix of compiledInstructions) {
        const programId = accountKeys[ix.programIdIndex] || '';
        instructions.push({
          programId,
          accounts: ix.accountKeyIndexes.map(idx => accountKeys[idx] || ''),
          data: Buffer.from(ix.data),
        });
      }
    } else if ('instructions' in transaction) {
      // Legacy transaction
      const legacyTx = transaction as Transaction;
      for (const ix of legacyTx.instructions) {
        instructions.push({
          programId: ix.programId.toBase58(),
          accounts: ix.keys.map(k => k.pubkey.toBase58()),
          data: Buffer.from(ix.data),
        });
      }
    }

    return instructions;
  }



  /**
   * Check if instruction data starts with any of the given discriminators
   */
  private matchesDiscriminator(data: Uint8Array, discriminators: readonly Uint8Array[]): boolean {
    if (data.length < 8) return false;
    
    for (const discriminator of discriminators) {
      let matches = true;
      for (let i = 0; i < 8; i++) {
        if (data[i] !== discriminator[i]) {
          matches = false;
          break;
        }
      }
      if (matches) return true;
    }
    
    return false;
  }

  /**
   * Check if instruction is a valid DFlow swap instruction
   */
  private isDFlowSwapInstruction(data: Uint8Array): boolean {
    return this.matchesDiscriminator(data, DFLOW_SWAP_DISCRIMINATORS);
  }

  /**
   * Check if instruction is a valid OKX swap instruction
   */
  private isOkxSwapInstruction(data: Uint8Array): boolean {
    return this.matchesDiscriminator(data, OKX_SWAP_DISCRIMINATORS);
  }




  /**
   * Get statistics
   */
  getStats(): { tradeCount: number; aggregatorTradeCount: number; trackedUsers: number } {
    return {
      tradeCount: this.tradeCount,
      aggregatorTradeCount: this.aggregatorTradeCount,
      trackedUsers: this.trackedUsers.size,
    };
  }
}

/**
 * Parsed instruction structure
 */
interface ParsedInstruction {
  programId: string;
  accounts: string[];
  data: Buffer;
}



