/**
 * Transaction Processor
 * Deserializes Solana entries and extracts transactions
 */

import { EventEmitter } from 'events';
import { ShredstreamEvents, TransactionEvents } from '../constants/events.js';
import { deserializeEntries } from '../utils/entries.js';
import { decodeTransaction } from '../utils/solana-tx.js';
import type { Entry } from '../types/shredstream.js';

/**
 * Processes entries from Shredstream and extracts transactions
 * Emits 'transaction' events for decoded transactions
 */
export class TransactionProcessor extends EventEmitter {
  /**
   * Subscribe to entry events from ShredstreamClient
   */
  subscribe(shredstreamClient: EventEmitter): void {
    shredstreamClient.on(ShredstreamEvents.ENTRY, (entry: Entry) => {
      // Process asynchronously to avoid blocking event loop
      setImmediate(() => {
        this.processEntry(entry).catch((error) => {
          console.error(`[ERROR] Error processing entry at slot ${entry.slot}:`, error);
          this.emit(TransactionEvents.ERROR, error);
        });
      });
    });
  }

  /**
   * Process an Entry from Shredstream
   * Deserializes the Vec<Entry> bytes and extracts transactions
   */
  async processEntry(entry: Entry): Promise<void> {
    if (entry.entries.length === 0) {
      return;
    }

    try {
      // Deserialize Vec<Entry> from bincode-encoded bytes
      const solanaEntries = deserializeEntries(entry.entries);

      // Process each Solana Entry
      for (const solanaEntry of solanaEntries) {
        // deserializeEntries already extracts individual transactions
        for (const txBytes of solanaEntry.transactions) {
          try {
            const decodedTx = decodeTransaction(txBytes, entry.slot);
            this.emit(TransactionEvents.TRANSACTION, decodedTx);
          } catch (error) {
            // Emit decode errors for debugging
            this.emit(TransactionEvents.DECODE_ERROR, {
              error: error instanceof Error ? error.message : String(error),
              slot: entry.slot,
              txBytesLength: txBytes.length,
            });
            continue;
          }
        }
      }
    } catch (error) {
      // Log deserialization errors to help debug
      console.error(`Error processing entry at slot ${entry.slot}:`, error);
      this.emit(TransactionEvents.ERROR, error);
    }
  }
}

