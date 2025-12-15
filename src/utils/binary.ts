/**
 * Binary helpers for reading little-endian values and Solana compact-u16.
 */

export function readU32(buffer: Uint8Array, offset: number): number {
  return (
    buffer[offset] |
    (buffer[offset + 1] << 8) |
    (buffer[offset + 2] << 16) |
    (buffer[offset + 3] << 24)
  ) >>> 0; // Convert to unsigned
}

export function readU64(buffer: Uint8Array, offset: number): bigint {
  const low = readU32(buffer, offset);
  const high = readU32(buffer, offset + 4);
  return BigInt(low) | (BigInt(high) << 32n);
}

/**
 * Read a compact-u16 from buffer (Solana's variable-length encoding)
 * Returns [value, bytesConsumed]
 */
export function readCompactU16(buffer: Uint8Array, offset: number): [number, number] {
  if (offset >= buffer.length) return [0, 0];

  const byte1 = buffer[offset];
  if (byte1 < 0x80) {
    return [byte1, 1];
  }

  if (offset + 1 >= buffer.length) return [0, 0];
  const byte2 = buffer[offset + 1];
  if (byte2 < 0x80) {
    return [((byte1 & 0x7f) | (byte2 << 7)), 2];
  }

  if (offset + 2 >= buffer.length) return [0, 0];
  const byte3 = buffer[offset + 2];
  return [((byte1 & 0x7f) | ((byte2 & 0x7f) << 7) | (byte3 << 14)), 3];
}

