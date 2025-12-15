import { describe, it, expect, beforeEach } from '@jest/globals';
import { ShredstreamClient } from '../shredstream-client.js';

// Note: ShredstreamClient tests require complex gRPC mocking
// For now, we test basic functionality

describe('ShredstreamClient', () => {
  let client: ShredstreamClient;

  beforeEach(() => {
    client = new ShredstreamClient({
      endpoint: 'localhost:50051',
      reconnectDelay: 100,
      maxReconnectAttempts: 3,
    });
  });

  it('should have correct initial state', () => {
    expect(client.connected).toBe(false);
    expect(client.reconnectAttemptCount).toBe(0);
  });

  it('should disconnect cleanly', () => {
    client.disconnect();
    expect(client.connected).toBe(false);
  });
});

