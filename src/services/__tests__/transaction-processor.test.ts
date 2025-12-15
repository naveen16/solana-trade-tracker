import { describe, it, expect, beforeEach } from '@jest/globals';
import { EventEmitter } from 'events';
import { TransactionProcessor } from '../transaction-processor.js';
import { ShredstreamEvents, TransactionEvents } from '../../constants/events.js';
import type { Entry } from '../../types/shredstream.js';

describe('TransactionProcessor', () => {
  let processor: TransactionProcessor;
  let mockShredstream: EventEmitter;

  beforeEach(() => {
    processor = new TransactionProcessor();
    mockShredstream = new EventEmitter();
    processor.subscribe(mockShredstream);
  });

  it('should handle empty entry with no transactions', (done) => {
    // Create a minimal valid entry with empty transactions array
    const entry: Entry = {
      slot: 1000,
      entries: new Uint8Array([
        // Length: 1 entry (u64)
        1, 0, 0, 0, 0, 0, 0, 0,
        // num_hashes (u64)
        100, 0, 0, 0, 0, 0, 0, 0,
        // hash (32 bytes)
        ...Array(32).fill(0),
        // tx_count (u64)
        0, 0, 0, 0, 0, 0, 0, 0,
      ]),
    };

    let transactionFired = false;
    processor.on(TransactionEvents.TRANSACTION, () => {
      transactionFired = true;
    });

    mockShredstream.emit(ShredstreamEvents.ENTRY, entry);
    
    // Should not fire transaction event for empty transactions
    setTimeout(() => {
      expect(transactionFired).toBe(false);
      done();
    }, 100);
  }, 1000);

  it('should emit ERROR event on invalid entry', (done) => {
    processor.on(TransactionEvents.ERROR, () => {
      done();
    });

    const invalidEntry: Entry = {
      slot: 1000,
      entries: new Uint8Array([0xFF]), // Invalid data
    };

    mockShredstream.emit(ShredstreamEvents.ENTRY, invalidEntry);
  });

  it('should handle empty entries array', () => {
    const entry: Entry = {
      slot: 1000,
      entries: new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0]), // length = 0
    };

    let eventFired = false;
    processor.on(TransactionEvents.TRANSACTION, () => {
      eventFired = true;
    });

    mockShredstream.emit(ShredstreamEvents.ENTRY, entry);
    
    // Should not fire transaction event for empty entries
    setTimeout(() => {
      expect(eventFired).toBe(false);
    }, 100);
  });
});

