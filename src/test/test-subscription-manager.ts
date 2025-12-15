/**
 * Unit tests for SubscriptionManager
 */
import { describe, it, expect, beforeEach } from '@jest/globals';
import { SubscriptionManager } from '../api/subscription-manager.js';
import { SubscriptionEvents } from '../constants/events.js';
import type { DetectedTrade } from '../types/trade.js';

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager();
  });

  describe('subscribe', () => {
    it('should subscribe a client to an address', () => {
      const clientId = 'client1';
      const address = 'address1';

      const result = manager.subscribe(clientId, address);

      expect(result).toBe(true);
      expect(manager.isAddressTracked(address)).toBe(true);
      expect(manager.getSubscriptionsForClient(clientId)).toContain(address);
      expect(manager.getSubscribersForAddress(address)).toContain(clientId);
    });

    it('should emit ADDRESS_ADDED event for new addresses', (done) => {
      const clientId = 'client1';
      const address = 'address1';

      manager.once(SubscriptionEvents.ADDRESS_ADDED, (addedAddress) => {
        expect(addedAddress).toBe(address);
        done();
      });

      manager.subscribe(clientId, address);
    });

    it('should not emit ADDRESS_ADDED for already tracked addresses', () => {
      const clientId1 = 'client1';
      const clientId2 = 'client2';
      const address = 'address1';

      let eventCount = 0;
      manager.on(SubscriptionEvents.ADDRESS_ADDED, () => {
        eventCount++;
      });

      manager.subscribe(clientId1, address);
      manager.subscribe(clientId2, address);

      expect(eventCount).toBe(1);
    });

    it('should allow multiple clients to subscribe to the same address', () => {
      const clientId1 = 'client1';
      const clientId2 = 'client2';
      const address = 'address1';

      manager.subscribe(clientId1, address);
      manager.subscribe(clientId2, address);

      const subscribers = manager.getSubscribersForAddress(address);
      expect(subscribers).toHaveLength(2);
      expect(subscribers).toContain(clientId1);
      expect(subscribers).toContain(clientId2);
    });

    it('should allow a client to subscribe to multiple addresses', () => {
      const clientId = 'client1';
      const address1 = 'address1';
      const address2 = 'address2';

      manager.subscribe(clientId, address1);
      manager.subscribe(clientId, address2);

      const subscriptions = manager.getSubscriptionsForClient(clientId);
      expect(subscriptions).toHaveLength(2);
      expect(subscriptions).toContain(address1);
      expect(subscriptions).toContain(address2);
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe a client from an address', () => {
      const clientId = 'client1';
      const address = 'address1';

      manager.subscribe(clientId, address);
      expect(manager.isAddressTracked(address)).toBe(true);

      const result = manager.unsubscribe(clientId, address);

      expect(result).toBe(true);
      expect(manager.getSubscriptionsForClient(clientId)).not.toContain(address);
      expect(manager.getSubscribersForAddress(address)).not.toContain(clientId);
    });

    it('should emit ADDRESS_REMOVED when last subscriber unsubscribes', (done) => {
      const clientId = 'client1';
      const address = 'address1';

      manager.subscribe(clientId, address);

      manager.once(SubscriptionEvents.ADDRESS_REMOVED, (removedAddress) => {
        expect(removedAddress).toBe(address);
        expect(manager.isAddressTracked(address)).toBe(false);
        done();
      });

      manager.unsubscribe(clientId, address);
    });

    it('should not emit ADDRESS_REMOVED when other subscribers remain', () => {
      const clientId1 = 'client1';
      const clientId2 = 'client2';
      const address = 'address1';

      manager.subscribe(clientId1, address);
      manager.subscribe(clientId2, address);

      let eventCount = 0;
      manager.on(SubscriptionEvents.ADDRESS_REMOVED, () => {
        eventCount++;
      });

      manager.unsubscribe(clientId1, address);

      expect(eventCount).toBe(0);
      expect(manager.isAddressTracked(address)).toBe(true);
      expect(manager.getSubscribersForAddress(address)).toContain(clientId2);
    });

    it('should handle unsubscribing from non-existent subscription gracefully', () => {
      const clientId = 'client1';
      const address = 'address1';

      const result = manager.unsubscribe(clientId, address);

      expect(result).toBe(true);
    });
  });

  describe('removeClient', () => {
    it('should remove a client and all their subscriptions', () => {
      const clientId = 'client1';
      const address1 = 'address1';
      const address2 = 'address2';

      manager.subscribe(clientId, address1);
      manager.subscribe(clientId, address2);

      manager.removeClient(clientId);

      expect(manager.getSubscriptionsForClient(clientId)).toHaveLength(0);
      expect(manager.getSubscribersForAddress(address1)).not.toContain(clientId);
      expect(manager.getSubscribersForAddress(address2)).not.toContain(clientId);
    });

    it('should emit ADDRESS_REMOVED for addresses that had no other subscribers', (done) => {
      const clientId = 'client1';
      const address1 = 'address1';
      const address2 = 'address2';

      manager.subscribe(clientId, address1);
      manager.subscribe(clientId, address2);

      const removedAddresses: string[] = [];
      manager.on(SubscriptionEvents.ADDRESS_REMOVED, (address) => {
        removedAddresses.push(address);
      });

      manager.removeClient(clientId);

      // Use setTimeout to allow events to fire
      setTimeout(() => {
        expect(removedAddresses).toContain(address1);
        expect(removedAddresses).toContain(address2);
        expect(removedAddresses).toHaveLength(2);
        done();
      }, 10);
    });

    it('should not remove addresses that have other subscribers', () => {
      const clientId1 = 'client1';
      const clientId2 = 'client2';
      const address = 'address1';

      manager.subscribe(clientId1, address);
      manager.subscribe(clientId2, address);

      manager.removeClient(clientId1);

      expect(manager.isAddressTracked(address)).toBe(true);
      expect(manager.getSubscribersForAddress(address)).toContain(clientId2);
    });

    it('should handle removing a non-existent client gracefully', () => {
      const clientId = 'client1';

      expect(() => {
        manager.removeClient(clientId);
      }).not.toThrow();
    });
  });

  describe('getSubscribersForAddress', () => {
    it('should return empty array for non-existent address', () => {
      const subscribers = manager.getSubscribersForAddress('address1');
      expect(subscribers).toEqual([]);
    });

    it('should return all subscribers for an address', () => {
      const clientId1 = 'client1';
      const clientId2 = 'client2';
      const clientId3 = 'client3';
      const address = 'address1';

      manager.subscribe(clientId1, address);
      manager.subscribe(clientId2, address);
      manager.subscribe(clientId3, address);

      const subscribers = manager.getSubscribersForAddress(address);
      expect(subscribers).toHaveLength(3);
      expect(subscribers).toContain(clientId1);
      expect(subscribers).toContain(clientId2);
      expect(subscribers).toContain(clientId3);
    });
  });

  describe('getSubscriptionsForClient', () => {
    it('should return empty array for non-existent client', () => {
      const subscriptions = manager.getSubscriptionsForClient('client1');
      expect(subscriptions).toEqual([]);
    });

    it('should return all addresses a client is subscribed to', () => {
      const clientId = 'client1';
      const address1 = 'address1';
      const address2 = 'address2';
      const address3 = 'address3';

      manager.subscribe(clientId, address1);
      manager.subscribe(clientId, address2);
      manager.subscribe(clientId, address3);

      const subscriptions = manager.getSubscriptionsForClient(clientId);
      expect(subscriptions).toHaveLength(3);
      expect(subscriptions).toContain(address1);
      expect(subscriptions).toContain(address2);
      expect(subscriptions).toContain(address3);
    });
  });

  describe('getTrackedAddresses', () => {
    it('should return empty array when no addresses are tracked', () => {
      const addresses = manager.getTrackedAddresses();
      expect(addresses).toEqual([]);
    });

    it('should return all tracked addresses', () => {
      const address1 = 'address1';
      const address2 = 'address2';
      const address3 = 'address3';

      manager.subscribe('client1', address1);
      manager.subscribe('client2', address2);
      manager.subscribe('client3', address3);

      const addresses = manager.getTrackedAddresses();
      expect(addresses).toHaveLength(3);
      expect(addresses).toContain(address1);
      expect(addresses).toContain(address2);
      expect(addresses).toContain(address3);
    });

    it('should not return addresses after all subscribers unsubscribe', () => {
      const clientId = 'client1';
      const address = 'address1';

      manager.subscribe(clientId, address);
      expect(manager.getTrackedAddresses()).toContain(address);

      manager.unsubscribe(clientId, address);
      expect(manager.getTrackedAddresses()).not.toContain(address);
    });
  });

  describe('isAddressTracked', () => {
    it('should return false for non-tracked address', () => {
      expect(manager.isAddressTracked('address1')).toBe(false);
    });

    it('should return true for tracked address', () => {
      const address = 'address1';
      manager.subscribe('client1', address);
      expect(manager.isAddressTracked(address)).toBe(true);
    });

    it('should return false after address is untracked', () => {
      const clientId = 'client1';
      const address = 'address1';

      manager.subscribe(clientId, address);
      expect(manager.isAddressTracked(address)).toBe(true);

      manager.unsubscribe(clientId, address);
      expect(manager.isAddressTracked(address)).toBe(false);
    });
  });

  describe('handleTrade', () => {
    it('should emit TRADE_NOTIFICATION for each subscriber', (done) => {
      const clientId1 = 'client1';
      const clientId2 = 'client2';
      const address = 'address1';

      manager.subscribe(clientId1, address);
      manager.subscribe(clientId2, address);

      const notifications: Array<{ clientId: string; notification: any }> = [];
      manager.on(SubscriptionEvents.TRADE_NOTIFICATION, (clientId, notification) => {
        notifications.push({ clientId, notification });
      });

      const trade: DetectedTrade = {
        signature: 'sig1',
        slot: 100,
        direction: 'buy',
        tokenMint: 'token1',
        usdcAmount: 100,
        tokenAmount: BigInt(1000),
        userAddress: address,
        aggregator: 'okx',
        detectedAt: new Date(),
      };

      manager.handleTrade(trade);

      setTimeout(() => {
        expect(notifications).toHaveLength(2);
        expect(notifications[0].clientId).toBe(clientId1);
        expect(notifications[1].clientId).toBe(clientId2);
        expect(notifications[0].notification.trade).toEqual(trade);
        expect(notifications[1].notification.trade).toEqual(trade);
        done();
      }, 10);
    });

    it('should not emit TRADE_NOTIFICATION if no subscribers', () => {
      const address = 'address1';
      let eventFired = false;

      manager.on(SubscriptionEvents.TRADE_NOTIFICATION, () => {
        eventFired = true;
      });

      const trade: DetectedTrade = {
        signature: 'sig1',
        slot: 100,
        direction: 'buy',
        tokenMint: 'token1',
        usdcAmount: 100,
        tokenAmount: BigInt(1000),
        userAddress: address,
        aggregator: 'okx',
        detectedAt: new Date(),
      };

      manager.handleTrade(trade);

      expect(eventFired).toBe(false);
    });

    it('should create notification with correct structure', (done) => {
      const clientId = 'client1';
      const address = 'address1';

      manager.subscribe(clientId, address);

      manager.once(SubscriptionEvents.TRADE_NOTIFICATION, (notifiedClientId, notification) => {
        expect(notifiedClientId).toBe(clientId);
        expect(notification.type).toBe('trade');
        expect(notification.address).toBe(address);
        expect(notification.trade).toBeDefined();
        expect(notification.timestamp).toBeDefined();
        expect(new Date(notification.timestamp).getTime()).toBeLessThanOrEqual(Date.now());
        done();
      });

      const trade: DetectedTrade = {
        signature: 'sig1',
        slot: 100,
        direction: 'sell',
        tokenMint: 'token1',
        usdcAmount: 50,
        tokenAmount: BigInt(500),
        userAddress: address,
        aggregator: 'dflow',
        detectedAt: new Date(),
      };

      manager.handleTrade(trade);
    });
  });

  describe('getStats', () => {
    it('should return zero stats when empty', () => {
      const stats = manager.getStats();
      expect(stats.totalClients).toBe(0);
      expect(stats.totalAddresses).toBe(0);
      expect(stats.totalSubscriptions).toBe(0);
    });

    it('should correctly count clients', () => {
      manager.subscribe('client1', 'address1');
      manager.subscribe('client2', 'address1');
      manager.subscribe('client3', 'address2');

      const stats = manager.getStats();
      expect(stats.totalClients).toBe(3);
    });

    it('should correctly count addresses', () => {
      manager.subscribe('client1', 'address1');
      manager.subscribe('client2', 'address2');
      manager.subscribe('client3', 'address3');

      const stats = manager.getStats();
      expect(stats.totalAddresses).toBe(3);
    });

    it('should correctly count total subscriptions', () => {
      manager.subscribe('client1', 'address1');
      manager.subscribe('client1', 'address2');
      manager.subscribe('client2', 'address1');
      manager.subscribe('client3', 'address3');

      const stats = manager.getStats();
      expect(stats.totalSubscriptions).toBe(4);
    });

    it('should update stats when clients unsubscribe', () => {
      manager.subscribe('client1', 'address1');
      manager.subscribe('client2', 'address1');
      manager.subscribe('client3', 'address2');

      expect(manager.getStats().totalClients).toBe(3);
      expect(manager.getStats().totalSubscriptions).toBe(3);

      manager.unsubscribe('client1', 'address1');

      const stats = manager.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.totalSubscriptions).toBe(2);
      expect(stats.totalAddresses).toBe(2);
    });
  });
});

// Simple test runner for Node.js (if not using Jest/Mocha)
if (require.main === module) {
  const results = {
    passed: 0,
    failed: 0,
    errors: [] as Array<{ test: string; error: Error }>,
  };

  function expect(value: any) {
    return {
      toBe(expected: any) {
        if (value !== expected) {
          throw new Error(`Expected ${value} to be ${expected}`);
        }
      },
      toContain(expected: any) {
        if (!value.includes(expected)) {
          throw new Error(`Expected ${JSON.stringify(value)} to contain ${expected}`);
        }
      },
      toHaveLength(expected: number) {
        if (value.length !== expected) {
          throw new Error(`Expected length ${expected}, got ${value.length}`);
        }
      },
      toEqual(expected: any) {
        if (JSON.stringify(value) !== JSON.stringify(expected)) {
          throw new Error(`Expected ${JSON.stringify(value)} to equal ${JSON.stringify(expected)}`);
        }
      },
      toBeDefined() {
        if (value === undefined) {
          throw new Error(`Expected value to be defined`);
        }
      },
      toBeLessThanOrEqual(expected: number) {
        if (value > expected) {
          throw new Error(`Expected ${value} to be less than or equal to ${expected}`);
        }
      },
      not: {
        toThrow() {
          // This is a no-op - we'll catch errors manually
        },
        toContain(expected: any) {
          if (value.includes(expected)) {
            throw new Error(`Expected ${JSON.stringify(value)} not to contain ${expected}`);
          }
        },
      },
    };
  }

  async function runTests() {
    const tests = [
      { name: 'subscribe basic', fn: async () => {
        const manager = new SubscriptionManager();
        manager.subscribe('client1', 'address1');
        expect(manager.isAddressTracked('address1')).toBe(true);
      }},
      { name: 'unsubscribe basic', fn: async () => {
        const manager = new SubscriptionManager();
        manager.subscribe('client1', 'address1');
        manager.unsubscribe('client1', 'address1');
        expect(manager.isAddressTracked('address1')).toBe(false);
      }},
      { name: 'removeClient', fn: async () => {
        const manager = new SubscriptionManager();
        manager.subscribe('client1', 'address1');
        manager.subscribe('client1', 'address2');
        manager.removeClient('client1');
        expect(manager.getSubscriptionsForClient('client1')).toHaveLength(0);
      }},
      { name: 'handleTrade emits notifications', fn: async () => {
        const manager = new SubscriptionManager();
        manager.subscribe('client1', 'address1');
        let notified = false;
        manager.on(SubscriptionEvents.TRADE_NOTIFICATION, () => {
          notified = true;
        });
        const trade: DetectedTrade = {
          signature: 'sig1',
          slot: 100,
          direction: 'buy',
          tokenMint: 'token1',
          usdcAmount: 100,
          tokenAmount: BigInt(1000),
          userAddress: 'address1',
          aggregator: 'okx',
          detectedAt: new Date(),
        };
        manager.handleTrade(trade);
        await new Promise(resolve => setTimeout(resolve, 10));
        expect(notified).toBe(true);
      }},
      { name: 'getStats', fn: async () => {
        const manager = new SubscriptionManager();
        manager.subscribe('client1', 'address1');
        manager.subscribe('client2', 'address1');
        const stats = manager.getStats();
        expect(stats.totalClients).toBe(2);
        expect(stats.totalAddresses).toBe(1);
        expect(stats.totalSubscriptions).toBe(2);
      }},
    ];

    for (const test of tests) {
      try {
        await test.fn();
        results.passed++;
        console.log(`✓ ${test.name}`);
      } catch (error: any) {
        results.failed++;
        results.errors.push({ test: test.name, error });
        console.error(`✗ ${test.name}: ${error.message}`);
      }
    }

    console.log(`\n${results.passed} passed, ${results.failed} failed`);
    process.exit(results.failed > 0 ? 1 : 0);
  }

  runTests();
}

