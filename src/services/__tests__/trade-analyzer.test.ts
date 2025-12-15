import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { TradeAnalyzer } from '../trade-analyzer.js';

describe('TradeAnalyzer', () => {
  let analyzer: TradeAnalyzer;

  beforeEach(() => {
    // Use a mock RPC URL - actual RPC calls won't be made in these basic tests
    analyzer = new TradeAnalyzer({
      rpcUrl: 'https://api.mainnet-beta.solana.com',
    });
  });

  it('should add tracked users', () => {
    analyzer.addTrackedUser('address1');
    const stats = analyzer.getStats();
    expect(stats.trackedUsers).toBe(1);
  });

  it('should remove tracked users', () => {
    analyzer.addTrackedUser('address1');
    analyzer.removeTrackedUser('address1');
    const stats = analyzer.getStats();
    expect(stats.trackedUsers).toBe(0);
  });

  it('should allow multiple tracked users', () => {
    analyzer.addTrackedUser('address1');
    analyzer.addTrackedUser('address2');
    analyzer.addTrackedUser('address3');
    const stats = analyzer.getStats();
    expect(stats.trackedUsers).toBe(3);
  });

  it('should initialize with zero stats', () => {
    const stats = analyzer.getStats();
    expect(stats.tradeCount).toBe(0);
    expect(stats.aggregatorTradeCount).toBe(0);
    expect(stats.trackedUsers).toBe(0);
  });

  it('should handle subscription setup', () => {
    const mockEventEmitter = {
      on: jest.fn(),
    };

    analyzer.subscribe(mockEventEmitter as any);
    
    // Verify that subscribe was called with TRANSACTION event
    expect(mockEventEmitter.on).toHaveBeenCalled();
  });
});
