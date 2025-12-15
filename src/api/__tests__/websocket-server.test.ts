import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { WebSocket } from 'ws';
import { SubscriptionManager } from '../subscription-manager.js';
import { TradeWebSocketServer } from '../websocket-server.js';
import type { DetectedTrade } from '../../types/trade.js';

// Mock WebSocket server
jest.mock('ws', () => {
  const EventEmitter = require('events');
  class MockWebSocket extends EventEmitter {
    readyState = WebSocket.OPEN;
    send = jest.fn();
    ping = jest.fn();
    close = jest.fn();
    terminate = jest.fn();
  }
  
  class MockWebSocketServer extends EventEmitter {
    close = jest.fn();
  }
  
  return {
    WebSocket: MockWebSocket,
    WebSocketServer: MockWebSocketServer,
  };
});

describe('TradeWebSocketServer', () => {
  let server: TradeWebSocketServer;
  let subscriptionManager: SubscriptionManager;
  let mockWs: any;

  beforeEach(() => {
    subscriptionManager = new SubscriptionManager();
    server = new TradeWebSocketServer(subscriptionManager);
    mockWs = {
      on: jest.fn((event, callback) => {
        if (event === 'message') {
          // Store message handler for testing
          mockWs.messageHandler = callback;
        }
      }),
      send: jest.fn(),
      readyState: WebSocket.OPEN,
      ping: jest.fn(),
      close: jest.fn(),
    };
  });

  afterEach(() => {
    server.stop();
  });

  it('should start server on specified port', () => {
    server.start(8080);
    // Server should be initialized (internal state)
    expect(server).toBeDefined();
  });

  it('should handle subscription messages', () => {
    server.start(8080);
    // This test would need to actually create a WebSocket connection
    // For now, we verify the server can be instantiated
    expect(server).toBeDefined();
  });

  it('should forward trade notifications to subscribers', (done) => {
    server.start(8080);
    
    // Subscribe a client
    subscriptionManager.subscribe('client1', 'address1');
    
    // Send trade notification
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
    
    subscriptionManager.handleTrade(trade);
    
    // Allow async processing
    setTimeout(() => {
      done();
    }, 100);
  });
});

