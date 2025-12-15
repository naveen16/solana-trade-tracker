/**
 * Shredstream gRPC Client
 * Connects to Jito Shredstream proxy and streams Solana entries
 * 
 * Uses official Jito proto definitions from:
 * https://github.com/jito-labs/mev-protos
 */

import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { EventEmitter } from 'events';
import { join } from 'path';
import type { Entry, ShredstreamClientConfig } from '../types/shredstream.js';
import { ShredstreamEvents } from '../constants/events.js';

/**
 * Client for connecting to Jito Shredstream proxy
 * Emits events defined in ShredstreamEvents
 */
export class ShredstreamClient extends EventEmitter {
  private proxyClient: any;
  private entryCall: any;
  private config: Required<ShredstreamClientConfig>;
  private reconnectAttempts = 0;
  private isConnected = false;
  private reconnectTimer?: NodeJS.Timeout;

  constructor(config: ShredstreamClientConfig) {
    super();
    this.config = {
      endpoint: config.endpoint,
      reconnectDelay: config.reconnectDelay ?? 5000,
      maxReconnectAttempts: config.maxReconnectAttempts ?? Infinity,
    };
  }

  /**
   * Connect to the Shredstream service and start receiving entries
   */
  async connect(): Promise<void> {
    try {
      console.log(`[Shredstream] Connecting to ${this.config.endpoint}...`);

      this.proxyClient = this.createGrpcClient();
      await this.subscribeToEntries();

      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('[Shredstream] Connected');
      this.emit(ShredstreamEvents.CONNECTED);
    } catch (error) {
      console.error('[Shredstream] Failed to connect:', error);
      this.emit(ShredstreamEvents.ERROR, error);
      this.scheduleReconnect();
      throw error;
    }
  }

  /**
   * Load proto definition and create gRPC client
   */
  private createGrpcClient(): any {
    const protoDir = join(process.cwd(), 'proto');
    const shredstreamProtoPath = join(protoDir, 'shredstream.proto');

    const packageDefinition = protoLoader.loadSync(shredstreamProtoPath, {
      keepCase: true,
      longs: String,
      enums: String,
      defaults: true,
      oneofs: true,
      includeDirs: [protoDir],
    });

    const shredstreamProto = grpc.loadPackageDefinition(packageDefinition) as any;

    if (!shredstreamProto?.shredstream?.ShredstreamProxy) {
      throw new Error(
        'ShredstreamProxy service not found in proto definition. ' +
        'Please ensure proto/shredstream.proto matches the official Jito definition.'
      );
    }

    const credentials = grpc.credentials.createInsecure();
    return new shredstreamProto.shredstream.ShredstreamProxy(
      this.config.endpoint,
      credentials
    );
  }

  /**
   * Subscribe to entry updates from ShredstreamProxy
   */
  private subscribeToEntries(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const request = {}; // SubscribeEntriesRequest is empty for now

        this.entryCall = this.proxyClient.SubscribeEntries(request);

        this.entryCall.on('data', (entry: any) => {
          try {
            const parsedEntry: Entry = this.parseEntry(entry);
            this.emit(ShredstreamEvents.ENTRY, parsedEntry);
          } catch (error) {
            console.error('Error parsing entry:', error);
            this.emit(ShredstreamEvents.ERROR, error);
          }
        });

        this.entryCall.on('error', (error: grpc.ServiceError) => {
          console.error('Shredstream entry stream error:', error);
          this.isConnected = false;
          this.emit(ShredstreamEvents.ERROR, error);
          
          // Only schedule reconnect if not cancelled
          if (error.code !== grpc.status.CANCELLED) {
            this.scheduleReconnect();
          }
          reject(error);
        });

        this.entryCall.on('end', () => {
          console.log('Shredstream entry stream ended');
          this.isConnected = false;
          this.emit(ShredstreamEvents.DISCONNECTED);
          this.scheduleReconnect();
        });

        this.entryCall.on('status', (status: grpc.StatusObject) => {
          if (status.code === grpc.status.OK) {
            resolve();
          } else {
            reject(new Error(`gRPC status error: ${status.code} - ${status.details}`));
          }
        });

        // Resolve immediately if stream is established
        // The actual data will come via 'data' event
        setTimeout(() => resolve(), 100);
      } catch (error) {
        reject(error);
      }
    });
  }


  /**
   * Parse gRPC Entry message to our type
   */
  private parseEntry(entry: any): Entry {
    return {
      slot: Number(entry.slot || 0),
      entries: Buffer.isBuffer(entry.entries) 
        ? new Uint8Array(entry.entries) 
        : entry.entries || new Uint8Array(0),
    };
  }

  /**
   * Schedule reconnection attempt
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      console.error(`[Shredstream] Max reconnection attempts (${this.config.maxReconnectAttempts}) reached`);
      this.emit(ShredstreamEvents.MAX_RECONNECT_ATTEMPTS_REACHED);
      return;
    }

    this.reconnectAttempts++;
    const delay = this.config.reconnectDelay;

    console.log(`[Shredstream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})...`);

    this.reconnectTimer = setTimeout(() => {
      console.log(`[Shredstream] Reconnecting (attempt ${this.reconnectAttempts})...`);
      this.connect().catch((error) => {
        console.error('Reconnection failed:', error);
      });
    }, delay);
  }

  /**
   * Disconnect from the Shredstream service
   */
  disconnect(): void {
    console.log('[Shredstream] Disconnecting...');

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }

    if (this.entryCall) {
      this.entryCall.cancel();
      this.entryCall = null;
    }

    if (this.proxyClient) {
      this.proxyClient.close();
      this.proxyClient = null;
    }


    this.isConnected = false;
    this.emit(ShredstreamEvents.DISCONNECTED);
  }

  /**
   * Check if client is connected
   */
  get connected(): boolean {
    return this.isConnected;
  }

  /**
   * Get current reconnect attempt count
   */
  get reconnectAttemptCount(): number {
    return this.reconnectAttempts;
  }
}
