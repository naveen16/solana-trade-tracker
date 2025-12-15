/**
 * Example usage of ShredstreamClient
 * Run with: npm run test:shredstream
 */

import { ShredstreamClient } from '../services/shredstream-client.js';
import { ShredstreamEvents } from '../constants/events.js';
import { SHREDSTREAM_ENDPOINT } from '../constants/aggregators.js';

async function main() {
  console.log('Testing Shredstream Client...\n');

  const client = new ShredstreamClient({
    endpoint: SHREDSTREAM_ENDPOINT,
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  });

  // Listen for entries (Solana entries contain transactions)
  client.on(ShredstreamEvents.ENTRY, (entry) => {
    console.log(`Received entry:`, {
      slot: entry.slot,
      entriesLength: entry.entries.length,
    });
  });

  // Listen for connection events
  client.on(ShredstreamEvents.CONNECTED, () => {
    console.log('Client connected');
  });

  client.on(ShredstreamEvents.DISCONNECTED, () => {
    console.log('Client disconnected');
  });

  client.on(ShredstreamEvents.ERROR, (error) => {
    console.error('Error:', error);
  });

  // Connect
  try {
    await client.connect();
    console.log('Listening for entries... (Press Ctrl+C to stop)\n');
  } catch (error) {
    console.error('Failed to connect:', error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    client.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
