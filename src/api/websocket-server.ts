/**
 * WebSocket Server
 * 
 * Provides real-time trade notifications to subscribed clients.
 * Clients can subscribe/unsubscribe to Solana addresses via WebSocket messages.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'crypto';
import { PublicKey } from '@solana/web3.js';
import { SubscriptionManager, TradeNotification } from './subscription-manager.js';
import { SubscriptionEvents } from '../constants/events.js';

// Message types that clients can send
export const MessageType = {
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PING: 'ping',
  GET_SUBSCRIPTIONS: 'get_subscriptions',
  TEST_TRADE: 'test_trade',
} as const;

// Response types that server sends back
export const ResponseType = {
  CONNECTED: 'connected',
  SUBSCRIBED: 'subscribed',
  UNSUBSCRIBED: 'unsubscribed',
  TRADE: 'trade',
  SUBSCRIPTIONS: 'subscriptions',
  PONG: 'pong',
  ERROR: 'error',
} as const;

export type MessageTypeValue = typeof MessageType[keyof typeof MessageType];
export type ResponseTypeValue = typeof ResponseType[keyof typeof ResponseType];

export interface WebSocketMessage {
  type: MessageTypeValue;
  address?: string;
}

export interface WebSocketResponse {
  type: ResponseTypeValue;
  success?: boolean;
  message?: string;
  address?: string;
  addresses?: string[];
  clientId?: string;
  trade?: TradeNotification['trade'];
  timestamp?: string;
}

interface ClientInfo {
  id: string;
  ws: WebSocket;
  connectedAt: Date;
  lastPing: Date;
}

export class TradeWebSocketServer {
  private wss: WebSocketServer | null = null;
  // Map of client ID -> client connection info
  private clients: Map<string, ClientInfo> = new Map();
  private subscriptionManager: SubscriptionManager;
  // Periodic ping to detect dead connections
  private pingInterval: NodeJS.Timeout | null = null;

  constructor(subscriptionManager: SubscriptionManager) {
    this.subscriptionManager = subscriptionManager;

    // Forward trade notifications from SubscriptionManager to WebSocket clients
    this.subscriptionManager.on(SubscriptionEvents.TRADE_NOTIFICATION, (clientId: string, notification: TradeNotification) => {
      try {
        // Convert BigInt and Date fields to strings for JSON serialization
        const serializableTrade = {
          ...notification.trade,
          tokenAmount: notification.trade.tokenAmount.toString(),
          detectedAt: notification.trade.detectedAt.toISOString(),
        };
        
        this.sendToClient(clientId, {
          type: ResponseType.TRADE,
          address: notification.address,
          trade: serializableTrade as any, // Type assertion needed since we're converting BigInt to string
          timestamp: notification.timestamp,
        });
      } catch (error) {
        console.error(`[WebSocket] Error processing trade notification for client ${clientId.substring(0, 8)}...:`, error);
        // Don't disconnect the client for trade notification errors, just log it
      }
    });
  }

  /**
   * Start the WebSocket server on the specified port
   */
  start(port: number): void {
    this.wss = new WebSocketServer({ port });

    this.wss.on('connection', (ws: WebSocket) => {
      this.handleConnection(ws);
    });

    this.pingInterval = setInterval(() => {
      this.pingClients();
    }, 30000);

    console.log(`[WebSocket] Server started on port ${port}`);
  }

  /**
   * Handle new WebSocket connection
   */
  private handleConnection(ws: WebSocket): void {
    // Generate a unique client ID for the client
    const clientId = randomUUID();
    const clientInfo: ClientInfo = {
      id: clientId,
      ws,
      connectedAt: new Date(),
      lastPing: new Date(),
    };

    this.clients.set(clientId, clientInfo);
    console.log(`[WebSocket] Client connected: ${clientId.substring(0, 8)}...`);

    this.sendToClient(clientId, {
      type: ResponseType.CONNECTED,
      clientId,
      message: 'Connected to Trade Tracker',
      timestamp: new Date().toISOString(),
    });

    ws.on('message', (data: Buffer) => {
      try {
        const rawMessage = data.toString();
        console.log(`[WebSocket] Raw message: ${rawMessage}`);
        const message: WebSocketMessage = JSON.parse(rawMessage);
        this.handleMessage(clientId, message);
      } catch (error) {
        console.error(`[WebSocket] Parse error:`, error);
        this.sendToClient(clientId, {
          type: ResponseType.ERROR,
          success: false,
          message: 'Invalid JSON message',
        });
      }
    });

    ws.on('close', (code, reason) => {
      if (code !== 1000 && code !== 1001) {
        // Log abnormal closures (not normal close or going away)
        console.log(`[WebSocket] Client ${clientId.substring(0, 8)}... closed abnormally (code: ${code}, reason: ${reason.toString()})`);
      }
      this.handleDisconnect(clientId);
    });

    ws.on('error', (error) => {
      console.error(`[WebSocket] Client ${clientId.substring(0, 8)}... error:`, error.message);
      // Error event is usually followed by close event, so we don't need to disconnect here
    });

    // Handle pong responses to server pings (WebSocket library handles this automatically)
    ws.on('pong', () => {
      const client = this.clients.get(clientId);
      if (client) {
        client.lastPing = new Date();
      }
    });
  }

  /**
   * Route incoming messages to appropriate handlers
   */
  private handleMessage(clientId: string, message: WebSocketMessage): void {
    switch (message.type) {
      case MessageType.SUBSCRIBE:
        this.handleSubscribe(clientId, message.address);
        break;

      case MessageType.UNSUBSCRIBE:
        this.handleUnsubscribe(clientId, message.address);
        break;

      case MessageType.PING:
        this.handlePing(clientId);
        break;

      case MessageType.GET_SUBSCRIPTIONS:
        this.handleGetSubscriptions(clientId);
        break;

      case MessageType.TEST_TRADE:
        this.handleTestTrade(clientId, message.address);
        break;

      default:
        this.sendToClient(clientId, {
          type: ResponseType.ERROR,
          success: false,
          message: `Unknown message type: ${message.type}`,
        });
    }
  }

  private handleSubscribe(clientId: string, address?: string): void {
    if (!address) {
      this.sendToClient(clientId, {
        type: ResponseType.ERROR,
        success: false,
        message: 'Address is required for subscribe',
      });
      return;
    }

    if (!this.isValidSolanaAddress(address)) {
      this.sendToClient(clientId, {
        type: ResponseType.ERROR,
        success: false,
        message: 'Invalid Solana address format',
        address,
      });
      return;
    }

    this.subscriptionManager.subscribe(clientId, address);
    
    this.sendToClient(clientId, {
      type: ResponseType.SUBSCRIBED,
      success: true,
      message: `Subscribed to ${address}`,
      address,
    });
  }

  private handleUnsubscribe(clientId: string, address?: string): void {
    if (!address) {
      this.sendToClient(clientId, {
        type: ResponseType.ERROR,
        success: false,
        message: 'Address is required for unsubscribe',
      });
      return;
    }

    this.subscriptionManager.unsubscribe(clientId, address);
    
    this.sendToClient(clientId, {
      type: ResponseType.UNSUBSCRIBED,
      success: true,
      message: `Unsubscribed from ${address}`,
      address,
    });
  }

  private handlePing(clientId: string): void {
    const client = this.clients.get(clientId);
    if (client) {
      client.lastPing = new Date();
    }
    
    this.sendToClient(clientId, {
      type: ResponseType.PONG,
      timestamp: new Date().toISOString(),
    });
  }

  private handleGetSubscriptions(clientId: string): void {
    const addresses = this.subscriptionManager.getSubscriptionsForClient(clientId);
    
    this.sendToClient(clientId, {
      type: ResponseType.SUBSCRIPTIONS,
      addresses,
    });
  }

  /**
   * Simulate a trade for testing purposes
   */
  private handleTestTrade(clientId: string, address?: string): void {
    const subscriptions = this.subscriptionManager.getSubscriptionsForClient(clientId);
    const testAddress = address || subscriptions[0];

    if (!testAddress) {
      this.sendToClient(clientId, {
        type: ResponseType.ERROR,
        success: false,
        message: 'Subscribe to an address first, or provide an address',
      });
      return;
    }

    // Create a mock trade
    const mockTrade = {
      signature: 'TEST_' + Math.random().toString(36).substring(2, 15),
      slot: Math.floor(Date.now() / 400),
      direction: Math.random() > 0.5 ? 'buy' : 'sell',
      tokenMint: 'So11111111111111111111111111111111111111112', // SOL
      usdcAmount: Math.floor(Math.random() * 1000) + 10,
      tokenAmount: String(Math.floor(Math.random() * 1000000000)), // String to avoid BigInt serialization
      userAddress: testAddress,
      aggregator: Math.random() > 0.5 ? 'okx' : 'dflow',
      detectedAt: new Date().toISOString(),
    };

    // Send directly to this client
    this.sendToClient(clientId, {
      type: ResponseType.TRADE,
      address: testAddress,
      trade: mockTrade as any,
      timestamp: new Date().toISOString(),
    });

    console.log(`[WebSocket] Sent test trade to client ${clientId.substring(0, 8)}...`);
  }

  private handleDisconnect(clientId: string): void {
    this.subscriptionManager.removeClient(clientId);
    this.clients.delete(clientId);
    console.log(`[WebSocket] Client disconnected: ${clientId.substring(0, 8)}...`);
  }

  private sendToClient(clientId: string, response: WebSocketResponse): void {
    const client = this.clients.get(clientId);
    if (!client) {
      return;
    }

    if (client.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      const message = JSON.stringify(response);
      client.ws.send(message);
    } catch (error) {
      console.error(`[WebSocket] Error sending message to client ${clientId.substring(0, 8)}...:`, error);
      // If serialization fails, close the connection to prevent further issues
      try {
        client.ws.close(1011, 'Internal server error');
      } catch (closeError) {
        // Ignore errors during close
      }
      this.handleDisconnect(clientId);
    }
  }

  /**
   * Ping all clients to check connection health
   * Disconnects clients that haven't responded in 120 seconds
   */
  private pingClients(): void {
    const now = Date.now();
    for (const [clientId, client] of this.clients) {
      // Disconnect clients that haven't responded to ping in 120 seconds
      // (more lenient to handle clients like wscat that may not respond to pings)
      if (now - client.lastPing.getTime() > 120000) {
        console.log(`[WebSocket] Client ${clientId.substring(0, 8)}... timed out (no pong response in 120s)`);
        client.ws.terminate();
        this.handleDisconnect(clientId);
        continue;
      }

      if (client.ws.readyState === WebSocket.OPEN) {
        // Send ping frame - client should respond with pong
        client.ws.ping();
      }
    }
  }

  /**
   * Validate Solana address using @solana/web3.js PublicKey
   */
  private isValidSolanaAddress(address: string): boolean {
    try {
      new PublicKey(address);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Stop the WebSocket server and close all connections
   */
  stop(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }

    for (const client of this.clients.values()) {
      client.ws.close();
    }
    this.clients.clear();

    if (this.wss) {
      this.wss.close();
    }

    console.log('[WebSocket] Server stopped');
  }

  getStats(): { connectedClients: number; subscriptionStats: ReturnType<SubscriptionManager['getStats']> } {
    return {
      connectedClients: this.clients.size,
      subscriptionStats: this.subscriptionManager.getStats(),
    };
  }
}
