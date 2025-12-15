/**
 * Test script for Trade Analyzer
 * 
 * Connects to Shredstream, processes transactions, and detects trades
 * routed through OKX and DFlow aggregators.
 * 
 * Run with: npm run test:trade-analyzer
 */

import { ShredstreamClient } from '../services/shredstream-client.js';
import { ShredstreamEvents } from '../constants/events.js';
import { TransactionProcessor } from '../services/transaction-processor.js';
import { TradeAnalyzer } from '../services/trade-analyzer.js';
import { SHREDSTREAM_ENDPOINT } from '../constants/aggregators.js';
import type { DetectedTrade } from '../types/trade.js';

// RPC URL for resolving Address Lookup Tables
// Set SOLANA_RPC_URL env var to use a paid RPC with better rate limits
// Without RPC, we can only detect trades where program IDs are in static account keys
const RPC_URL = process.env.SOLANA_RPC_URL || '';

async function main() {
  console.log('Trade Analyzer Test\n');
  console.log('Looking for trades routed through OKX and DFlow aggregators...\n');

  // Create Shredstream client
  const shredstreamClient = new ShredstreamClient({
    endpoint: SHREDSTREAM_ENDPOINT,
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  });

  // Create Transaction Processor
  const txProcessor = new TransactionProcessor();

  // Create Trade Analyzer
  // RPC is needed to resolve Address Lookup Tables where OKX/DFlow program IDs typically are
  if (RPC_URL) {
    console.log(`Using RPC: ${RPC_URL}`);
    console.log('(lookup tables will be resolved for better detection)\n');
  } else {
    console.error('Error: SOLANA_RPC_URL environment variable is required');
    console.error('Please set SOLANA_RPC_URL to your Solana RPC endpoint URL');
    process.exit(1);
  }
  const tradeAnalyzer = new TradeAnalyzer({ rpcUrl: RPC_URL });

  // Optionally track a specific user (comment out to detect all trades)
  // tradeAnalyzer.addTrackedUser(EXAMPLE_FOMO_USER);
  console.log('Monitoring ALL aggregator trades (no user filter)\n');

  // Wire up the pipeline
  txProcessor.subscribe(shredstreamClient);
  tradeAnalyzer.subscribe(txProcessor);

  // Track statistics
  let txCount = 0;
  let tradeCount = 0;

  // Listen for transactions
  txProcessor.on('transaction', () => {
    txCount++;
    if (txCount % 1000 === 0) {
      const stats = tradeAnalyzer.getStats();
      console.log(`\nStats: ${txCount} transactions, ${stats.aggregatorTradeCount} aggregator txs, ${stats.tradeCount} trades detected\n`);
    }
  });

  // Listen for detected trades
  tradeAnalyzer.on('trade', (trade: DetectedTrade) => {
    if (trade.tokenAmount === BigInt(0)) {
      return;
    }
    tradeCount++;
    console.log(`\n===============================================`);
    console.log(`Trade #${tradeCount} Detected`);
    console.log(`===============================================`);
    console.log(`   Direction: ${trade.direction.toUpperCase()}`);
    console.log(`   Aggregator: ${trade.aggregator.toUpperCase()}`);
    console.log(`   Token: ${trade.tokenMint}`);
    console.log(`   USDC Amount: $${trade.usdcAmount.toFixed(2)} (precise: ${trade.usdcAmount})`);
    console.log(`   Token Amount: ${trade.tokenAmount.toString()}`);
    console.log(`   User: ${trade.userAddress}`);
    console.log(`   Signature: ${trade.signature}`);
    console.log(`   Slot: ${trade.slot}`);
    console.log(`===============================================\n`);
  });

  // Handle errors
  tradeAnalyzer.on('error', (error) => {
    console.error('Trade Analyzer error:', error);
  });

  txProcessor.on('error', () => {
    // Silently count errors
  });

  shredstreamClient.on(ShredstreamEvents.CONNECTED, () => {
    console.log('Connected to Shredstream');
  });

  shredstreamClient.on(ShredstreamEvents.ERROR, (error) => {
    console.error('Shredstream error:', error);
  });

  // Connect and start
  try {
    await shredstreamClient.connect();
    console.log('Listening for trades... (Ctrl+C to stop)\n');

    // Run for 60 seconds then show final stats
    setTimeout(() => {
      const stats = tradeAnalyzer.getStats();
      console.log('\n\n===============================================');
      console.log('Final Statistics (60 seconds):');
      console.log('===============================================');
      console.log(`   Transactions processed: ${txCount}`);
      console.log(`   Aggregator transactions: ${stats.aggregatorTradeCount}`);
      console.log(`   Trades detected: ${stats.tradeCount}`);
      console.log('===============================================\n');
      
      shredstreamClient.disconnect();
      process.exit(0);
    }, 60000);

  } catch (error) {
    console.error('Failed to connect:', error);
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    const stats = tradeAnalyzer.getStats();
    console.log('\n\nFinal Stats:');
    console.log(`   Transactions: ${txCount}`);
    console.log(`   Aggregator TXs: ${stats.aggregatorTradeCount}`);
    console.log(`   Trades: ${stats.tradeCount}`);
    console.log('\nShutting down...');
    shredstreamClient.disconnect();
    process.exit(0);
  });
}

main().catch(console.error);
