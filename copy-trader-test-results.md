# Copy Trading Bot - Test Results

Real-world test results from the Solana Copy Trading Bot.

## Test Configuration

| Parameter | Value |
|-----------|-------|
| Trade Amount | $2 USDC |
| Slippage | 100 bps (1%) |
| Priority Fee | 50,000 microlamports |
| Allowed Tokens | WIF (`EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm`) |
| Copy Mode | Buys only |
| Min Trade Size | $0.1 |

---

## System Startup

```
> npm run dev

===========================================
   FOMO SOLANA TRADE TRACKER
   + COPY TRADING BOT
===========================================

Configuration:
  Shredstream: 18.234.24.82:50051
  WebSocket port: 8080
  RPC: https://mainnet.helius-rpc.com/?api-key=...
  Copy trading: ENABLED
  Trade amount: $2
  Allowed tokens: EKpQGSJt...

[TradeAnalyzer] RPC connection enabled: https://mainnet.helius-rpc.com/?api-key=...
Initializing copy trading...
[WalletManager] Loaded wallet: 8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt

=== Wallet Status ===
Address: 8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt
SOL Balance: 0.0484 SOL
USDC Balance: $42.76
=====================

[JupiterExecutor] Initialized with slippage: 100bps, priority fee: 50000 microlamports
[CopyTradeEngine] Initialized
  Trade amount: $2
  Allowed tokens: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  Copy buys only: true
  Min trade size: $0.1
  (Target wallets managed by TradeAnalyzer)
[CopyTradeEngine] Subscribed to trade events
[TradeAnalyzer] Tracking user: 8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt
[CopyTrader] Tracking wallet: 8ZhZwcho6Bnc5bJ94tdFRB9juvZ4zuH44LosqsQrP7vt
[WebSocket] Server started on port 8080
[Shredstream] Connecting to 18.234.24.82:50051...
[Shredstream] Connected
[Shredstream] Connected

System is running!

WebSocket API:
  Connect: ws://localhost:8080

  Subscribe:   {"type": "subscribe", "address": "<SOLANA_ADDRESS>"}
  Unsubscribe: {"type": "unsubscribe", "address": "<SOLANA_ADDRESS>"}
  List:        {"type": "get_subscriptions"}

Copy Trading:
  - Wallets subscribed via WebSocket will be copied automatically
  - Each copy trade uses $2 USDC
```

---

## Test 1: Copy WIF Buy Trade

**Action**: Made trade on Fomo app to buy $2 of WIF

### Trade Detection

```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: buy
  Token: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  USDC Amount: $2.00
  Signature: 3pG2w3yvYRWuJ3cBywpipcTH5DSL9J3YUmUhjMoajGjv2uJCxvsHsdhyr5Kyr21yBmgYtiP6S9dGDCDmAKzdsMen
```

### Copy Trade Execution

```
[CopyTradeEngine] === COPYING TRADE ===
  Original: buy EKpQGSJt... for $2.00
  Copy: BUY EKpQGSJt... for $2
[JupiterExecutor] Buying EKpQGSJt... with $2 USDC
[Subscription] Trade notification sent to 1 subscriber(s) for 8ZhZwcho...
[JupiterExecutor] Quote received in 289ms: 2000000 EPjFWdd5... -> 5830287 EKpQGSJt...
[JupiterExecutor] Swap sent in 205ms: 2Bxr1sLu1bksdVrgTfkgDkLBTWxgqUjUn6ueV8jcivRbS9uobG4vd4ZBAT11vPNPTsQEnJZ5nNnWVSaEfgBpnxnY
[CopyTradeEngine] Copy trade SENT!
  Signature: 2Bxr1sLu1bksdVrgTfkgDkLBTWxgqUjUn6ueV8jcivRbS9uobG4vd4ZBAT11vPNPTsQEnJZ5nNnWVSaEfgBpnxnY
  Copy latency: 503ms
  End-to-end latency: 504ms

========================================
COPY TRADE SUCCESSFUL!
Original: 3pG2w3yvYRWuJ3cBywpipcTH5DSL9J3YUmUhjMoajGjv2uJCxvsHsdhyr5Kyr21yBmgYtiP6S9dGDCDmAKzdsMen
Copy: 2Bxr1sLu1bksdVrgTfkgDkLBTWxgqUjUn6ueV8jcivRbS9uobG4vd4ZBAT11vPNPTsQEnJZ5nNnWVSaEfgBpnxnY
Latency: 503ms (copy) / 504ms (e2e)
========================================

[JupiterExecutor] Transaction confirmed in 947ms (total: 1152ms): 2Bxr1sLu1bksdVrgTfkgDkLBTWxgqUjUn6ueV8jcivRbS9uobG4vd4ZBAT11vPNPTsQEnJZ5nNnWVSaEfgBpnxnY
```

### Transaction Links

| Transaction | Solscan Link |
|-------------|--------------|
| Original (Fomo) | [3pG2w3yv...](https://solscan.io/tx/3pG2w3yvYRWuJ3cBywpipcTH5DSL9J3YUmUhjMoajGjv2uJCxvsHsdhyr5Kyr21yBmgYtiP6S9dGDCDmAKzdsMen) |
| Copy Trade | [2Bxr1sLu...](https://solscan.io/tx/2Bxr1sLu1bksdVrgTfkgDkLBTWxgqUjUn6ueV8jcivRbS9uobG4vd4ZBAT11vPNPTsQEnJZ5nNnWVSaEfgBpnxnY) |

### Latency Breakdown

| Stage | Time |
|-------|------|
| Jupiter Quote | 289ms |
| Swap Build + Send | 205ms |
| **Copy Latency** (detection → sent) | **503ms** |
| Transaction Confirmation | 947ms |
| **Total Time** | **1,152ms** |

### Result: ✅ SUCCESS

---

## Test 2: Copy WIF Buy Trade (With Optimizations)

**Optimizations Enabled:**
- Quote pre-fetching (3s interval)
- HTTP keep-alive connections
- Priority fee: 200,000 microlamports
- Jito bundles (with fallback to RPC)

**Action**: Made trade on Fomo app to buy $2 of WIF

### Trade Detection

```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: buy
  Token: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  USDC Amount: $2.00
  Signature: 4BHEzb1YLcaWhuzKBE7zsi1VeugXSGoHaFa87YDJE1WKveqmzoTGyCLaRwqufbfFW1VJ5xAGHJmtdHHTQmDy1QKt
```

### Copy Trade Execution

```
[CopyTradeEngine] === COPYING TRADE ===
  Original: buy EKpQGSJt... for $2.00
  Copy: BUY EKpQGSJt... for $2
[JupiterExecutor] Buying EKpQGSJt... with $2 USDC
[JupiterExecutor] Using cached quote (age: 2575ms)
[Subscription] Trade notification sent to 1 subscriber(s) for 8ZhZwcho...
[JupiterExecutor] Jito bundle failed: Resource has been exhausted: Network congested. Endpoint is globally rate limited., falling back to RPC
[JupiterExecutor] Swap sent via Jito in 417ms: FoQ5VhHfVtCKGkUTYwe56Qdu2Xe3649F8CXFGGAnc984FLHRMvLZBZV4dMX8Dzii7R3PdJNA5WLoBrKMRYCmFPY
[CopyTradeEngine] Copy trade SENT!
  Signature: FoQ5VhHfVtCKGkUTYwe56Qdu2Xe3649F8CXFGGAnc984FLHRMvLZBZV4dMX8Dzii7R3PdJNA5WLoBrKMRYCmFPY
  Copy latency: 426ms
  End-to-end latency: 426ms

========================================
COPY TRADE SUCCESSFUL!
Original: 4BHEzb1YLcaWhuzKBE7zsi1VeugXSGoHaFa87YDJE1WKveqmzoTGyCLaRwqufbfFW1VJ5xAGHJmtdHHTQmDy1QKt
Copy: FoQ5VhHfVtCKGkUTYwe56Qdu2Xe3649F8CXFGGAnc984FLHRMvLZBZV4dMX8Dzii7R3PdJNA5WLoBrKMRYCmFPY
Latency: 426ms (copy) / 426ms (e2e)
========================================

[JupiterExecutor] Transaction confirmed in 707ms (total: 1124ms): FoQ5VhHfVtCKGkUTYwe56Qdu2Xe3649F8CXFGGAnc984FLHRMvLZBZV4dMX8Dzii7R3PdJNA5WLoBrKMRYCmFPY
```

### Transaction Links

| Transaction | Solscan Link |
|-------------|--------------|
| Original (Fomo) | [4BHEzb1Y...](https://solscan.io/tx/4BHEzb1YLcaWhuzKBE7zsi1VeugXSGoHaFa87YDJE1WKveqmzoTGyCLaRwqufbfFW1VJ5xAGHJmtdHHTQmDy1QKt) |
| Copy Trade | [FoQ5VhHf...](https://solscan.io/tx/FoQ5VhHfVtCKGkUTYwe56Qdu2Xe3649F8CXFGGAnc984FLHRMvLZBZV4dMX8Dzii7R3PdJNA5WLoBrKMRYCmFPY) |

### Latency Breakdown (With Optimizations)

| Stage | Time | Notes |
|-------|------|-------|
| Jupiter Quote | **0ms** | Used cached quote (age: 2575ms) |
| RPC Send | 417ms | Jito rate limited, fell back to RPC |
| **Copy Latency** | **426ms** | Detection → sent |
| Confirmation | 707ms | Block inclusion |
| **Total Time** | **1,124ms** | |

### Optimization Impact

| Metric | Test 1 (Baseline) | Test 2 (Optimized) | Improvement |
|--------|-------------------|--------------------| ------------|
| Quote fetch | 289ms | **0ms** (cached) | -289ms |
| Transaction send | 205ms | 417ms | +212ms |
| **Copy latency** | 503ms | **426ms** | **-77ms (15%)** |
| Confirmation | 947ms | 707ms | -240ms |
| **Total time** | 1,152ms | **1,124ms** | -28ms |

**Notes:**
- ✅ Quote caching saved ~289ms
- ⚠️ Jito was rate limited (public endpoint), gracefully fell back to RPC
- ✅ Copy latency improved by 15% (503ms → 426ms)
- ✅ Transaction confirmed faster (947ms → 707ms)

### Result: ✅ SUCCESS

---

## Test 3: Copy WIF Buy Trade (Parallel Jito+RPC)

**Optimizations Enabled:**
- Quote pre-fetching (3s interval)
- HTTP keep-alive connections
- Priority fee: 200,000 microlamports
- **NEW: Parallel Jito + RPC submission** (race both, first wins)

**Action**: Made trade on Fomo app to buy $2 of WIF

### Trade Detection

```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: buy
  Token: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  USDC Amount: $2.00
  Signature: 4kTR7KYpMaKuUMn4MuvCegyPeoiLxDZCZmmRm41129P4Vc8LHAKAEjDAiJ6UouRugYGGHXJzKeFHEbAWwwrGxBTN
```

### Copy Trade Execution (Parallel)

```
[CopyTradeEngine] === COPYING TRADE ===
  Original: buy EKpQGSJt... for $2.00
  Copy: BUY EKpQGSJt... for $2
[JupiterExecutor] Buying EKpQGSJt... with $2 USDC
[JupiterExecutor] Using cached quote (age: 2568ms)
[Subscription] Trade notification sent to 1 subscriber(s) for 8ZhZwcho...
[JupiterExecutor] Swap sent (Jito+RPC parallel) in 183ms: G6458Ru4J9wfdjsZRdUBnbGCAN6BHJeCfifVypiYQUzYJCCf2VrsBm5rfhMXy2n6qL4PPyS4ozLGSNktzByU5k4
[CopyTradeEngine] Copy trade SENT!
  Signature: G6458Ru4J9wfdjsZRdUBnbGCAN6BHJeCfifVypiYQUzYJCCf2VrsBm5rfhMXy2n6qL4PPyS4ozLGSNktzByU5k4
  Copy latency: 192ms
  End-to-end latency: 193ms

========================================
COPY TRADE SUCCESSFUL!
Original: 4kTR7KYpMaKuUMn4MuvCegyPeoiLxDZCZmmRm41129P4Vc8LHAKAEjDAiJ6UouRugYGGHXJzKeFHEbAWwwrGxBTN
Copy: G6458Ru4J9wfdjsZRdUBnbGCAN6BHJeCfifVypiYQUzYJCCf2VrsBm5rfhMXy2n6qL4PPyS4ozLGSNktzByU5k4
Latency: 192ms (copy) / 193ms (e2e)
========================================

[JupiterExecutor] Transaction confirmed in 397ms (total: 580ms): G6458Ru4J9wfdjsZRdUBnbGCAN6BHJeCfifVypiYQUzYJCCf2VrsBm5rfhMXy2n6qL4PPyS4ozLGSNktzByU5k4
```

### Transaction Links

| Transaction | Solscan Link |
|-------------|--------------|
| Original (Fomo) | [4kTR7KYp...](https://solscan.io/tx/4kTR7KYpMaKuUMn4MuvCegyPeoiLxDZCZmmRm41129P4Vc8LHAKAEjDAiJ6UouRugYGGHXJzKeFHEbAWwwrGxBTN) |
| Copy Trade | [G6458Ru4...](https://solscan.io/tx/G6458Ru4J9wfdjsZRdUBnbGCAN6BHJeCfifVypiYQUzYJCCf2VrsBm5rfhMXy2n6qL4PPyS4ozLGSNktzByU5k4) |

### Latency Breakdown (Parallel Submission)

| Stage | Time | Notes |
|-------|------|-------|
| Jupiter Quote | **0ms** | Used cached quote (age: 2568ms) |
| Jito+RPC Send | **183ms** | Both sent in parallel |
| **Copy Latency** | **192ms** | Detection → sent |
| Confirmation | 397ms | Block inclusion |
| **Total Time** | **580ms** | |

### Optimization Impact (All Tests)

| Metric | Test 1 (Baseline) | Test 2 (Jito Fallback) | Test 3 (Parallel) | Improvement |
|--------|-------------------|------------------------|-------------------|-------------|
| Quote fetch | 289ms | 0ms (cached) | **0ms** (cached) | -289ms |
| Transaction send | 205ms | 417ms | **183ms** | -22ms |
| **Copy latency** | 503ms | 426ms | **192ms** | **-311ms (62%)** |
| Confirmation | 947ms | 707ms | **397ms** | -550ms |
| **Total time** | 1,152ms | 1,124ms | **580ms** | **-572ms (50%)** |

### Key Improvements

| Optimization | Impact |
|--------------|--------|
| Quote caching | -289ms (no API call needed) |
| Parallel Jito+RPC | -234ms (no waiting for Jito fail) |
| Higher priority fees | Faster confirmation (397ms vs 947ms) |

**Summary:**
- ✅ **62% faster copy latency** (503ms → 192ms)
- ✅ **50% faster total time** (1,152ms → 580ms)
- ✅ Parallel submission eliminates Jito failure penalty
- ✅ Sub-200ms copy latency achieved!

### Result: ✅ SUCCESS

---

## Test 4: Copy WIF Sell Trade (Fixed $2 USDC, Parallel Jito+RPC)

**Optimizations Enabled:**
- Quote pre-fetching (3s interval)
- HTTP keep-alive connections
- Priority fee: 200,000 microlamports
- Parallel Jito + RPC submission (race both, first wins)

**Action**: Made trade on Fomo app to **sell** WIF (approx. $1.05 USDC size)

### Trade Detection

```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: sell
  Token: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  USDC Amount: $1.05
  Signature: 5goaHsQ8NPfj8kuJbAUkvdvST2RN37SvQrYUdBBHDDXMUB5sfwy1vTV3JLreXi6PEGoVKG78AnQN6smuajwqJ6U
```

### Copy Trade Execution (Sell, ExactOut $2 USDC)

```
[CopyTradeEngine] === COPYING TRADE ===
  Original: sell EKpQGSJt... for $1.05
  Copy: SELL EKpQGSJt... for $2
[JupiterExecutor] Selling EKpQGSJt... for $2 USDC (ExactOut)
[Subscription] Trade notification sent to 1 subscriber(s) for 8ZhZwcho...
[JupiterExecutor] Quote received in 61ms: 5978072 EKpQGSJt... -> 2000000 EPjFWdd5...
[JupiterExecutor] Swap sent (Jito+RPC parallel) in 286ms: 34xxXyZhcug7A8Jm6AqZ1D3ybpfXRqunZPk9NKZxqEXwnD4sEGsjuSx3VZqSGWGXf6QVAhEPMfRuSt5ESxNL6USz
[CopyTradeEngine] Copy trade SENT!
  Signature: 34xxXyZhcug7A8Jm6AqZ1D3ybpfXRqunZPk9NKZxqEXwnD4sEGsjuSx3VZqSGWGf6QVAhEPMfRuSt5ESxNL6USz
  Copy latency: 359ms
  End-to-end latency: 359ms

========================================
COPY TRADE SUCCESSFUL!
Original: 5goaHsQ8NPfj8kuJbAUkvdvST2RN37SvQrYUdBBHDDXMUB5sfwy1vTV3JLreXi6PEGoVKG78AnQN6smuajwq6U
Copy: 34xxXyZhcug7A8Jm6AqZ1D3ybpfXRqunZPk9NKZxqEXwnD4sEGsjuSx3VZqSGWGf6QVAhEPMfRuSt5ESxNL6USz
Latency: 359ms (copy) / 359ms (e2e)
========================================

[JupiterExecutor] Quote received in 97ms: 2000000 EPjFWdd5... -> 5975503 EKpQGSJt...
[JupiterExecutor] Transaction confirmed in 566ms (total: 852ms): 34xxXyZhcug7A8Jm6AqZ1D3ybpfXRqunZPk9NKZxqEXwnD4sEGsjuSx3VZqSGWGf6QVAhEPMfRuSt5ESxNL6USz
```

### Transaction Links

| Transaction | Solscan Link |
|-------------|--------------|
| Original (Fomo) | [5goaHsQ8...](https://solscan.io/tx/5goaHsQ8NPfj8kuJbAUkvdvST2RN37SvQrYUdBBHDDXMUB5sfwy1vTV3JLreXi6PEGoVKG78AnQN6smuajwqJ6U) |
| Copy Trade | [34xxXyZh...](https://solscan.io/tx/34xxXyZhcug7A8Jm6AqZ1D3ybpfXRqunZPk9NKZxqEXwnD4sEGsjuSx3VZqSGWGf6QVAhEPMfRuSt5ESxNL6USz) |

### Latency Breakdown (Sell, Parallel Submission)

| Stage | Time | Notes |
|-------|------|-------|
| Jupiter Quote | 61ms | ExactOut (token → USDC) |
| Jito+RPC Send | 286ms | Both sent in parallel |
| **Copy Latency** | **359ms** | Detection → sent |
| Confirmation | 566ms | Block inclusion |
| **Total Time** | **852ms** | |

### Result: ✅ SUCCESS

---

## Test 5: Copy WIF Buy Trade (Pre-Built Transactions)

**Optimizations Enabled:**
- Quote pre-fetching (3s interval)
- HTTP keep-alive connections
- Priority fee: 200,000 microlamports
- Parallel Jito + RPC submission
- **NEW: Pre-built transaction optimization** (transactions built and signed in advance)

**Action**: Made trade on Fomo app to buy $2 of WIF

### Trade Detection

```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: buy
  Token: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  USDC Amount: $2.00
  Signature: 5oXoUu2Uf56Bgw6E5Dgk7WP25RF4YiBojFkg7kPShu6ey24VWAqFEf5s4tFc1h9RA2VTpNcvRouczURxg1XwLC9S
```

### Copy Trade Execution (Pre-Built Transaction)

```
[CopyTradeEngine] === COPYING TRADE ===
  Original: buy EKpQGSJt... for $2.00
  Copy: BUY EKpQGSJt... for $2
[JupiterExecutor] Buying EKpQGSJt... with $2 USDC
[JupiterExecutor] ⚡ Using pre-built transaction (age: 21001ms)
[Subscription] Trade notification sent to 1 subscriber(s) for 8ZhZwcho...
[JupiterExecutor] Jito bundle submitted: 97606901e33713a85972c22bc347eb98fe3a85984f8c4ab00c6a1aed2110153a
[JupiterExecutor] Sent via BOTH Jito + RPC (parallel)
[JupiterExecutor] Swap sent (pre-built) in 182ms: 2kYxvgdJ48czpeCmo3pGtmDNjH1wDAuy4FrZj4LpHDXBTHcvEFKi78zKKk8SUfwR79TsxAHfSkvL9t1rYBdeaoxh
[CopyTradeEngine] Copy trade SENT!
  Signature: 2kYxvgdJ48czpeCmo3pGtmDNjH1wDAuy4FrZj4LpHDXBTHcvEFKi78zKKk8SUfwR79TsxAHfSkvL9t1rYBdeaoxh
  Copy latency: 186ms
  End-to-end latency: 186ms

========================================
COPY TRADE SUCCESSFUL!
Original: 5oXoUu2Uf56Bgw6E5Dgk7WP25RF4YiBojFkg7kPShu6ey24VWAqFEf5s4tFc1h9RA2VTpNcvRouczURxg1XwLC9S
Copy: 2kYxvgdJ48czpeCmo3pGtmDNjH1wDAuy4FrZj4LpHDXBTHcvEFKi78zKKk8SUfwR79TsxAHfSkvL9t1rYBdeaoxh
Latency: 186ms (copy) / 186ms (e2e)
========================================

[JupiterExecutor] Pre-built transaction for EKpQGSJt... in 132ms (valid for 45s)
[JupiterExecutor] Transaction confirmed in 546ms (total: 728ms): 2kYxvgdJ48czpeCmo3pGtmDNjH1wDAuy4FrZj4LpHDXBTHcvEFKi78zKKk8SUfwR79TsxAHfSkvL9t1rYBdeaoxh
```

### Transaction Links

| Transaction | Solscan Link |
|-------------|--------------|
| Original (Fomo) | [5oXoUu2U...](https://solscan.io/tx/5oXoUu2Uf56Bgw6E5Dgk7WP25RF4YiBojFkg7kPShu6ey24VWAqFEf5s4tFc1h9RA2VTpNcvRouczURxg1XwLC9S) |
| Copy Trade | [2kYxvgdJ...](https://solscan.io/tx/2kYxvgdJ48czpeCmo3pGtmDNjH1wDAuy4FrZj4LpHDXBTHcvEFKi78zKKk8SUfwR79TsxAHfSkvL9t1rYBdeaoxh) |

### Latency Breakdown (Pre-Built Transaction)

| Stage | Time | Notes |
|-------|------|-------|
| Pre-built TX lookup | **~1ms** | Transaction already signed and ready |
| Jito+RPC Send | **182ms** | Both sent in parallel |
| **Copy Latency** | **186ms** | Detection → sent |
| Confirmation | 546ms | Block inclusion |
| **Total Time** | **728ms** | |
| Background rebuild | 132ms | Async replacement for next trade |

### Optimization Impact (All Tests)

| Metric | Test 1 | Test 2 | Test 3 | Test 5 (Pre-Built) | Best Improvement |
|--------|--------|--------|--------|--------------------| -----------------|
| Quote/Build | 289ms | 0ms | 0ms | **~1ms** | **-288ms** |
| Transaction send | 205ms | 417ms | 183ms | **182ms** | -23ms |
| **Copy latency** | 503ms | 426ms | 192ms | **186ms** | **-317ms (63%)** |
| Confirmation | 947ms | 707ms | 397ms | **546ms** | -401ms |
| **Total time** | 1,152ms | 1,124ms | 580ms | **728ms** | -424ms |

### How Pre-Built Works

1. **Background**: Transaction pre-built and signed 21 seconds before trade
2. **Detection**: Trade detected, pre-built transaction retrieved from cache (~1ms)
3. **Execution**: Already-signed transaction sent immediately (182ms)
4. **Cleanup**: Used transaction deleted from cache
5. **Replenish**: New transaction built async in background (132ms) for next trade

**Key Insight**: 
- Eliminates ~150ms Jupiter swap API call + transaction signing
- Transaction was 21s old but still valid (blockhash TTL is 45s)
- Slight improvement over Test 3 (192ms → 186ms, **-6ms or 3% faster**)
- Most time now spent on network send, not transaction preparation

### Result: ✅ SUCCESS

---

## Test 6: Position Tracking & Risk Limits

**Optimizations Enabled:**
- Pre-built transactions
- Parallel Jito + RPC submission
- Quote caching
- **NEW: Position tracking with risk limits**

**Test Configuration:**
```bash
MAX_POSITION_SIZE_USDC=4      # Very low for testing
MAX_TOTAL_EXPOSURE_USDC=10
MAX_OPEN_POSITIONS=2
MIN_USDC_RESERVE=10
TRADE_AMOUNT_USDC=2
```

**Action**: Made 3 consecutive $2 WIF buy trades to test risk limits

### Trade 1: Position Opened

```
[CopyTradeEngine] === COPYING TRADE ===
  Original: buy EKpQGSJt... for $2.00
  Copy: BUY EKpQGSJt... for $2
[JupiterExecutor] Buying EKpQGSJt... with $2 USDC
[JupiterExecutor] ⚡ Using pre-built transaction (age: 33010ms)
[JupiterExecutor] Jito bundle submitted: c351a7966c52b81fcb110d70aa3da640fc6c06fc37bde951d4cd8b2273294b2b
[JupiterExecutor] Sent via BOTH Jito + RPC (parallel)
[JupiterExecutor] Swap sent (pre-built) in 257ms: 3dbfKjKZ...
[CopyTradeEngine] Copy trade SENT!
  Signature: 3dbfKjKZTrpMzApGxQewcxhR3S4Gu7CZrjn797yrM5uH4jRH1HURAHcc4QDQPXrhQfaUqFxeTn9WKfzqCTb9B3R2
  Copy latency: 1775ms
  End-to-end latency: 1775ms

[PositionManager] ✨ Opened new position for EKpQGSJt...:
  Amount: 6084613
  Entry price: $0.000000
  Cost: $2.00
  Open positions: 1/2

[Position] ✨ Opened EKpQGSJt... for $2.00

========================================
COPY TRADE SUCCESSFUL!
Original: 4gyk5mu5VG4fd4vxFe7TU27NzzVq7ew9PpTY6jMRqqhWyEJ6vnYgxTuvFTFGS7f89wxcmQ47xHdufaZAdDnAcjE5
Copy: 3dbfKjKZTrpMzApGxQewcxhR3S4Gu7CZrjn797yrM5uH4jRH1HURAHcc4QDQPXrhQfaUqFxeTn9WKfzqCTb9B3R2
Latency: 1775ms (copy) / 1775ms (e2e)
========================================
```

### Trade 2: Position Updated + Limit Warning

```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: buy
  Token: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  USDC Amount: $2.00
  Signature: 5LUCV1q6JzAwY6oD6Yiq9cn5ycE5innXvt8zWFyeCeHaKgoEE7sdzEUtztcKvnQFcxLYYQC1ghdGHHVXi8GZHr12

[Position] ⚠️ position_size at 100.0% of limit
  Current: $4.00 / Max: $4.00

[CopyTradeEngine] === COPYING TRADE ===
  Original: buy EKpQGSJt... for $2.00
  Copy: BUY EKpQGSJt... for $2
[JupiterExecutor] Buying EKpQGSJt... with $2 USDC
[JupiterExecutor] ⚡ Using pre-built transaction (age: 28464ms)
[JupiterExecutor] Sent via RPC (Jito failed: Resource has been exhausted: Network congested. Endpoint is globally rate limited.)
[JupiterExecutor] Swap sent (pre-built) in 179ms: 3qGpDbm1u3z1kHcCGYeNmnpWtbQVKBkYoruxCT59xs9EQ2PfriHfSfTLxcDPfpNoUmWFPZbXybhmahPBzhj6M4G5
[CopyTradeEngine] Copy trade SENT!
  Signature: 3qGpDbm1u3z1kHcCGYeNmnpWtbQVKBkYoruxCT59xs9EQ2PfriHfSfTLxcDPfpNoUmWFPZbXybhmahPBzhj6M4G5
  Copy latency: 478ms
  End-to-end latency: 478ms

[PositionManager] Updated position for EKpQGSJt...:
  Amount: 12168733
  Avg entry: $0.000000
  Total cost: $4.00
  Trades: 2

========================================
COPY TRADE SUCCESSFUL!
Original: 5LUCV1q6JzAwY6oD6Yiq9cn5ycE5innXvt8zWFyeCeHaKgoEE7sdzEUtztcKvnQFcxLYYQC1ghdGHHVXi8GZHr12
Copy: 3qGpDbm1u3z1kHcCGYeNmnpWtbQVKBkYoruxCT59xs9EQ2PfriHfSfTLxcDPfpNoUmWFPZbXybhmahPBzhj6M4G5
Latency: 478ms (copy) / 478ms (e2e)
========================================
```

### Trade 3: Risk Limit Rejection

```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: buy
  Token: EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm
  USDC Amount: $2.00
  Signature: 3wc7PcrKi2h9tNoYxhoRNgm9cXaTKAhLoJVyMY8GfZXwB1ASmtMxZyWUSSKCNxPFwpJUiPgcTy9pewTyVZ7XsG7U

[CopyTradeEngine] ⛔ Risk limit reached: Would leave USDC below minimum reserve ($10)
```

### Final Statistics & Position Summary

```
=== Copy Trade Statistics ===
Trades detected: 3
Trades filtered: 0
Trades risk-rejected: 1  ← Protected!
Copy attempts: 2
Copy successes: 2
Copy failures: 0
Success rate: 100.0%
Average copy latency: 1127ms
=============================

=== Open Positions ===
Total positions: 1
Total exposure: $4.00

🟢 EKpQGSJt...
  Amount: 12168733
  Entry: $0.000000 | Current: $0.000000
  Cost: $4.00 | Value: $4.00
  P&L: $0.00 (0.00%)
  Hold time: 2m
  Trades: 2 buys, 0 sells

=== Portfolio Summary ===
Total cost: $4.00
Total value: $4.00
Total P&L: $0.00 (0.00%)
========================
```

### Key Observations

**Position Tracking:**
- ✅ First trade opened position: $2 cost, 6.08M tokens
- ✅ Second trade updated position: $4 cost, 12.17M tokens (2 trades)
- ✅ Position summary shows accurate tracking

**Risk Limits:**
- ✅ Warning triggered at 100% of position limit ($4/$4)
- ✅ Third trade rejected: "Would leave USDC below minimum reserve ($10)"
- ✅ System protected capital by preventing over-exposure

**Performance:**
- Trade 1: 1775ms (slower - network variance)
- Trade 2: 478ms (normal performance)
- Both used pre-built transactions (ages 33s and 28s)
- Jito worked on Trade 1, fell back to RPC on Trade 2

**Note**: Price fetching not yet implemented, so P&L shows $0. Entry and current prices both show $0.000000 (using token decimals). This will be fixed when live price API is added.

### Result: ✅ SUCCESS - Risk Limits Working!

---

## Session Statistics

```
=== Copy Trade Statistics ===
Trades detected: 1
Trades filtered: 0
Copy attempts: 1
Copy successes: 1
Copy failures: 0
Success rate: 100.0%
Average copy latency: 503ms
=============================
```

---

## Latency Analysis

### Current Performance

- **186ms** from trade detection to copy trade sent (best config: pre-built transactions + parallel Jito+RPC)
- **~0.73s** total time until confirmation

### Latency Breakdown

| Component | Time | % of Total |
|-----------|------|------------|
| Trade Detection (Shredstream → Analyzer) | ~10ms | 2% |
| Jupiter Quote API | 289ms | 57% |
| Swap Transaction Build + Send | 205ms | 41% |
| **Total Copy Latency** | **503ms** | 100% |

### Optimizations Implemented

1. ✅ **Jito Bundles**
   - Skip mempool, submit directly to block builders
   - Higher chance of landing in same/next block as original trade
   - Trade-off: gRPC submission slower than RPC, but more reliable

2. ✅ **Pre-warm Connections**
   - HTTP keep-alive with `undici` agent
   - 30s connection reuse, 10 concurrent connections

3. ✅ **Higher Priority Fees**
   - Increased from 50k to 200k microlamports
   - Faster block inclusion

4. ✅ **Quote Pre-fetching**
   - Quotes cached for 5 seconds
   - Pre-fetches every 3 seconds for allowed tokens
   - Saves ~289ms on quote fetch

5. ✅ **Parallel Jito + RPC Submission**
   - Sends same signed transaction to both Jito and RPC simultaneously
   - First success wins, validators deduplicate by signature
   - Eliminates ~200ms Jito failure penalty
   - Best of both worlds: Jito speed when available, RPC reliability as backup

6. ✅ **Pre-Built Transactions**
   - Transactions are built and signed in advance (background process)
   - Eliminates ~150ms Jupiter swap API call + signing overhead
   - Transactions cached for 45s (conservative blockhash TTL)
   - Single-use with async rebuild for next trade
   - Background refresh every 30s keeps cache warm

### Latency Summary

| Configuration | Copy Latency | Total Time |
|---------------|-------------|------------|
| Baseline (no optimizations) | 503ms | 1,152ms |
| With Jito fallback + Quote Cache | 426ms | 1,124ms |
| Parallel Jito+RPC + Quote Cache | 192ms | 580ms |
| **Pre-Built TX + Parallel Jito+RPC** | **186ms** | **728ms** |

**Note**: Pre-built transactions provide the fastest copy latency by eliminating transaction build time. The slightly higher total time (728ms vs 580ms) is due to variance in network conditions between test runs.

---

## Architecture

```
Shredstream ──► TransactionProcessor ──► TradeAnalyzer
                                              │
                                              ▼
                                        CopyTradeEngine
                                              │
                                              ▼
                                        JupiterExecutor
                                              │
                                              ▼
                                         Jupiter API
                                              │
                                              ▼
                                        Solana Network
```

---

## Notes

- Copy trading is triggered by trades detected via Shredstream (real-time transaction feed)
- The bot copies to the same wallet that made the original trade (for testing)
- In production, you would track a different wallet (whale/signal provider)
- Sells are currently filtered out (buy-only mode)
- Only WIF token is allowed (configurable via `ALLOWED_TOKENS`)

