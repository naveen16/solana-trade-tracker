import { describe, it, expect } from '@jest/globals';
import { deserializeEntries } from '../entries.js';

// Helper to create test entry bytes
function createEntryBytes(entries: Array<{ numHashes: bigint; hash: Uint8Array; txCount: number; transactions: Uint8Array[] }>): Uint8Array {
  const parts: Uint8Array[] = [];
  
  // Write length (u64)
  const lengthBuffer = new Uint8Array(8);
  const lengthView = new DataView(lengthBuffer.buffer);
  lengthView.setBigUint64(0, BigInt(entries.length), true);
  parts.push(lengthBuffer);
  
  for (const entry of entries) {
    // Write num_hashes (u64)
    const numHashesBuffer = new Uint8Array(8);
    const numHashesView = new DataView(numHashesBuffer.buffer);
    numHashesView.setBigUint64(0, entry.numHashes, true);
    parts.push(numHashesBuffer);
    
    // Write hash (32 bytes)
    if (entry.hash.length !== 32) {
      throw new Error('Hash must be 32 bytes');
    }
    parts.push(entry.hash);
    
    // Write transaction count (u64)
    const txCountBuffer = new Uint8Array(8);
    const txCountView = new DataView(txCountBuffer.buffer);
    txCountView.setBigUint64(0, BigInt(entry.txCount), true);
    parts.push(txCountBuffer);
    
    // Write transactions
    for (const tx of entry.transactions) {
      parts.push(tx);
    }
  }
  
  // Concatenate all parts
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  
  return result;
}

describe('entries utilities', () => {
  describe('deserializeEntries', () => {
    it('should deserialize empty entries array', () => {
      const entriesBytes = createEntryBytes([]);
      const entries = deserializeEntries(entriesBytes);
      expect(entries).toHaveLength(0);
    });

    it('should deserialize single entry with no transactions', () => {
      const hash = new Uint8Array(32).fill(0xAA);
      const entriesBytes = createEntryBytes([
        { numHashes: BigInt(100), hash, txCount: 0, transactions: [] },
      ]);
      
      const entries = deserializeEntries(entriesBytes);
      expect(entries).toHaveLength(1);
      expect(entries[0].numHashes).toBe(BigInt(100));
      expect(entries[0].hash).toEqual(hash);
      expect(entries[0].transactions).toHaveLength(0);
    });

    it('should deserialize multiple entries', () => {
      const hash1 = new Uint8Array(32).fill(0x11);
      const hash2 = new Uint8Array(32).fill(0x22);
      
      // Note: This test doesn't include actual transaction bytes because
      // measureTransactionSize would need valid transaction format
      // For a full test, we'd need to create valid transaction wire format
      const entriesBytes = createEntryBytes([
        { numHashes: BigInt(100), hash: hash1, txCount: 0, transactions: [] },
        { numHashes: BigInt(200), hash: hash2, txCount: 0, transactions: [] },
      ]);
      
      const entries = deserializeEntries(entriesBytes);
      expect(entries).toHaveLength(2);
      expect(entries[0].numHashes).toBe(BigInt(100));
      expect(entries[0].hash).toEqual(hash1);
      expect(entries[1].numHashes).toBe(BigInt(200));
      expect(entries[1].hash).toEqual(hash2);
    });

    it('should throw error on invalid data', () => {
      const invalidBytes = new Uint8Array([0xFF, 0xFF]); // Too short
      expect(() => deserializeEntries(invalidBytes)).toThrow();
    });
  });
});

