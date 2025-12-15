/**
 * Subscription-related type definitions
 */

import { WebSocket } from 'ws';

export interface Subscription {
  /** Solana address being tracked */
  address: string;
  /** Set of WebSocket connections subscribed to this address */
  clients: Set<WebSocket>;
  /** Timestamp when subscription was created */
  createdAt: number;
}

export interface SubscriptionMap {
  [address: string]: Subscription;
}

