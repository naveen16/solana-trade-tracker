/**
 * Event name constants to avoid typos when emitting/listening
 */

export const ShredstreamEvents = {
  CONNECTED: 'connected',
  DISCONNECTED: 'disconnected',
  ENTRY: 'entry',
  ERROR: 'error',
  MAX_RECONNECT_ATTEMPTS_REACHED: 'maxReconnectAttemptsReached',
} as const;

export const TransactionEvents = {
  TRANSACTION: 'transaction',
  DECODE_ERROR: 'decodeError',
  ERROR: 'error',
} as const;

export const TradeEvents = {
  TRADE: 'trade',
  ERROR: 'error',
} as const;

export const SubscriptionEvents = {
  ADDRESS_ADDED: 'addressAdded',
  ADDRESS_REMOVED: 'addressRemoved',
  TRADE_NOTIFICATION: 'tradeNotification',
} as const;

