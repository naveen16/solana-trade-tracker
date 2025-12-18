# Position Management & Risk Limits

The copy trading bot now includes comprehensive position tracking and risk management.

## Features

### ✅ Implemented

1. **Position Tracking**
   - Tracks all open positions (token, amount, entry price, cost basis)
   - Records buy and sell trades
   - Calculates average entry price for multiple buys
   - Tracks realized P&L on sells

2. **Risk Limits**
   - Max position size per token (default: $50)
   - Max total portfolio exposure (default: $200)
   - Max number of open positions (default: 10 tokens)
   - Min USDC reserve (default: $10)

3. **Real-Time Monitoring**
   - Position opened/closed events
   - Warning alerts at 80% of limits
   - Periodic position snapshots (every 5 min)
   - Final position summary on shutdown

## Configuration

Add these environment variables to your `.env` file:

```bash
# Risk Management Limits
MAX_POSITION_SIZE_USDC=50      # Max $50 per token
MAX_TOTAL_EXPOSURE_USDC=200    # Max $200 total exposure
MAX_OPEN_POSITIONS=10          # Max 10 different tokens
MIN_USDC_RESERVE=10            # Keep $10 USDC buffer
```

## How It Works

### Before Trade Execution

```
1. Trade detected
2. Check risk limits:
   ✓ USDC balance - reserve?
   ✓ Position size < max?
   ✓ Total exposure < max?
   ✓ Open positions < max?
3. If ALL pass → Execute trade
4. If ANY fail → Skip trade (logged as "risk-rejected")
```

### After Successful Trade

```
BUY:
  - Add to position or create new
  - Update average entry price
  - Track signature

SELL:
  - Reduce position or close
  - Calculate realized P&L
  - Track signature
```

## Example Output

### Position Opened
```
[Position] ✨ Opened WIF for $2.00
```

### Position Updated (Multiple Buys)
```
[PositionManager] Updated position for WIF:
  Amount: 12450123
  Avg entry: $0.001234
  Total cost: $15.00
  Trades: 8
```

### Risk Limit Hit
```
[CopyTradeEngine] ⛔ Risk limit reached: Position size limit reached: $52.00 > $50.00
```

### Warning (80% of Limit)
```
[Position] ⚠️ position_size at 85.2% of limit
  Current: $42.60 / Max: $50.00
```

### Position Closed
```
[Position] 💰 Closed WIF
  Realized P&L: $23.45 (156.33%)
```

### Position Summary (Periodic / Shutdown)
```
=== Open Positions ===
Total positions: 3
Total exposure: $120.00

🟢 WIF
  Amount: 12450123
  Entry: $0.001234 | Current: $0.001890
  Cost: $15.00 | Value: $23.45
  P&L: $8.45 (56.33%)
  Hold time: 2h 15m
  Trades: 8 buys, 1 sells

🔴 BONK
  Amount: 98765432
  Entry: $0.000050 | Current: $0.000042
  Cost: $5.00 | Value: $4.15
  P&L: -$0.85 (-17.00%)
  Hold time: 45m
  Trades: 2 buys, 0 sells

=== Portfolio Summary ===
Total cost: $120.00
Total value: $145.67
Total P&L: $25.67 (21.39%)
========================
```

## Trade Rejection Scenarios

| Scenario | Result |
|----------|--------|
| USDC balance $8, reserve $10 | ❌ Rejected: "Would leave USDC below minimum reserve" |
| Position cost $48, buying $4, limit $50 | ❌ Rejected: "Position size limit reached: $52.00 > $50.00" |
| Total exposure $195, buying $10, limit $200 | ❌ Rejected: "Total exposure limit reached: $205.00 > $200.00" |
| 10 positions open, max 10, new token | ❌ Rejected: "Max open positions reached: 10/10" |
| Selling token we don't own | ❌ Rejected: "No position to sell" |

## Statistics

Copy trade stats now include risk rejections:

```
=== Copy Trade Statistics ===
Trades detected: 25
Trades filtered: 5
Trades risk-rejected: 3  ← NEW
Copy attempts: 17
Copy successes: 16
Copy failures: 1
Success rate: 94.1%
Average copy latency: 186ms
=============================
```

## Future Enhancements (Not Yet Implemented)

- [ ] Real-time price fetching (currently uses entry price for P&L)
- [ ] Take profit targets (auto-sell at +50%, +100%, etc.)
- [ ] Stop losses (auto-sell at -30%)
- [ ] Time-based exits (auto-sell after 24h)
- [ ] Trailing stops
- [ ] Position database (persistence)
- [ ] Historical P&L tracking
- [ ] Performance analytics

## Testing

To test risk limits:

1. Set low limits (e.g., `MAX_POSITION_SIZE_USDC=4`)
2. Make a $2 trade (opens position)
3. Make another $2 trade (updates position)
4. Try a 3rd $2 trade → Should be rejected!

```bash
# Test config
MAX_POSITION_SIZE_USDC=4
MAX_TOTAL_EXPOSURE_USDC=10
MAX_OPEN_POSITIONS=2
MIN_USDC_RESERVE=5
```

## Notes

- Positions are currently in-memory only (lost on restart)
- P&L calculation uses entry price until price fetching is implemented
- Risk limits are checked BEFORE executing trades (prevents over-exposure)
- Position tracking is optional (bot works without it)
- All limits are configurable via environment variables

