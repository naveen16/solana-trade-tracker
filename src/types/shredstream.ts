/**
 * Shredstream-related type definitions
 * Based on official Jito Shredstream proto definitions
 * 
 * Note on Shreds vs Entries:
 * - **Shreds** = Raw network-level packets (~1200 bytes) used to transmit data
 * - **Entries** = Structured lists of transactions (packed into shreds for transmission)
 * - **Transactions** = Individual operations
 * 
 * The Jito Shredstream proxy:
 * 1. Receives raw shreds from the network
 * 2. Deshreds them (reconstructs entries from shreds)
 * 3. Returns Entry messages containing serialized Vec<Entry> bytes
 * 
 * We need to deserialize Entry.entries (bytes) to get actual Solana Entry objects,
 * then extract transactions from those entries.
 */

export interface Entry {
  /** The slot that the entry is from */
  slot: number;
  /** 
   * Serialized bytes of Vec<Entry> from Solana
   * This is Borsh-encoded Vec<solana_entry::Entry>
   * Each Solana Entry contains zero or more transactions
   * Reference: https://docs.rs/solana-entry/latest/solana_entry/entry/struct.Entry.html
   */
  entries: Uint8Array;
}

export interface ShredstreamClientConfig {
  endpoint: string;
  reconnectDelay?: number;
  maxReconnectAttempts?: number;
}
