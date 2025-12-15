/**
 * Example usage of TransactionProcessor
 * Run with: npm run test:tx-processor
 */

import { ShredstreamClient } from '../services/shredstream-client.js';
import { ShredstreamEvents } from '../constants/events.js';
import { TransactionProcessor } from '../services/transaction-processor.js';
import { SHREDSTREAM_ENDPOINT, EXAMPLE_FOMO_USER } from '../constants/aggregators.js';

async function main() {
  console.log('Testing Transaction Processor...\n');

  // Create Shredstream client
  const shredstreamClient = new ShredstreamClient({
    endpoint: SHREDSTREAM_ENDPOINT,
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  });

  // Create Transaction Processor
  const txProcessor = new TransactionProcessor();

  // Track example address (or don't track any to see ALL transactions)
  // Uncomment the next line to filter by specific address:
  // txProcessor.trackAddress(EXAMPLE_FOMO_USER);
  console.log('Showing ALL transactions (no filtering)...\n');

  // Connect Transaction Processor to Shredstream Client
  txProcessor.subscribe(shredstreamClient);

  // Listen for transactions
  txProcessor.on('transaction', (decodedTx) => {
    console.log(`\nTransaction found:`, {
      signature: decodedTx.signature.substring(0, 16) + '...',
      slot: decodedTx.slot,
      accountKeys: decodedTx.accountKeys.length,
      isVersioned: decodedTx.isVersioned,
      // Show first few account keys
      accounts: decodedTx.accountKeys.slice(0, 3).map((k: string) => k.substring(0, 8) + '...'),
    });
  });

  txProcessor.on('error', (error) => {
    console.error('Transaction Processor Error:', error);
  });

  // Listen for connection events
  shredstreamClient.on(ShredstreamEvents.CONNECTED, () => {
    console.log('Shredstream connected');
  });

  shredstreamClient.on(ShredstreamEvents.ERROR, (error) => {
    console.error('Shredstream Error:', error);
  });

  // Connect
  try {
    await shredstreamClient.connect();
    console.log('Listening for transactions... (Press Ctrl+C to stop)\n');
    console.log(`Tracking address: ${EXAMPLE_FOMO_USER}\n`);
  } catch (error) {
    console.error('Failed to connect:', error);
    process.exit(1);
  }

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    shredstreamClient.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
