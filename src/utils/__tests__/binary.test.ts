import { describe, it, expect } from '@jest/globals';
import { readU32, readU64, readCompactU16 } from '../binary.js';

describe('binary utilities', () => {
  describe('readU32', () => {
    it('should read a 32-bit unsigned integer (little-endian)', () => {
      // 0x12345678 in little-endian: [0x78, 0x56, 0x34, 0x12]
      const buffer = new Uint8Array([0x78, 0x56, 0x34, 0x12]);
      expect(readU32(buffer, 0)).toBe(0x12345678);
    });

    it('should read from specific offset', () => {
      const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x78, 0x56, 0x34, 0x12]);
      expect(readU32(buffer, 4)).toBe(0x12345678);
    });

    it('should handle maximum 32-bit unsigned value', () => {
      // 0xFFFFFFFF
      const buffer = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF]);
      expect(readU32(buffer, 0)).toBe(0xFFFFFFFF);
    });

    it('should handle zero', () => {
      const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00]);
      expect(readU32(buffer, 0)).toBe(0);
    });
  });

  describe('readU64', () => {
    it('should read a 64-bit unsigned integer (little-endian)', () => {
      // 0x123456789ABCDEF0 in little-endian: [0xF0, 0xDE, 0xBC, 0x9A, 0x78, 0x56, 0x34, 0x12]
      const buffer = new Uint8Array([0xF0, 0xDE, 0xBC, 0x9A, 0x78, 0x56, 0x34, 0x12]);
      expect(readU64(buffer, 0)).toBe(BigInt('0x123456789ABCDEF0'));
    });

    it('should read from specific offset', () => {
      const buffer = new Uint8Array([0x00, 0x00, 0xF0, 0xDE, 0xBC, 0x9A, 0x78, 0x56, 0x34, 0x12]);
      expect(readU64(buffer, 2)).toBe(BigInt('0x123456789ABCDEF0'));
    });

    it('should handle zero', () => {
      const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
      expect(readU64(buffer, 0)).toBe(BigInt(0));
    });

    it('should handle large values', () => {
      // Maximum 64-bit unsigned: 0xFFFFFFFFFFFFFFFF
      const buffer = new Uint8Array([0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
      expect(readU64(buffer, 0)).toBe(BigInt('0xFFFFFFFFFFFFFFFF'));
    });
  });

  describe('readCompactU16', () => {
    it('should read single-byte compact-u16 (< 0x80)', () => {
      const buffer = new Uint8Array([0x42]);
      const [value, bytesConsumed] = readCompactU16(buffer, 0);
      expect(value).toBe(0x42);
      expect(bytesConsumed).toBe(1);
    });

    it('should read two-byte compact-u16', () => {
      // 0x81 = 0x80 | 1, second byte = 0x02
      // Value = (0x81 & 0x7F) | (0x02 << 7) = 0x01 | 0x0100 = 0x0101
      const buffer = new Uint8Array([0x81, 0x02]);
      const [value, bytesConsumed] = readCompactU16(buffer, 0);
      expect(value).toBe(0x0101);
      expect(bytesConsumed).toBe(2);
    });

    it('should read three-byte compact-u16', () => {
      // First byte = 0xFF, second = 0xFF, third = 0x03
      // Value = (0xFF & 0x7F) | ((0xFF & 0x7F) << 7) | (0x03 << 14)
      //       = 0x7F | 0x3F80 | 0xC000 = 0xFFFF
      const buffer = new Uint8Array([0xFF, 0xFF, 0x03]);
      const [value, bytesConsumed] = readCompactU16(buffer, 0);
      expect(value).toBe(0xFFFF);
      expect(bytesConsumed).toBe(3);
    });

    it('should return [0, 0] if offset >= buffer.length', () => {
      const buffer = new Uint8Array([0x42]);
      const [value, bytesConsumed] = readCompactU16(buffer, 1);
      expect(value).toBe(0);
      expect(bytesConsumed).toBe(0);
    });

    it('should return [0, 0] if buffer too short for two-byte', () => {
      const buffer = new Uint8Array([0x81]); // Needs second byte
      const [value, bytesConsumed] = readCompactU16(buffer, 0);
      expect(value).toBe(0);
      expect(bytesConsumed).toBe(0);
    });

    it('should return [0, 0] if buffer too short for three-byte', () => {
      const buffer = new Uint8Array([0xFF, 0xFF]); // Needs third byte
      const [value, bytesConsumed] = readCompactU16(buffer, 0);
      expect(value).toBe(0);
      expect(bytesConsumed).toBe(0);
    });

    it('should read from specific offset', () => {
      const buffer = new Uint8Array([0x00, 0x42]);
      const [value, bytesConsumed] = readCompactU16(buffer, 1);
      expect(value).toBe(0x42);
      expect(bytesConsumed).toBe(1);
    });
  });
});

