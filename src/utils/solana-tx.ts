import { Transaction, VersionedTransaction, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import type { DecodedTransaction } from '../types/transaction.js';
import { readCompactU16 } from './binary.js';

/**
 * Measure the size of a transaction in Solana wire format.
 * Uses compact-u16 for variable-length fields.
 * Returns 0 if unable to determine size.
 */
export function measureTransactionSize(buffer: Uint8Array): number {
  try {
    let offset = 0;

    // Read number of signatures (compact-u16)
    const [numSigs, sigBytes] = readCompactU16(buffer, offset);
    offset += sigBytes;

    if (numSigs === 0 || numSigs > 64) {
      return 0;
    }

    // Skip signatures (64 bytes each)
    offset += numSigs * 64;
    if (offset >= buffer.length) return 0;

    // Check versioned vs legacy (first byte of message)
    const firstByte = buffer[offset];

    if (firstByte === 0x80) {
      // Versioned transaction (v0)
      offset += 1; // version byte

      // Message header
      if (offset + 3 > buffer.length) return 0;
      offset += 3; // num_required_signatures, num_readonly_signed, num_readonly_unsigned

      // Static account keys
      const [numStaticKeys, staticKeyBytes] = readCompactU16(buffer, offset);
      offset += staticKeyBytes;
      offset += numStaticKeys * 32;

      if (offset + 32 > buffer.length) return 0;
      offset += 32; // recent_blockhash

      // Instructions
      const [numInstructions, instrBytes] = readCompactU16(buffer, offset);
      offset += instrBytes;

      for (let i = 0; i < numInstructions; i++) {
        if (offset >= buffer.length) return 0;
        offset += 1; // program_id_index

        const [numAccounts, accBytes] = readCompactU16(buffer, offset);
        offset += accBytes;
        offset += numAccounts;

        const [dataLen, dataLenBytes] = readCompactU16(buffer, offset);
        offset += dataLenBytes;
        offset += dataLen;
      }

      // Address table lookups
      const [numLookups, lookupBytes] = readCompactU16(buffer, offset);
      offset += lookupBytes;

      for (let i = 0; i < numLookups; i++) {
        if (offset + 32 > buffer.length) return 0;
        offset += 32; // account key

        const [numWritable, wBytes] = readCompactU16(buffer, offset);
        offset += wBytes;
        offset += numWritable;

        const [numReadonly, rBytes] = readCompactU16(buffer, offset);
        offset += rBytes;
        offset += numReadonly;
      }
    } else {
      // Legacy transaction
      if (offset + 3 > buffer.length) return 0;
      offset += 3; // header

      const [numKeys, keyBytes] = readCompactU16(buffer, offset);
      offset += keyBytes;
      offset += numKeys * 32;

      if (offset + 32 > buffer.length) return 0;
      offset += 32; // recent_blockhash

      const [numInstructions, instrBytes] = readCompactU16(buffer, offset);
      offset += instrBytes;

      for (let i = 0; i < numInstructions; i++) {
        if (offset >= buffer.length) return 0;
        offset += 1; // program_id_index

        const [numAccounts, accBytes] = readCompactU16(buffer, offset);
        offset += accBytes;
        offset += numAccounts;

        const [dataLen, dataLenBytes] = readCompactU16(buffer, offset);
        offset += dataLenBytes;
        offset += dataLen;
      }
    }

    return offset;
  } catch {
    return 0;
  }
}

/**
 * Decode a transaction from bytes (legacy and versioned).
 */
export function decodeTransaction(txBytes: Uint8Array, slot: number): DecodedTransaction {
  try {
    // Try versioned transaction first
    try {
      const versionedTx = VersionedTransaction.deserialize(txBytes);
      const signature = bs58.encode(versionedTx.signatures[0]);

      const accountKeys = versionedTx.message.staticAccountKeys.map((key) => key.toBase58());
      // Lookup table keys are resolved elsewhere (if needed)

      return {
        signature,
        transaction: versionedTx,
        accountKeys,
        slot,
        isVersioned: true,
      };
    } catch {
      // Fall back to legacy transaction
      const legacyTx = Transaction.from(txBytes);
      // For legacy transactions, signature is already base58 if set (string)
      // If not set, try to get it from signatures array (SignaturePubkeyPair)
      let signature: string = '';
      if (legacyTx.signature && typeof legacyTx.signature === 'string') {
        signature = legacyTx.signature;
      } else if (legacyTx.signatures && legacyTx.signatures.length > 0) {
        // signatures is SignaturePubkeyPair[], we need the signature field
        const sigPair = legacyTx.signatures[0];
        if (sigPair && sigPair.signature) {
          const sigBytes = sigPair.signature instanceof Uint8Array 
            ? sigPair.signature 
            : new Uint8Array(sigPair.signature);
          signature = bs58.encode(sigBytes);
        }
      }

      const compiledMessage = legacyTx.compileMessage();
      const accountKeys = compiledMessage.accountKeys.map((key: PublicKey | string) => {
        if (typeof key === 'string') {
          return key;
        }
        return key.toBase58();
      });

      return {
        signature,
        transaction: legacyTx,
        accountKeys,
        slot,
        isVersioned: false,
      };
    }
  } catch (error) {
    throw new Error(`Failed to decode transaction: ${error}`);
  }
}

