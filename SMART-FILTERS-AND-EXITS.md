# Smart Filters & Auto Exit Strategy

Two powerful new systems to improve trade quality and automate profit-taking.

## ✅ Implemented Systems

### 1. Smart Trade Filters

Automatically filters out bad trades before execution.

**What it does:**
- ❌ Blocks low liquidity tokens ($< 50k)
- ❌ Blocks high price impact trades (> 2%)
- ❌ Blocks brand new tokens (< 1 hour old)
- ❌ Blocks low volume tokens (< $10k/24h)
- ❌ Blocks already-pumped tokens (+50% in 5min)
- ✅ Whitelists bypass all filters

**How it works:**
- Cached/hybrid approach (~50ms added latency)
- Fetches metadata from DexScreener API
- Refreshes cache every 60 seconds
- Allowed tokens automatically whitelisted

### 2. Auto Exit Strategy

Automatically exits positions based on profit targets, stop losses, and time limits.

**What it does:**
- 💰 Take profits at +50%, +100%, +300%
- 🛑 Stop loss at -30%
- ⏰ Auto-sell after 24 hours
- 📉 Trailing stops (optional)

**How it works:**
- Background checker runs every 30 seconds
- Fetches prices from Jupiter Price API
- Executes sells via JupiterExecutor
- Updates PositionManager automatically

---

## Configuration

Add these to your `.env` file:

```bash
# ==========================================
# SMART TRADE FILTERS
# ==========================================
FILTER_ENABLED=true                          # Enable smart filters
FILTER_MIN_LIQUIDITY_USDC=50000              # Min $50k liquidity
FILTER_MAX_PRICE_IMPACT_PERCENT=2            # Max 2% price impact
FILTER_MIN_TOKEN_AGE_SECONDS=3600            # Min 1 hour old
FILTER_MIN_24H_VOLUME_USDC=10000             # Min $10k 24h volume
FILTER_MAX_RECENT_PUMP_PERCENT=50            # Max +50% in 5min

# ==========================================
# AUTO EXIT STRATEGY
# ==========================================
EXIT_ENABLED=true                            # Enable auto exits
EXIT_TAKE_PROFIT_TARGETS=50:25,100:50,300:100  # profit%:sell%
EXIT_STOP_LOSS_PERCENT=-30                   # Stop loss at -30%
EXIT_MAX_HOLD_HOURS=24                       # Max hold time 24h
EXIT_CHECK_INTERVAL_SECONDS=30               # Check every 30s

# Optional: Trailing stops
# EXIT_TRAILING_STOP_PERCENT=20              # Drop 20% from high
# EXIT_TRAILING_ACTIVATION_PERCENT=50        # Activate at +50%
```

---

## Smart Filter Examples

### ✅ Good Trade (Passes Filters)
```
Token: WIF
Liquidity: $2.5M ✅
Price Impact: 0.08% ✅
Token Age: 6 months ✅
24h Volume: $50M ✅
Recent Pump: +5% ✅
→ TRADE COPIED
```

### ❌ Bad Trade (Filtered Out)
```
Token: SCAMCOIN
Liquidity: $5k ❌ (< $50k)
→ TRADE REJECTED: "Low liquidity: $5,000 < $50,000"
```

### ❌ Pumped Token (Filtered Out)
```
Token: MOONSHOT
Liquidity: $200k ✅
Price Impact: 1.5% ✅
Token Age: 2 hours ✅
24h Volume: $100k ✅
Recent Pump: +85% ❌ (> +50%)
→ TRADE REJECTED: "Already pumped: +85.0% in 5min > +50%"
```

### ✅ Whitelisted Token (Bypasses All)
```
Token: WIF (in ALLOWED_TOKENS)
→ TRADE COPIED (whitelist bypass)
```

---

## Auto Exit Examples

### Example 1: Take Profit Ladder

```
Entry: $0.001234 (buy $2 of WIF)

Price $0.001851 (+50% profit):
  → Sell 25% of position ✅
  → Realized P&L: +$0.50

Price $0.002468 (+100% profit):
  → Sell 50% of remaining ✅
  → Realized P&L: +$1.00

Price $0.004936 (+300% profit):
  → Sell 100% of remaining ✅
  → Realized P&L: +$3.00

Total Realized: +$4.50 from $2 entry = 225% total gain
```

### Example 2: Stop Loss

```
Entry: $0.001234

Price $0.000864 (-30% loss):
  → Sell 100% immediately 🛑
  → Realized P&L: -$0.60
  → Loss limited!
```

### Example 3: Time Limit

```
Entry: $0.001234 @ 10:00 AM

24 hours later @ 10:00 AM next day:
Price $0.001100 (-10.8%):
  → Sell 100% (max hold time) ⏰
  → Realized P&L: -$0.22
  → Exit even at small loss
```

### Example 4: Trailing Stop (Advanced)

```
Entry: $0.001234

Price $0.001851 (+50%):
  → Trailing stop ACTIVATED
  → High water mark: $0.001851

Price $0.003000 (+143%):
  → New high water mark: $0.003000

Price $0.002400 (-20% from high):
  → Sell 100% (trailing stop hit) 📉
  → Realized P&L: +$1.90 (+95%)
  → Locked in most of the gains!
```

---

## Console Output

### Smart Filter Rejection
```
[CopyTradeEngine] Trade detected from 8ZhZwcho...:
  Direction: buy
  Token: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
  USDC Amount: $2.00

[TradeFilter] Fetching metadata for 7xKXtg2C...
[CopyTradeEngine] 🚫 Trade filtered: Low liquidity: $5,432 < $50,000
```

### Take Profit Hit
```
[ExitManager] 💰 Take profit 100% hit for WIF
  Current: 102.34% profit
  Action: Sell 50% of position

[Exit] 🎯 take_profit triggered for WIF
  TP 100% hit

[Exit] ✅ Executed: 3dbfKjKZTrpMzApGxQewcxhR3S4Gu7CZrjn797yrM5uH...

[Position] 💰 Closed WIF
  Realized P&L: $2.05 (102.34%)
```

### Stop Loss Hit
```
[ExitManager] 🛑 Stop loss hit for BONK
  Current: -32.15% (threshold: -30%)
  Action: Sell 100% of position

[Exit] 🎯 stop_loss triggered for BONK
  Stop loss -30% hit

[Exit] ✅ Executed: 5LUCV1q6JzAwY6oD6Yiq9cn5ycE5innXvt8zWFyeCeHa...
```

---

## Statistics

Both systems track detailed statistics:

### Filter Stats (in Copy Trade Stats)
```
=== Copy Trade Statistics ===
Trades detected: 10
Trades filtered: 4  ← Smart filters blocked 4 trades
Trades risk-rejected: 1
Copy attempts: 5
Copy successes: 5
```

### Exit Stats (on Shutdown)
```
=== Exit Manager Statistics ===
Checks performed: 480       (every 30s for 4h)
Exits triggered: 5
  Take profits: 3          💰
  Stop losses: 1           🛑
  Time limits: 1           ⏰
  Trailing stops: 0
Exits failed: 0
================================
```

---

## Performance Impact

### Latency Impact

| System | Added Latency | Notes |
|--------|--------------|-------|
| **Smart Filters** | ~50ms | Cached metadata, DexScreener API |
| **Auto Exits** | 0ms | Runs in background, doesn't block trades |

**Total copy latency**: ~236ms (186ms base + 50ms filters)

### API Usage

| API | Calls/Minute | Tier |
|-----|-------------|------|
| DexScreener | ~1-5 | Free (public API) |
| Jupiter Price API | ~2-4 | Free (v4 API) |

---

## Testing

### Test Smart Filters

```bash
# Set aggressive filter limits
FILTER_MIN_LIQUIDITY_USDC=5000000  # $5M (very high)
FILTER_MAX_PRICE_IMPACT_PERCENT=0.1  # 0.1% (very low)

# Start bot
npm run dev

# Make a trade - should be filtered!
```

### Test Auto Exits

```bash
# Set fast exits for testing
EXIT_ENABLED=true
EXIT_TAKE_PROFIT_TARGETS=5:50,10:100  # TP at +5% and +10%
EXIT_STOP_LOSS_PERCENT=-5              # SL at -5%
EXIT_CHECK_INTERVAL_SECONDS=10         # Check every 10s

# Make a trade, wait for price movement
# Exits will trigger automatically
```

---

## Customization Examples

### Conservative Strategy
```bash
# Lower TPs, tighter SL
EXIT_TAKE_PROFIT_TARGETS=25:50,50:50  # Take profits earlier
EXIT_STOP_LOSS_PERCENT=-20             # Tighter stop loss
EXIT_MAX_HOLD_HOURS=12                 # Shorter hold time
```

### Aggressive Strategy
```bash
# Higher TPs, wider SL
EXIT_TAKE_PROFIT_TARGETS=100:25,200:50,500:100
EXIT_STOP_LOSS_PERCENT=-50             # Let losers run
EXIT_MAX_HOLD_HOURS=168                # Hold for a week
```

### Day Trading Strategy
```bash
# Quick exits
EXIT_TAKE_PROFIT_TARGETS=10:100        # Take 10% profit and exit
EXIT_STOP_LOSS_PERCENT=-5              # Tight stop
EXIT_MAX_HOLD_HOURS=2                  # Max 2 hours
EXIT_CHECK_INTERVAL_SECONDS=10         # Check every 10s
```

---

## Architecture

```
Trade Detected
     ↓
Smart Filters Check (~50ms)
  - Liquidity ✓
  - Price Impact ✓
  - Token Age ✓
  - Volume ✓
  - Recent Pump ✓
     ↓
Position Risk Limits
     ↓
Execute Copy Trade
     ↓
Position Opened
     ↓
Background Exit Manager (every 30s)
  - Fetch current prices
  - Check TP targets
  - Check stop loss
  - Check time limit
  - Check trailing stop
     ↓
Exit Triggered → Execute Sell → Position Closed
```

---

## Notes

- **Filters are fail-open**: If metadata fetch fails, trade is allowed (safer than blocking good trades)
- **Exits are persistent**: Exit state (which TPs hit) is tracked per position
- **Partial exits work**: Can sell 25%, then 50% of remainder, etc.
- **Trailing stops are advanced**: Only activate after reaching profit threshold
- **Both systems are optional**: Can disable either or both via `.env`

---

## Future Enhancements (Not Yet Implemented)

- [ ] On-chain token age verification (vs DexScreener)
- [ ] Smart contract analysis (honeypot detection)
- [ ] Holder distribution analysis
- [ ] Dynamic TP/SL based on volatility
- [ ] Position-specific exit strategies
- [ ] Exit on specific events (rug pull detection)
- [ ] Integration with external signals

