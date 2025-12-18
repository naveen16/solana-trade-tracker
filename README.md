## FOMO Solana Trade Tracker & Copy Trading Bot

End-to-end system for **real-time Solana trade tracking** and a **low-latency copy trading bot** with risk management, smart filters, and auto-exits.

This project was originally a **trade tracker** (for the FOMO app) and has been extended into a **production-grade copy trading engine**.

---

## High-Level Features

- **Real-time trade tracking**
  - Ingests Solana transactions via **Jito Shredstream**
  - Decodes and analyzes DEX trades routed through **OKX / DFlow**
  - Exposes a **WebSocket API** so clients can subscribe to trades for specific addresses

- **Copy trading bot**
  - Copies trades from one or more **target wallets** (e.g. whales, signal providers)
  - Fixed USDC trade size (e.g. always copy with **$2 USDC**)
  - Supports **both buys and sells**
  - Integrates with **Jupiter Aggregator** for swaps
  - Uses **Jito bundles + parallel RPC** for fast and reliable inclusion

- **Risk & portfolio management**
  - Full **position tracking** (amounts, entry prices, cost basis)
  - **Risk limits** (max per-position size, max total exposure, max open positions, USDC reserve)
  - **Smart trade filters** (liquidity, volume, token age, pump detection)
  - **Auto-exit strategy** (take profits, stop loss, time-based, optional trailing stops)

- **Latency-optimized**
  - Sub-200ms best-case copy latency from detection → transaction sent
  - Multiple layers of optimizations (see below)

---

## System Architecture

### Overview

The system is composed of two main parts:

- **Trade Tracker (original system)** – real-time ingestion + trade detection + WebSocket API
- **Copy Trading Engine (new)** – wallet management, swap execution, risk/rules engine

### Data Flow

```text
Jito Shredstream  ──►  ShredstreamClient
                         │
                         ▼
                    TransactionProcessor
                         │
                         ▼
                     TradeAnalyzer
                         │
             ┌───────────┴────────────┐
             │                        │
             ▼                        ▼
   SubscriptionManager           CopyTradeEngine
       + WebSocket API              │
                                    ▼
                              JupiterExecutor
                                    │
                                    ▼
                               Solana Network

CopyTradeEngine is guarded by:
  - PositionManager (risk limits + P&L)
  - TradeFilter (smart filters)
  - ExitManager (auto exits, background)
```

### Core Components

#### Trade Tracker (Existing)

- **`ShredstreamClient`**
  - gRPC client for **Jito Shredstream**
  - Streams Solana entries in real-time
  - Handles reconnects and emits `CONNECTED`, `DISCONNECTED`, and `ERROR` events

- **`TransactionProcessor`**
  - Decodes entries into Solana transactions
  - Emits `TRANSACTION` events with parsed account keys and instructions

- **`TradeAnalyzer`**
  - Watches decoded transactions for **OKX / DFlow**-routed DEX trades
  - Maintains a set of **tracked addresses** (wallets of interest)
  - Emits `TRADE` events with normalized `DetectedTrade` objects:
    - direction (`buy`/`sell`), `tokenMint`, `usdcAmount`, `tokenAmount`, `userAddress`, `signature`, `detectedAt`

- **`SubscriptionManager` + `TradeWebSocketServer`**
  - WebSocket server for clients (e.g. FOMO frontend)
  - Clients can:
    - `subscribe` to addresses
    - `unsubscribe`
    - `get_subscriptions`
  - When a trade is detected for a subscribed address, a JSON notification is pushed to all subscribers.

#### Copy Trading Engine (New)

All new functionality is orchestrated from `src/index.ts` and enabled when:

- `KEYPAIR_PATH` is set (bot wallet)
- `JUPITER_API_KEY` is set (Jupiter Aggregator)

Components:

- **`WalletManager`**
  - Loads bot `Keypair` from disk (`KEYPAIR_PATH`)
  - Provides **SOL** and **USDC** balance checks
  - Prints wallet status at startup

- **`JupiterExecutor`**
  - Low-latency integration with **Jupiter Aggregator**:
    - Quote fetching (`/swap/v1/quote`)
    - Swap transaction building (`/swap/v1/swap`)
    - Transaction sending (RPC + optional Jito)
  - Abstracts:
    - `buyToken(tokenMint, usdcAmount)`
    - `sellToken(tokenMint, tokenAmount)`
    - `sellTokenForUsdcAmount(tokenMint, usdcAmount)` (ExactOut)

- **`CopyTradeEngine`**
  - Subscribes to `TradeAnalyzer` events
  - Filters trades:
    - Direction (buy/sell)
    - Token allowlist (`ALLOWED_TOKENS`)
    - Minimum trade size
    - Deduplication (per signature)
    - **Smart filters** (via `TradeFilter`)
    - **Risk limits** (via `PositionManager`)
  - Executes:
    - Buys: `buyToken(tokenMint, TRADE_AMOUNT_USDC)`
    - Sells: `sellTokenForUsdcAmount(tokenMint, TRADE_AMOUNT_USDC)`
  - Emits copy events:
    - `COPY_INITIATED`, `COPY_COMPLETE`, `COPY_SKIPPED`, `COPY_FAILED`
  - Logs end-to-end copy latency for each trade.

- **`PositionManager`**
  - Tracks **open positions**:
    - `tokenMint`, `amount` (raw), `entryPrice`, `totalCostUsdc`, `entryTime`, trade signatures
  - Enforces **risk limits**:
    - `MAX_POSITION_SIZE_USDC` – max per-token cost
    - `MAX_TOTAL_EXPOSURE_USDC` – total portfolio cap
    - `MAX_OPEN_POSITIONS` – number of tokens
    - `MIN_USDC_RESERVE` – minimum USDC buffer
  - Provides:
    - `canTrade()` – pre-trade risk check
    - `recordBuy()` / `recordSell()` – trade accounting + realized P&L
    - `printPositions()` – pretty console summary

- **`TradeFilter` (Smart Filters)**
  - Uses DexScreener + cached metadata to filter bad trades:
    - Min liquidity: `FILTER_MIN_LIQUIDITY_USDC` (default: $50k)
    - Max price impact: `FILTER_MAX_PRICE_IMPACT_PERCENT` (default: 2%)
    - Min token age: `FILTER_MIN_TOKEN_AGE_SECONDS` (default: 1 hour)
    - Min 24h volume: `FILTER_MIN_24H_VOLUME_USDC` (default: $10k)
    - Max recent pump: `FILTER_MAX_RECENT_PUMP_PERCENT` (default: +50% in 5min)
  - Uses a **cached/hybrid** model:
    - Metadata cached for 60s
    - Background refresh every 60s
    - Latency impact is **small** (~50ms, mostly on cache miss)
  - `ALLOWED_TOKENS` are **whitelisted** by default.

- **`ExitManager` (Auto Exit Strategy)**
  - Periodically reviews positions and triggers exits when:
    - Take profit levels are hit (e.g. +50%, +100%, +300%)
    - Stop loss threshold is hit (e.g. -30%)
    - Max hold time is exceeded (e.g. 24h)
    - Optional **trailing stop** condition is satisfied
  - Uses Jupiter Price API for **batch price** fetching.
  - Executes sells via `JupiterExecutor` in the background without impacting copy latency.
  - Emits:
    - `EXIT_TRIGGERED`, `EXIT_EXECUTED`, `EXIT_FAILED`

---

## Service Summaries (Simple Explanations)

These are the main services that power the copy trading bot, explained in plain language.

### `JupiterExecutor`

- **What it is**: The swap execution engine for the bot.
- **What it does**:
  - Talks to **Jupiter Aggregator** to:
    - Get quotes (how much token you get for $X USDC, or how much USDC you get for your tokens).
    - Build ready-to-send swap transactions.
  - Signs transactions with the bot wallet and sends them using:
    - Regular RPC
    - **Jito bundles**
    - **Parallel Jito + RPC** so whichever lands first wins (duplicates are deduped by signature).
  - Provides simple methods:
    - `buyToken(tokenMint, usdcAmount)` – “Spend $X USDC to buy this token”.
    - `sellToken(tokenMint, tokenAmount)` – “Sell this many tokens for USDC”.
    - `sellTokenForUsdcAmount(tokenMint, usdcAmount)` – “Sell enough tokens to receive exactly $X USDC”.
- **Why it matters**: Everything else decides *what* to trade; `JupiterExecutor` is the optimized layer that turns that decision into a fast, on-chain swap.

### `CopyTradeEngine`

- **What it is**: The orchestrator that listens for trades and decides whether to copy them.
- **What it does**:
  - Subscribes to `TradeAnalyzer` and sees every trade from tracked wallets.
  - Applies filters in order:
    - Direction (buy/sell) and **copy-buys-only** setting.
    - Token allowlist (`ALLOWED_TOKENS`).
    - Minimum trade size (skip dust).
    - Duplicate protection (don’t copy same tx twice).
    - **Smart filters** via `TradeFilter` (liquidity, age, volume, pump).
    - **Risk limits** via `PositionManager` (position size, exposure, USDC reserve).
  - When a trade passes:
    - Executes a **buy** or **sell** via `JupiterExecutor`.
    - Updates positions via `PositionManager`.
    - Emits events and logs copy + end-to-end latency.
- **Why it matters**: This is the “brain” of the copy bot that connects trade detection, execution, filters, and risk controls.

### `ExitManager`

- **What it is**: The auto-exit engine that decides *when to sell* based on profit/loss and time.
- **What it does**:
  - Runs in the background on a timer (e.g. every 30s).
  - For each open position:
    - Fetches current price (Jupiter Price API).
    - Computes current profit/loss % vs. entry.
    - Checks **take profit** levels (e.g. +50%, +100%, +300%).
    - Checks **stop loss** (e.g. -30%).
    - Checks **max hold time** (e.g. 24h).
    - Optionally checks **trailing stop** (lock in gains after a strong move).
  - When an exit condition is hit:
    - Sells part or all of the position using `JupiterExecutor`.
    - Emits `EXIT_TRIGGERED` / `EXIT_EXECUTED` / `EXIT_FAILED`.
- **Why it matters**: You don’t have to manually manage exits—profits and losses are handled systematically according to your configured strategy.

### `PositionManager`

- **What it is**: The portfolio and risk manager for the bot.
- **What it does**:
  - Tracks all **open positions**:
    - Token mint, raw amount, average entry price, total cost, entry time, trade history.
  - Enforces **risk limits** before each copy trade:
    - `MAX_POSITION_SIZE_USDC` – max dollars per token.
    - `MAX_TOTAL_EXPOSURE_USDC` – max dollars across all tokens.
    - `MAX_OPEN_POSITIONS` – max number of distinct tokens.
    - `MIN_USDC_RESERVE` – don’t trade if this USDC buffer would be breached.
  - On trades:
    - `recordBuy(...)` – opens or adds to positions and recalculates average entry.
    - `recordSell(...)` – realizes P&L and closes positions when size reaches zero.
  - Can print a full **portfolio snapshot** with cost, value, and P&L per token and in total.
- **Why it matters**: Prevents the bot from over-sizing positions, over-exposing the account, or accidentally going all-in—critical for running this safely.

### `TradeFilter`

- **What it is**: The smart trade filter that blocks bad trades before copying them.
- **What it does**:
  - Uses **DexScreener** + cached metadata to score a token:
    - Liquidity must be at least `FILTER_MIN_LIQUIDITY_USDC` (e.g. $50k).
    - Token must be older than `FILTER_MIN_TOKEN_AGE_SECONDS` (e.g. 1 hour).
    - 24h volume must exceed `FILTER_MIN_24H_VOLUME_USDC` (e.g. $10k).
    - Recent 5m pump must be below `FILTER_MAX_RECENT_PUMP_PERCENT` (e.g. +50%).
    - Estimates price impact from our trade size vs. liquidity and caps at `FILTER_MAX_PRICE_IMPACT_PERCENT` (e.g. 2%).
  - Caches metadata for 60s and keeps a rolling 5m price history per token.
  - `ALLOWED_TOKENS` act as a whitelist: they bypass filters entirely.
- **Why it matters**: Helps avoid rugs, illiquid pairs, and chasing already-pumped tokens while keeping latency overhead low.

### `WalletManager`

- **What it is**: The service that wraps the bot’s Solana keypair and balances.
- **What it does**:
  - Loads the bot wallet from `KEYPAIR_PATH` at startup.
  - Exposes:
    - `getKeypair()` / `getPublicKey()` for signing and logging.
    - `getSolBalance()` to ensure there is enough SOL for fees.
    - `getUsdcBalance()` to check whether there is enough USDC to copy trades.
  - Prints a simple **wallet status** (address, SOL, USDC) when the system boots.
- **Why it matters**: Central place for wallet and balance management, and a dependency for both execution and risk checks.

---

## Latency Optimizations

The copy engine is heavily optimized for **minimal detection → send latency**:

- **Jito Shredstream ingestion**
  - Near real-time access to entries directly from Jito’s Shredstream proxy.
  - Significantly faster than polling RPC or relying on standard websockets.

- **Skip preflight checks**
  - Jupiter transactions are sent with `skipPreflight: true` to avoid preflight simulation overhead.

- **High priority fees**
  - `PRIORITY_FEE` (microlamports per CU) tuned for fast inclusion (e.g. 200k).
  - Directly improves confirmation speed in congested periods.

- **HTTP keep-alive with `undici`**
  - A shared `Agent` keeps HTTP connections to `api.jup.ag` warm:
    - Reduces DNS/TLS handshake overhead.
    - Reuses connections for quotes and swaps.

- **Quote pre-fetching & caching**
  - Pre-fetches USDC → token quotes for `ALLOWED_TOKENS` every few seconds.
  - Uses an in-memory cache (`QUOTE_CACHE_TTL` ~5s):
    - Cache hit → **0ms quote latency**.
    - Only falls back to live quotes when needed.
  - Now also used for **ExactOut sells** via `sellTokenForUsdcAmount`.

- **Pre-warming swap endpoint**
  - At startup, the bot **pre-warms**:
    - `/swap/v1/tokens`
    - `/swap/v1/quote`
    - `/swap/v1/swap`
  - Ensures the first real swap doesn’t pay the cold-start cost.

- **Jito bundles + parallel RPC**
  - Uses Jito block engine with a tip:
    - Bundles include the swap tx + tip transfer.
  - **Parallel send strategy**:
    - Sends the **same signed transaction** to:
      - Jito block engine (bundle)
      - Standard Solana RPC
    - First success wins; duplicates are naturally deduped by signature.
  - Effect:
    - Avoids waiting on Jito failure before falling back.
    - Trades off slightly more RPC usage for **significantly lower tail latency**.

- **Pre-built & pre-signed transactions**
  - Background job:
    - Builds and signs Jupiter swap transactions **ahead of time** for each allowed token & trade size.
    - Uses a conservative **TTL** (e.g. 45s) based on blockhash lifetime.
  - On trade:
    - If a valid pre-built tx exists, it’s used directly:
      - No Jupiter `/swap` call.
      - No signing cost.
      - Just send via Jito+RPC.
  - Fallback:
    - If no valid pre-built tx, falls back to the normal build path.

Measured results (see `copy-trader-test-results.md`):

- Baseline: **~503ms** copy latency
- With Jito + caching: **426ms**
- With parallel Jito+RPC: **192ms**
- With pre-built transactions: **~186ms** best-case copy latency

---

## Configuration (.env)

### Core

```bash
RPC_ENDPOINT=...                     # Solana RPC (e.g. Helius)
SHREDSTREAM_ENDPOINT=...             # Jito Shredstream proxy
WS_PORT=8080                         # WebSocket API port
```

### Copy Trading

```bash
KEYPAIR_PATH=./keypair.json          # Bot wallet keypair (JSON array)
JUPITER_API_KEY=...                  # Jupiter Aggregator API key

TARGET_WALLETS=wallet1,wallet2,...   # Wallets to copy trades from
TRADE_AMOUNT_USDC=2                  # Fixed USDC size per copy
ALLOWED_TOKENS=<MINT1>,<MINT2>       # Token allowlist (e.g. WIF)
SLIPPAGE_BPS=100                     # 1% default
PRIORITY_FEE=200000                  # microlamports per CU

USE_JITO=true                        # Enable Jito bundles
JITO_TIP_LAMPORTS=1000000            # 0.001 SOL tip
```

### Risk Limits (PositionManager)

```bash
MAX_POSITION_SIZE_USDC=50            # Max $50 per token
MAX_TOTAL_EXPOSURE_USDC=200          # Max $200 total exposure
MAX_OPEN_POSITIONS=10                # Max 10 tokens
MIN_USDC_RESERVE=10                  # Keep $10 USDC buffer
```

### Smart Filters (TradeFilter)

```bash
FILTER_ENABLED=true
FILTER_MIN_LIQUIDITY_USDC=50000      # Min $50k liquidity
FILTER_MAX_PRICE_IMPACT_PERCENT=2    # Max 2% price impact
FILTER_MIN_TOKEN_AGE_SECONDS=3600    # Min 1 hour old
FILTER_MIN_24H_VOLUME_USDC=10000     # Min $10k volume
FILTER_MAX_RECENT_PUMP_PERCENT=50    # Max +50% in 5min
```

### Auto Exit Strategy (ExitManager)

```bash
EXIT_ENABLED=true
EXIT_TAKE_PROFIT_TARGETS=50:25,100:50,300:100  # profit%:sell%
EXIT_STOP_LOSS_PERCENT=-30                     # Stop loss at -30%
EXIT_MAX_HOLD_HOURS=24                         # Max hold time
EXIT_CHECK_INTERVAL_SECONDS=30                 # Check every 30s

# Optional trailing stop
# EXIT_TRAILING_STOP_PERCENT=20
# EXIT_TRAILING_ACTIVATION_PERCENT=50
```

---

## Running the System

### Development

```bash
npm install

# Start in watch mode
npm run dev
```

The dev entrypoint is `src/index.ts`, which:

- Starts Shredstream ingestion
- Starts WebSocket server
- Initializes copy trading (if configured)

### Production

```bash
npm run build
npm run start
```

Recommendations:

- Use a **process manager** like `pm2` or systemd.
- Run on **Node 18+** (see `engines` in `package.json`).
- Deploy close to **Solana validators / your RPC** (e.g. `us-east-1`).

---

## Productionization Guide

### Infrastructure

- **Region & co-location**
  - Run in the same region as:
    - Your primary RPC provider (e.g. Helius, Triton)
    - Jito block engine endpoints
  - Prefer AWS `us-east-1` or wherever your RPC is located.

- **High-availability setup**
  - Run **multiple instances** behind:
    - A load balancer for the WebSocket API.
    - Separate instances for ingestion vs. copy trading (if needed).
  - Each instance can:
    - Ingest from Shredstream
    - Run its own copy engine (for redundancy) **OR**
    - Run in **active/passive** configuration with a leader election mechanism.

- **RPC providers**
  - Use **paid / premium RPC** for:
    - Lower latency
    - Higher rate limits
    - Better reliability
  - Configure a **pool of RPC endpoints** and send in parallel (like we do for Jito+RPC).

- **Key management**
  - **Never commit `keypair.json`** to git.
  - Provide keypair via:
    - Mounted secret file (Kubernetes Secret / Docker secret).
    - Or environment variable that writes the key to disk at startup.
  - Lock down file permissions (`chmod 600`).

### Monitoring & Alerting

- **Metrics to track**
  - Copy engine:
    - `copy_latency_ms` (p50/p95/p99)
    - `trades_detected`, `trades_filtered`, `trades_risk_rejected`
    - `copy_successes`, `copy_failures`
  - Positions:
    - `open_positions`
    - `total_exposure_usdc`
    - `unrealized_pnl_usdc`
    - `realized_pnl_usdc` (from PositionManager)
  - Exits:
    - `take_profits_hit`
    - `stop_losses_hit`
    - `time_limits_hit`
    - `trailing_stops_hit`
  - Infrastructure:
    - `shredstream_reconnects`
    - `rpc_errors`, `jito_errors`
    - `dexscreener_errors`, `price_api_errors`

- **Logging**
  - Ship logs to:
    - Datadog / Loki / ELK / CloudWatch.
  - Add **structured logs** (JSON) for:
    - Each copied trade
    - Each exit event
    - Each risk rejection
    - Each smart filter rejection

- **Alerts**
  - Slack / Discord / Telegram alerts for:
    - Copy failures above threshold
    - Position limit breaches
    - Large unrealized drawdowns
    - Exit failures
    - Shredstream disconnects
  - Use the existing logging hooks to plug in webhook calls.

### UI & Operations

- **Web Dashboard (future)**
  - Build a simple **React/Next.js** UI that talks to a small HTTP API:
    - View open positions (from `PositionManager`)
    - View trade history (from database, if persisted)
    - View P&L, exposure, risk stats
    - Toggle copy trading **on/off**
    - Adjust config (trade size, allowed tokens, limits)
  - Expose read-only endpoints:
    - `/api/positions`
    - `/api/stats/copy-engine`
    - `/api/stats/exit-manager`

- **Operational commands**
  - Future additions:
    - **Panic sell all** – sell all open positions at market.
    - **Pause copy trading** – stop executing new copy trades while leaving tracker active.
    - **Dry-run mode** – simulate copy trades without sending transactions (paper trading).

### Persistence & Analytics

- **Database (optional next step)**
  - Persist:
    - Every copy trade
    - Every exit
    - Position snapshots
  - Use Postgres / TimescaleDB for:
    - Historical P&L charts
    - Wallet performance comparison (which target wallets are profitable)
    - Strategy backtesting.

- **Replay & backtesting (future)**
  - Use historical trades from the tracker to:
    - Simulate copy strategies
    - Tune:
      - `TRADE_AMOUNT_USDC`
      - Exit targets
      - Filters and risk limits.

---

## Summary

This project is now a **full-stack Solana trade tracking and copy trading system**:

- Ultra-fast ingestion via **Jito Shredstream**
- Rich trade detection for **OKX / DFlow**
- WebSocket API for external consumers
- Low-latency copy trading via **Jupiter + Jito + parallel RPC + pre-built txs**
- Capital protection via **PositionManager**
- Trade quality via **Smart Filters**
- Automated exits via **ExitManager**

It is ready to be hardened for production with better infra, monitoring, and a UI, but the **core engine and risk controls are in place and battle-tested** against real WIF trades.

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
