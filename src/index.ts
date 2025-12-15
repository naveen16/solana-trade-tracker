/**
 * Fomo Solana Trade Tracker
 * 
 * Real-time trade tracking service that:
 * 1. Ingests Solana transactions via Jito Shredstream
 * 2. Detects trades routed through OKX and DFlow aggregators
 * 3. Provides WebSocket API for subscribing to address trade notifications
 */

import dotenv from 'dotenv';
import { ShredstreamClient } from './services/shredstream-client.js';
import { ShredstreamEvents, SubscriptionEvents, TransactionEvents, TradeEvents } from './constants/events.js';
import { TransactionProcessor } from './services/transaction-processor.js';
import { TradeAnalyzer } from './services/trade-analyzer.js';
import { SubscriptionManager } from './api/subscription-manager.js';
import { TradeWebSocketServer } from './api/websocket-server.js';
import { SHREDSTREAM_ENDPOINT } from './constants/aggregators.js';

dotenv.config();

const rpcEndpoint = process.env.RPC_ENDPOINT;
if (!rpcEndpoint) {
  console.error('Error: RPC_ENDPOINT environment variable is required');
  console.error('Please set RPC_ENDPOINT to your Solana RPC endpoint URL');
  process.exit(1);
}

const config = {
  shredstreamEndpoint: process.env.SHREDSTREAM_ENDPOINT || SHREDSTREAM_ENDPOINT,
  wsPort: parseInt(process.env.WS_PORT || '8080', 10),
  rpcEndpoint,
};

async function main() {
  // Handle unhandled promise rejections to prevent crashes
  process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
    // Don't exit, just log the error
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
    // Don't exit immediately, but log the error
  });

  console.log('Starting Fomo Solana Trade Tracker...');
  console.log(`Shredstream endpoint: ${config.shredstreamEndpoint}`);
  console.log(`WebSocket port: ${config.wsPort}`);
  console.log(`RPC endpoint: ${config.rpcEndpoint}`);

  const subscriptionManager = new SubscriptionManager();
  const wsServer = new TradeWebSocketServer(subscriptionManager);
  const shredstreamClient = new ShredstreamClient({
    endpoint: config.shredstreamEndpoint,
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  });
  const txProcessor = new TransactionProcessor();
  const tradeAnalyzer = new TradeAnalyzer({ rpcUrl: config.rpcEndpoint });

  // Wire up the event pipeline:
  // 1. ShredstreamClient receives raw entries from Jito
  // 2. TransactionProcessor decodes entries into transactions
  // 3. TradeAnalyzer detects OKX/DFlow trades in transactions
  // 4. SubscriptionManager notifies subscribed clients

  txProcessor.subscribe(shredstreamClient);

  // Only analyze transactions involving addresses that clients are subscribed to
  txProcessor.on(TransactionEvents.TRANSACTION, (decodedTx) => {
    const trackedAddresses = subscriptionManager.getTrackedAddresses();
    if (trackedAddresses.length === 0) {
      return;
    }

    const involvedAddress = decodedTx.accountKeys.find((key: string) => 
      subscriptionManager.isAddressTracked(key)
    );

    if (involvedAddress) {
      // Handle async errors to prevent unhandled promise rejections
      tradeAnalyzer.analyzeTransaction(decodedTx).catch((error) => {
        console.error(`[TradeAnalyzer] Error analyzing transaction ${decodedTx.signature}:`, error);
        tradeAnalyzer.emit(TradeEvents.ERROR, error);
      });
    }
  });

  // Forward detected trades to subscription manager for client notification
  tradeAnalyzer.on(TradeEvents.TRADE, (trade) => {
    subscriptionManager.handleTrade(trade);
  });

  // Dynamically update tracked users when subscriptions change
  subscriptionManager.on(SubscriptionEvents.ADDRESS_ADDED, (address: string) => {
    tradeAnalyzer.addTrackedUser(address);
    console.log(`[Tracker] Now tracking: ${address}`);
  });

  subscriptionManager.on(SubscriptionEvents.ADDRESS_REMOVED, (address: string) => {
    tradeAnalyzer.removeTrackedUser(address);
    console.log(`[Tracker] Stopped tracking: ${address}`);
  });

  // Error handling for all components
  shredstreamClient.on(ShredstreamEvents.ERROR, (error) => {
    console.error('[Shredstream] Error:', error.message);
  });

  txProcessor.on(TransactionEvents.ERROR, (error) => {
    console.error('[TxProcessor] Error:', error.message);
  });

  tradeAnalyzer.on(TradeEvents.ERROR, (error) => {
    console.error('[TradeAnalyzer] Error:', error.message);
  });

  shredstreamClient.on(ShredstreamEvents.CONNECTED, () => {
    console.log('[Shredstream] Connected');
  });

  shredstreamClient.on(ShredstreamEvents.DISCONNECTED, () => {
    console.log('[Shredstream] Disconnected');
  });

  wsServer.start(config.wsPort);

  try {
    await shredstreamClient.connect();
  } catch (error) {
    console.error('Failed to connect to Shredstream:', error);
    process.exit(1);
  }

  // Periodic stats logging (only when there are active subscriptions)
  setInterval(() => {
    const stats = wsServer.getStats();
    if (stats.connectedClients > 0 || stats.subscriptionStats.totalAddresses > 0) {
      console.log(`[Stats] ${stats.connectedClients} clients, ${stats.subscriptionStats.totalAddresses} addresses tracked`);
    }
  }, 30000);

  console.log('');
  console.log('Trade Tracker is running');
  console.log('');
  console.log('WebSocket API:');
  console.log(`  Connect: ws://localhost:${config.wsPort}`);
  console.log('');
  console.log('  Subscribe:   {"type": "subscribe", "address": "<SOLANA_ADDRESS>"}');
  console.log('  Unsubscribe: {"type": "unsubscribe", "address": "<SOLANA_ADDRESS>"}');
  console.log('  List:        {"type": "get_subscriptions"}');
  console.log('');

  // Graceful shutdown handlers
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    wsServer.stop();
    shredstreamClient.disconnect();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    wsServer.stop();
    shredstreamClient.disconnect();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
