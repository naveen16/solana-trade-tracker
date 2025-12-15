/**
 * WebSocket Client Test
 * 
 * Demonstrates how to connect to the Trade Tracker and subscribe to addresses.
 * Run this after starting the main service with `npm start`.
 */

import WebSocket from 'ws';
import { EXAMPLE_FOMO_USER } from '../constants/aggregators.js';

const WS_URL = process.env.WS_URL || 'ws://localhost:8080';
const TEST_ADDRESS = process.env.TEST_ADDRESS || EXAMPLE_FOMO_USER;

console.log('WebSocket Client Test');
console.log(`  Connecting to: ${WS_URL}`);
console.log(`  Test address: ${TEST_ADDRESS}`);
console.log('');

const ws = new WebSocket(WS_URL);

ws.on('open', () => {
  console.log('Connected to Trade Tracker');
  
  console.log(`\nSubscribing to ${TEST_ADDRESS}...`);
  ws.send(JSON.stringify({
    type: 'subscribe',
    address: TEST_ADDRESS,
  }));
});

ws.on('message', (data: Buffer) => {
  const message = JSON.parse(data.toString());
  
  switch (message.type) {
    case 'connected':
      console.log(`${message.message}`);
      console.log(`  Client ID: ${message.clientId}`);
      break;

    case 'subscribed':
      console.log(`Subscribed to: ${message.address}`);
      console.log('\nListening for trades... (Ctrl+C to stop)\n');
      break;

    case 'unsubscribed':
      console.log(`Unsubscribed from: ${message.address}`);
      break;

    case 'trade':
      console.log('\n===============================================');
      console.log('TRADE DETECTED');
      console.log('===============================================');
      console.log(`  Direction:  ${message.trade.direction.toUpperCase()}`);
      console.log(`  Aggregator: ${message.trade.aggregator.toUpperCase()}`);
      console.log(`  Token:      ${message.trade.tokenMint}`);
      console.log(`  USDC:       $${message.trade.usdcAmount.toFixed(2)}`);
      console.log(`  User:       ${message.trade.userAddress}`);
      console.log(`  Signature:  ${message.trade.signature}`);
      console.log(`  Slot:       ${message.trade.slot}`);
      console.log(`  Time:       ${message.timestamp}`);
      console.log('===============================================\n');
      break;

    case 'subscriptions':
      console.log(`Current subscriptions: ${message.addresses.join(', ') || 'none'}`);
      break;

    case 'pong':
      // Silent ping response
      break;

    case 'error':
      console.error(`Error: ${message.message}`);
      break;

    default:
      console.log('Message:', message);
  }
});

ws.on('close', () => {
  console.log('\nDisconnected from Trade Tracker');
  process.exit(0);
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error.message);
  process.exit(1);
});

process.on('SIGINT', () => {
  console.log('\nClosing connection...');
  ws.close();
});

// Ping periodically to keep connection alive
setInterval(() => {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'ping' }));
  }
}, 25000);
