# Fomo Solana Trade Tracker

Real-time trade tracking service for Solana addresses via Jito Shredstream.

## Overview

This service tracks Solana addresses (fomo users) and provides real-time notifications when they make trades through OKX and DFlow aggregators. It ingests transaction data from Jito Shredstream in real-time, identifies on-platform trades, and delivers trade notifications to subscribed clients via WebSocket.

### Key Features

- **Real-time ingestion** via Jito Shredstream (gRPC streaming)
- **Trade detection** for OKX and DFlow aggregators
- **Balance delta parsing** using pre/post token balances for accurate trade detection
- **WebSocket API** for real-time trade notifications
- **Address subscription management** for efficient filtering
- **Automatic reconnection** and error handling

### Architecture

The system follows an event-driven architecture with the following components:

- **ShredstreamClient**: Connects to Jito Shredstream proxy via gRPC, handles reconnection
- **TransactionProcessor**: Deserializes bincode-encoded entries, reconstructs Solana transactions
- **TradeAnalyzer**: Identifies aggregator swaps, resolves Address Lookup Tables, parses trades using balance deltas
- **SubscriptionManager**: Manages client subscriptions and routes trade notifications
- **WebSocketServer**: Handles WebSocket connections and message routing

## Setup

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn
- Solana RPC endpoint (e.g., Alchemy, QuickNode, Helius)

### Installation

1. **Install dependencies:**
```bash
npm install
```

2. **Configure environment variables:**

Create a `.env` file in the project root:

```env
# Required: Solana RPC endpoint
RPC_ENDPOINT=https://solana-mainnet.g.alchemy.com/v2/YOUR_API_KEY

# Optional: Shredstream endpoint (defaults to 18.234.24.82:50051 if not set)
SHREDSTREAM_ENDPOINT=18.234.24.82:50051

# Optional: WebSocket port for the API (defaults to 8080)
WS_PORT=8080
```

3. **Build the project:**
```bash
npm run build
```

4. **Run the service:**
```bash
npm start
```

For development with hot reload:
```bash
npm run dev
```

## Usage

### WebSocket API

Connect to `ws://localhost:8080` to subscribe to trade notifications.

You can connect using `wscat`:
```bash
wscat -c ws://localhost:8080
```

#### Subscribe to an address

```json
{"type": "subscribe", "address": "8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt"}
```

Response:
```json
{"type": "subscribed", "success": true, "message": "Subscribed to 8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt", "address": "8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt"}
```

#### Unsubscribe from an address

```json
{"type": "unsubscribe", "address": "8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt"}
```

#### Get current subscriptions

```json
{"type": "get_subscriptions"}
```

#### Trade notification format

When a trade is detected, you'll receive:

```json
{
  "type": "trade",
  "address": "8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt",
  "trade": {
    "signature": "2qp8yLk3d5cxEnLoRUMkPhhJUryGgHJ7Pi8G4TaCB1i4AE6Rz3eGiMupV4sTbUEg92RM1vw4k5V4y2hzffTMv7uW",
    "slot": 386731887,
    "direction": "buy",
    "tokenMint": "9223LqDuoJXyhCtvi54DUQPGS8Xf29kUEQRr7Sfhmoon",
    "usdcAmount": 2.05,
    "tokenAmount": "46672314888",
    "userAddress": "8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt",
    "aggregator": "dflow",
    "detectedAt": "2025-12-14T22:37:15.190Z"
  },
  "timestamp": "2025-12-14T22:37:15.190Z"
}
```

### Testing

The project includes comprehensive unit test coverage using Jest. Run all tests:

```bash
# Run all unit tests
npm test

# Run tests in watch mode
npm run test:watch

# Generate coverage report
npm run test:coverage
```

Individual component tests (integration tests):

```bash
# Test Shredstream connection
npm run test:shredstream

# Test transaction processing
npm run test:tx-processor

# Test trade analyzer
npm run test:trade-analyzer

# Test WebSocket client
npm run test:ws-client
```

**Test Coverage:**
- ✅ Full unit test coverage for all core modules
- ✅ Utilities (binary parsing, entry deserialization, transaction decoding)
- ✅ Services (Shredstream client, transaction processor, trade analyzer)
- ✅ API layer (subscription manager, WebSocket server)

For integration test results and real-world trade detection examples, see [`test-results.md`](./test-results.md).

## Project Structure

```
src/
├── services/           # Core services
│   ├── shredstream-client.ts      # Jito Shredstream gRPC client
│   ├── transaction-processor.ts   # Entry deserialization and transaction extraction
│   └── trade-analyzer.ts          # Trade detection and parsing
├── api/                # API layer
│   ├── websocket-server.ts        # WebSocket server and message handling
│   └── subscription-manager.ts    # Subscription management
├── constants/          # Configuration constants
│   ├── aggregators.ts             # OKX/DFlow program IDs
│   ├── events.ts                  # Event name constants
│   ├── programs.ts                # Solana program IDs
│   └── tokens.ts                  # Token mint addresses
├── types/              # TypeScript type definitions
├── utils/              # Utility functions
│   ├── binary.ts                  # Binary buffer reading utilities
│   ├── entries.ts                 # Entry deserialization
│   └── solana-tx.ts               # Transaction decoding utilities
└── test/               # Test files
proto/
└── shredstream.proto   # gRPC proto definition
```

---

## Assignment Questions

### Time Allocation

I spent approximately **4 hours** on this assignment, allocating my time as follows:

- **First 3 hours**: Implementing and testing each component individually
  - Shredstream client with gRPC connection and reconnection logic
  - Transaction processor for entry deserialization and transaction reconstruction
  - Trade analyzer with aggregator detection and trade parsing
  - Subscription manager and WebSocket server
- **Last hour**: Debugging the trade analyzer (the most complex component), cleaning up code, and end-to-end testing via the Fomo app

The trade analyzer required the most attention due to the complexity of:
- Resolving Address Lookup Tables for versioned transactions
- Parsing aggregator-specific instruction formats (OKX and DFlow)
- Implementing balance delta parsing for accurate trade detection
- Handling edge cases and transaction parsing edge cases

### AI Usage

I used AI assistance in several ways:

1. **Cursor**: For implementation assistance - code generation, refactoring suggestions, and debugging help throughout the development process.

2. **ChatGPT**: For research on specific topics, particularly:
   - Trade analyzer strategy and best practices for parsing Solana swap instructions
   - Balance delta parsing approach using pre/post token balances
   - Understanding bincode deserialization format used by Shredstream

3. **AI-assisted documentation**: Used AI to help format and enumerate ideas for productionization, monitoring, and scaling topics discussed in this README. AI was helpful in organizing and structuring complex architectural concepts into clear, comprehensive answers.

AI was particularly helpful in understanding the trade detection strategy, exploring different approaches to accurately identify trade direction and amounts, and organizing complex scalability considerations into actionable insights.

### Productionization Steps

To productionize this service, I would take the following steps:

1. **Infrastructure & Deployment**
   - Containerize with Docker and create Kubernetes manifests for horizontal scaling
   - Set up CI/CD pipeline with automated testing and deployment
   - Deploy behind a load balancer with health checks
   - Use message queue (Redis Streams or Kafka) to decouple trade detection from notification delivery
   - Implement database persistence for trade history and subscription state

2. **Performance & Reliability**
   - Add connection pooling for RPC endpoints (multiple providers with failover)
   - Implement circuit breakers for external dependencies (Shredstream, RPC)
   - Add request queuing and backpressure handling for RPC calls
   - Cache Address Lookup Tables and frequently accessed account data
   - Optimize transaction filtering to reduce unnecessary processing

3. **Observability**
   - Structured logging with correlation IDs for request tracing
   - Comprehensive metrics (latency, throughput, error rates, queue depths)
   - Distributed tracing (OpenTelemetry) across service boundaries
   - Alerting on critical thresholds (connection failures, processing lag, memory usage)

4. **Security & Compliance**
   - Authentication/authorization for WebSocket connections (API keys or JWT)
   - Rate limiting per client and per address subscription
   - Input validation and sanitization
   - Secrets management (environment variables via Vault or similar)
   - Audit logging for subscription changes

5. **Data Quality**
   - Validation schemas for trade data
   - Deduplication logic for duplicate trade notifications
   - Reconciliation processes to verify trade detection accuracy
   - Data retention policies for trade history

### Monitoring for System Stability

I would implement monitoring across these dimensions:

1. **System Health Metrics**
   - Shredstream connection status and reconnection frequency
   - RPC endpoint latency and success rates
   - WebSocket connection count and active subscriptions
   - Memory usage, CPU utilization, and garbage collection metrics
   - Queue depths for pending RPC calls and trade notifications

2. **Business Metrics**
   - Trades detected per second/minute
   - Average latency from transaction to notification delivery
   - Subscription count and churn rate
   - Trade detection accuracy (manual spot checks vs. automated reconciliation)

3. **Error Tracking**
   - Error rates by component (Shredstream, RPC, Trade Analyzer, WebSocket)
   - Failed trade parsing attempts with transaction signatures for debugging
   - WebSocket connection failures and disconnection reasons
   - RPC rate limiting and timeout errors

4. **Performance Metrics**
   - P50/P95/P99 latency for trade detection pipeline
   - Transaction processing throughput (transactions/second processed)
   - WebSocket message delivery latency
   - RPC call latency breakdown by operation type

5. **Alerting Rules**
   - Shredstream disconnection lasting > 30 seconds
   - RPC error rate > 5% over 5 minutes
   - Trade detection latency P95 > 10 seconds
   - Memory usage > 80% for > 5 minutes
   - WebSocket connection failure rate > 10%

### Scaling with Consumers and Tracked Addresses

**Core Principle: Ingest Once, Fan Out Many**

Consumers do not affect ingestion cost - they only affect fan-out. The architecture should be designed so that:
- Shred ingestion happens once
- Trade detection happens once
- Results are published to a pub/sub layer
- Consumers subscribe to topics (addresses)

#### 1. Scaling with Number of Consumers

**Key Insight:** Ingestion throughput is unchanged as consumers grow.

| # Consumers | Impact | Strategy |
|-------------|--------|----------|
| 10 | Negligible | Direct WebSocket connections |
| 1,000 | Still negligible | WebSocket connections with connection pooling |
| 100,000 | Requires pub/sub + backpressure | Kafka/Redpanda topics per address, push→pull hybrid |
| 1M | Requires sharded fan-out | Sharded topics, cursor-based subscriptions |

**Fan-Out Architecture:**
- **Don't:** Push to every consumer synchronously ❌
- **Do:** Publish trade events to a message bus ✅

Example implementation:
- Topics: `trades.<address_hash>` or `trades.<shard_id>`
- Consumers subscribe to topics they care about
- Allows replay, backpressure, and horizontal scaling
- Use WebSockets/gRPC streams for real-time delivery
- Kafka/Redpanda for reliable fan-out at scale

#### 2. Scaling with Number of Tracked Addresses

This is the real scaling challenge.

**Naive Approach (Bad):**
- For each transaction, scan all tracked addresses
- Complexity: O(N) per transaction ❌

**Correct Approach:**
- Build an address → subscription index
- For each transaction:
  1. Extract touched accounts (typical Solana tx touches 10-40 accounts)
  2. Intersect with tracked set using HashSet/Bloom filter
- Complexity: O(#accounts in tx), not O(#tracked addresses) ✅

**Data Structures:**
- HashSet for fast O(1) membership checks
- Bloom filter for even faster pre-filtering (small false positive rate acceptable)
- Address → subscriber list mapping for fan-out
- In-memory for <100K addresses, Redis/Distributed cache for larger scale

**Scaling Characteristics:**
- Current implementation already uses this approach (filtering at transaction processor level)
- Typical Solana transaction touches 10-40 accounts, making intersection very fast
- Can scale to 100K+ tracked addresses with proper data structures

### Scaling with Solana TPS Growth

**Key Insight:** DEX swaps do not scale linearly with TPS. Most TPS growth comes from vote transactions, compute-heavy programs, and L2/app-specific noise. Swap throughput is bounded by user behavior and blockspace economics.

#### Current TPS: 3-4k

**Status:** System handles this comfortably with current architecture

- Single instance processes transactions asynchronously via event loop
- Vote transaction filtering (~88% of transactions) reduces processing load significantly
- Only RPC-enrich when:
  - Program ∈ {OKX, DFlow}
  - Tracked address is involved
- This filters ~99.9% of transactions
- RPC calls are manageable: ~50-200 relevant swaps/sec (generous estimate)

#### 100k TPS

**Key Insight:** Even at 100k TPS, swap volume is maybe 5-10k TPS (optimistic). The tracked-user subset is still tiny relative to total TPS.

**Required Changes:**

1. **ShredStream Ingestion Scaling**
   - ShredStream already scales horizontally—can shard by slot, leader, or region
   - Consume shreds in parallel across multiple instances
   - Deduplicate by signature (keep ingestion stateless)
   - Each instance processes its shard independently

2. **Address Filtering (Critical)**
   - Current O(accounts in tx) filtering approach scales well
   - Typical Solana tx touches 10-40 accounts
   - HashSet/Bloom filter lookup is O(1)
   - At 100k TPS: ~1M-4M account lookups/sec → trivial with proper data structures

3. **RPC Enrichment Strategy**
   - Current approach already filters ~99.9% of transactions
   - At 100k TPS, relevant swaps still ~5-10k TPS
   - Use dedicated RPC providers (Helius, QuickNode) with connection pooling
   - Aggressive caching for Address Lookup Tables
   - Batch RPC calls where possible

4. **Processing Pipeline**
   - Horizontal scaling: 10-20 instances behind load balancer
   - Message queue for trade events (Kafka/Redpanda)
   - Stateless trade detection enables easy horizontal scaling

#### 1M TPS

**Production Evolution Path:**

| Scale | Strategy | RPC Approach |
|-------|----------|--------------|
| ≤10k TPS | Public RPC | Single provider sufficient |
| 10k-100k TPS | Dedicated RPC / Helius | Multiple providers, connection pooling |
| 100k+ TPS | Geyser plugin / local validator | Direct validator connection |
| 1M TPS | Full custom indexing | Local validator or custom indexing layer |

**At 1M TPS, you are NOT RPC-enriching every trade. You are:**

1. **Using Geyser Plugin or Local Validator**
   - Direct connection to validator nodes
   - Stream only relevant transactions (filtered at validator level)
   - Eliminates RPC bottleneck entirely
   - Custom indexing layer for trade detection

2. **Specialized Infrastructure**
   - Rust/C++ service for transaction processing (10-100x faster than Node.js)
   - Compiled instruction parsers instead of interpreted JavaScript
   - In-memory processing with minimal allocations

3. **Stream Processing Architecture**
   - Apache Flink or similar for distributed stream processing
   - Partition data streams by program IDs or address ranges
   - Parallel processing pipelines

4. **Advanced Filtering**
   - Pre-compute address bloom filters and ship to edge nodes
   - Filter at validator/Geyser level before any processing
   - Validator-level hooks for maximum efficiency

5. **Sampling/Batching**
   - For very high scale, may need to sample or batch enrichments
   - Priority queue for tracked addresses (always process, sample others)

**Realistic Assessment:**

- **3-4k TPS**: Current architecture works perfectly ✅
- **100k TPS**: Requires horizontal scaling and dedicated RPC, but filtering approach scales well ✅
- **1M TPS**: Requires Geyser/local validator approach or full custom indexing, but same filtering principles apply ✅

The key insight is that **swap volume doesn't scale linearly with TPS**, and the current filtering approach (O(accounts in tx) intersection) scales extremely well regardless of TPS growth. The main bottleneck becomes RPC enrichment, which is solved by moving to Geyser/local validator at high scale.
