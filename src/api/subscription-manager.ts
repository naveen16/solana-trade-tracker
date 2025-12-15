/**
 * Subscription Manager
 * 
 * Manages subscriptions to Solana addresses for trade notifications.
 * Tracks which clients are subscribed to which addresses.
 */

import { EventEmitter } from 'events';
import type { DetectedTrade } from '../types/trade.js';
import { SubscriptionEvents } from '../constants/events.js';

export interface Subscription {
  clientId: string;
  address: string;
  subscribedAt: Date;
}

export interface TradeNotification {
  type: 'trade';
  address: string;
  trade: DetectedTrade;
  timestamp: string;
}

export class SubscriptionManager extends EventEmitter {
  // Maps address -> set of client IDs subscribed to that address
  private addressSubscriptions: Map<string, Set<string>> = new Map();
  // Maps client ID -> set of addresses that client is subscribed to
  private clientSubscriptions: Map<string, Set<string>> = new Map();
  // All addresses currently being tracked (for quick lookup)
  private trackedAddresses: Set<string> = new Set();

  /**
   * Subscribe a client to receive trade notifications for an address
   */
  subscribe(clientId: string, address: string): boolean {
    if (!this.addressSubscriptions.has(address)) {
      this.addressSubscriptions.set(address, new Set());
    }
    this.addressSubscriptions.get(address)!.add(clientId);

    if (!this.clientSubscriptions.has(clientId)) {
      this.clientSubscriptions.set(clientId, new Set());
    }
    this.clientSubscriptions.get(clientId)!.add(address);

    const isNewAddress = !this.trackedAddresses.has(address);
    this.trackedAddresses.add(address);

    if (isNewAddress) {
      this.emit(SubscriptionEvents.ADDRESS_ADDED, address);
    }

    return true;
  }

  /**
   * Unsubscribe a client from an address
   */
  unsubscribe(clientId: string, address: string): boolean {
    const addressClients = this.addressSubscriptions.get(address);
    if (addressClients) {
      addressClients.delete(clientId);
      if (addressClients.size === 0) {
        this.addressSubscriptions.delete(address);
        this.trackedAddresses.delete(address);
        this.emit(SubscriptionEvents.ADDRESS_REMOVED, address);
      }
    }

    const clientAddresses = this.clientSubscriptions.get(clientId);
    if (clientAddresses) {
      clientAddresses.delete(address);
      if (clientAddresses.size === 0) {
        this.clientSubscriptions.delete(clientId);
      }
    }

    return true;
  }

  /**
   * Remove a client and all their subscriptions (called on disconnect)
   */
  removeClient(clientId: string): void {
    const clientAddresses = this.clientSubscriptions.get(clientId);
    if (clientAddresses) {
      for (const address of clientAddresses) {
        this.unsubscribe(clientId, address);
      }
    }
    this.clientSubscriptions.delete(clientId);
  }

  getSubscribersForAddress(address: string): string[] {
    const subscribers = this.addressSubscriptions.get(address);
    return subscribers ? Array.from(subscribers) : [];
  }

  getSubscriptionsForClient(clientId: string): string[] {
    const addresses = this.clientSubscriptions.get(clientId);
    return addresses ? Array.from(addresses) : [];
  }

  getTrackedAddresses(): string[] {
    return Array.from(this.trackedAddresses);
  }

  isAddressTracked(address: string): boolean {
    return this.trackedAddresses.has(address);
  }

  /**
   * Handle an incoming trade and notify all subscribers
   */
  handleTrade(trade: DetectedTrade): void {
    const address = trade.userAddress;
    const subscribers = this.getSubscribersForAddress(address);

    if (subscribers.length === 0) {
      return;
    }

    const notification: TradeNotification = {
      type: 'trade',
      address,
      trade,
      timestamp: new Date().toISOString(),
    };

    for (const clientId of subscribers) {
      this.emit(SubscriptionEvents.TRADE_NOTIFICATION, clientId, notification);
    }

    console.log(`[Subscription] Trade notification sent to ${subscribers.length} subscriber(s) for ${address.substring(0, 8)}...`);
  }

  getStats(): { totalClients: number; totalAddresses: number; totalSubscriptions: number } {
    let totalSubscriptions = 0;
    for (const addresses of this.clientSubscriptions.values()) {
      totalSubscriptions += addresses.size;
    }

    return {
      totalClients: this.clientSubscriptions.size,
      totalAddresses: this.trackedAddresses.size,
      totalSubscriptions,
    };
  }
}
