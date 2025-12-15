import { describe, it, expect, beforeEach } from '@jest/globals';
import { SubscriptionManager } from '../subscription-manager.js';
import { SubscriptionEvents } from '../../constants/events.js';
import type { DetectedTrade } from '../../types/trade.js';

describe('SubscriptionManager', () => {
  let manager: SubscriptionManager;

  beforeEach(() => {
    manager = new SubscriptionManager();
  });

  describe('subscribe', () => {
    it('should subscribe a client to an address', () => {
      const result = manager.subscribe('client1', 'address1');
      expect(result).toBe(true);
      expect(manager.isAddressTracked('address1')).toBe(true);
      expect(manager.getSubscriptionsForClient('client1')).toContain('address1');
      expect(manager.getSubscribersForAddress('address1')).toContain('client1');
    });

    it('should emit ADDRESS_ADDED for new addresses', (done) => {
      manager.once(SubscriptionEvents.ADDRESS_ADDED, (address) => {
        expect(address).toBe('address1');
        done();
      });
      manager.subscribe('client1', 'address1');
    });

    it('should allow multiple clients to subscribe to same address', () => {
      manager.subscribe('client1', 'address1');
      manager.subscribe('client2', 'address1');
      const subscribers = manager.getSubscribersForAddress('address1');
      expect(subscribers).toHaveLength(2);
      expect(subscribers).toContain('client1');
      expect(subscribers).toContain('client2');
    });
  });

  describe('unsubscribe', () => {
    it('should unsubscribe a client from an address', () => {
      manager.subscribe('client1', 'address1');
      manager.unsubscribe('client1', 'address1');
      expect(manager.isAddressTracked('address1')).toBe(false);
    });

    it('should emit ADDRESS_REMOVED when last subscriber unsubscribes', (done) => {
      manager.subscribe('client1', 'address1');
      manager.once(SubscriptionEvents.ADDRESS_REMOVED, (address) => {
        expect(address).toBe('address1');
        done();
      });
      manager.unsubscribe('client1', 'address1');
    });
  });

  describe('removeClient', () => {
    it('should remove all subscriptions for a client', () => {
      manager.subscribe('client1', 'address1');
      manager.subscribe('client1', 'address2');
      manager.removeClient('client1');
      expect(manager.getSubscriptionsForClient('client1')).toHaveLength(0);
    });
  });

  describe('handleTrade', () => {
    it('should emit TRADE_NOTIFICATION for subscribers', (done) => {
      manager.subscribe('client1', 'address1');
      let notified = false;
      
      manager.on(SubscriptionEvents.TRADE_NOTIFICATION, (clientId, notification) => {
        expect(clientId).toBe('client1');
        expect(notification.address).toBe('address1');
        expect(notification.trade.userAddress).toBe('address1');
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
      
      setTimeout(() => {
        expect(notified).toBe(true);
        done();
      }, 10);
    });

    it('should not emit if no subscribers', () => {
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
        userAddress: 'address1',
        aggregator: 'okx',
        detectedAt: new Date(),
      };

      manager.handleTrade(trade);
      expect(eventFired).toBe(false);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      manager.subscribe('client1', 'address1');
      manager.subscribe('client1', 'address2');
      manager.subscribe('client2', 'address1');
      
      const stats = manager.getStats();
      expect(stats.totalClients).toBe(2);
      expect(stats.totalAddresses).toBe(2);
      expect(stats.totalSubscriptions).toBe(3);
    });
  });
});

