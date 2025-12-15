/**
 * Transaction-related type definitions
 */

import { Transaction, VersionedTransaction } from '@solana/web3.js';

/**
 * Decoded transaction from Solana Entry
 */
export interface DecodedTransaction {
  /** Transaction signature */
  signature: string;
  /** Transaction object (legacy or versioned) */
  transaction: Transaction | VersionedTransaction;
  /** Account keys involved in the transaction */
  accountKeys: string[];
  /** Slot number */
  slot: number;
  /** Whether this is a versioned transaction */
  isVersioned: boolean;
}

