import { readU64 } from './binary.js';
import { measureTransactionSize } from './solana-tx.js';

export interface SolanaEntry {
  numHashes: bigint;
  hash: Uint8Array;
  transactions: Uint8Array[];
}

/**
 * Deserialize Vec<Entry> from bincode-encoded bytes
 * Based on solana_entry::Entry structure
 */
export function deserializeEntries(entriesBytes: Uint8Array): SolanaEntry[] {
  try {
    // Solana entries are serialized with bincode
    // Bincode uses u64 for Vec lengths
    // Vec<Entry> is encoded as:
    // - length (u64): number of entries
    // - For each entry:
    //   - num_hashes (u64): number of hashes
    //   - hash (u8[32]): hash value
    //   - transactions Vec length (u64): number of transactions
    //   - transactions: each serialized in wire format

    const reader = new Uint8Array(entriesBytes);
    let offset = 0;

    // Read vector length (u64, little-endian) - bincode uses u64!
    const length = Number(readU64(reader, offset));
    offset += 8;

    const entries: SolanaEntry[] = [];

    for (let i = 0; i < length; i++) {
      // Read num_hashes (u64, little-endian)
      const numHashes = readU64(reader, offset);
      offset += 8;

      // Read hash (32 bytes)
      const hash = reader.slice(offset, offset + 32);
      offset += 32;

      // transactions is Vec<VersionedTransaction>
      // Bincode uses u64 for Vec length
      if (offset + 8 > entriesBytes.length) {
        throw new Error(`Cannot read transaction Vec length at offset ${offset}`);
      }
      
      const txCount = Number(readU64(reader, offset));
      offset += 8;

      const transactions: Uint8Array[] = [];
      
      if (txCount > 0) {
        // Has transactions - need to deserialize each to find boundaries
        for (let t = 0; t < txCount; t++) {
          if (offset >= entriesBytes.length) {
            break;
          }
          
          // Try to parse one transaction and determine its size
          const remaining = entriesBytes.slice(offset);
          const txSize = measureTransactionSize(remaining);
          
          if (txSize === 0) {
            break;
          }
          
          const txBytes = entriesBytes.slice(offset, offset + txSize);
          transactions.push(txBytes);
          offset += txSize;
        }
      }

      entries.push({
        numHashes,
        hash,
        transactions,
      });
    }

    return entries;
  } catch (error) {
    throw new Error(`Failed to deserialize entries: ${error}`);
  }
}

