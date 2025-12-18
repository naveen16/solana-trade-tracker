/**
 * Fomo Solana Trade Tracker & Copy Trading Bot
 * 
 * Real-time trade tracking and copy trading service that:
 * 1. Ingests Solana transactions via Jito Shredstream
 * 2. Detects trades routed through OKX and DFlow aggregators
 * 3. Provides WebSocket API for subscribing to address trade notifications
 * 4. Optionally copies trades from tracked wallets (when KEYPAIR_PATH is set)
 */

import dotenv from 'dotenv';
import { Connection } from '@solana/web3.js';
import { ShredstreamClient } from './services/shredstream-client.js';
import { ShredstreamEvents, SubscriptionEvents, TransactionEvents, TradeEvents } from './constants/events.js';
import { TransactionProcessor } from './services/transaction-processor.js';
import { TradeAnalyzer } from './services/trade-analyzer.js';
import { SubscriptionManager } from './api/subscription-manager.js';
import { TradeWebSocketServer } from './api/websocket-server.js';
import { WalletManager } from './services/wallet-manager.js';
import { JupiterExecutor } from './services/jupiter-executor.js';
import { CopyTradeEngine, CopyTradeEvents } from './services/copy-trade-engine.js';
import { PositionManager, PositionEvents } from './services/position-manager.js';
import { TradeFilter } from './services/trade-filter.js';
import { ExitManager, ExitEvents } from './services/exit-manager.js';
import { SHREDSTREAM_ENDPOINT } from './constants/aggregators.js';
import { WIF_MINT } from './constants/tokens.js';

dotenv.config();

const rpcEndpoint = process.env.RPC_ENDPOINT;
if (!rpcEndpoint) {
  console.error('Error: RPC_ENDPOINT environment variable is required');
  console.error('Please set RPC_ENDPOINT to your Solana RPC endpoint URL');
  process.exit(1);
}

const config = {
  shredstreamEndpoint: process.env.SHREDSTREAM_ENDPOINT || SHREDSTREAM_ENDPOINT,
  wsPort: parseInt(process.env.WS_PORT || '8080', 10),
  rpcEndpoint,
  // Copy trading config (optional - only enabled if KEYPAIR_PATH is set)
  keypairPath: process.env.KEYPAIR_PATH,
  jupiterApiKey: process.env.JUPITER_API_KEY,
  targetWallets: process.env.TARGET_WALLETS
    ? process.env.TARGET_WALLETS.split(',').map(w => w.trim()).filter(w => w.length > 0)
    : [],
  tradeAmountUsdc: parseFloat(process.env.TRADE_AMOUNT_USDC || '2'),
  allowedTokens: process.env.ALLOWED_TOKENS
    ? process.env.ALLOWED_TOKENS.split(',').map(t => t.trim())
    : [WIF_MINT],
  slippageBps: parseInt(process.env.SLIPPAGE_BPS || '100', 10),
  // Higher priority fee = faster block inclusion (200k default, ~0.0002 SOL per tx)
  priorityFee: parseInt(process.env.PRIORITY_FEE || '200000', 10),
  // Jito bundle configuration
  useJito: process.env.USE_JITO === 'true',
  jitoTipLamports: parseInt(process.env.JITO_TIP_LAMPORTS || '1000000', 10), // 0.001 SOL default
  // Risk management limits
  maxPositionSizeUsdc: parseFloat(process.env.MAX_POSITION_SIZE_USDC || '50'), // Max $50 per token
  maxTotalExposureUsdc: parseFloat(process.env.MAX_TOTAL_EXPOSURE_USDC || '200'), // Max $200 total
  maxOpenPositions: parseInt(process.env.MAX_OPEN_POSITIONS || '10', 10), // Max 10 tokens
  minUsdcReserve: parseFloat(process.env.MIN_USDC_RESERVE || '10'), // Keep $10 USDC reserve
  // Smart trade filters
  filterEnabled: process.env.FILTER_ENABLED !== 'false', // Enabled by default
  filterMinLiquidityUsdc: parseFloat(process.env.FILTER_MIN_LIQUIDITY_USDC || '50000'), // $50k
  filterMaxPriceImpactPercent: parseFloat(process.env.FILTER_MAX_PRICE_IMPACT_PERCENT || '2'), // 2%
  filterMinTokenAgeSeconds: parseInt(process.env.FILTER_MIN_TOKEN_AGE_SECONDS || '3600', 10), // 1 hour
  filterMin24hVolumeUsdc: parseFloat(process.env.FILTER_MIN_24H_VOLUME_USDC || '10000'), // $10k
  filterMaxRecentPumpPercent: parseFloat(process.env.FILTER_MAX_RECENT_PUMP_PERCENT || '50'), // 50%
  // Auto exit strategy
  exitEnabled: process.env.EXIT_ENABLED === 'true', // Disabled by default
  exitTakeProfitTargets: process.env.EXIT_TAKE_PROFIT_TARGETS || '50:25,100:50,300:100', // profit%:sell%
  exitStopLossPercent: parseFloat(process.env.EXIT_STOP_LOSS_PERCENT || '-30'), // -30%
  exitMaxHoldHours: process.env.EXIT_MAX_HOLD_HOURS ? parseFloat(process.env.EXIT_MAX_HOLD_HOURS) : 24,
  exitTrailingStopPercent: process.env.EXIT_TRAILING_STOP_PERCENT ? parseFloat(process.env.EXIT_TRAILING_STOP_PERCENT) : undefined,
  exitTrailingActivationPercent: process.env.EXIT_TRAILING_ACTIVATION_PERCENT ? parseFloat(process.env.EXIT_TRAILING_ACTIVATION_PERCENT) : undefined,
  exitCheckIntervalSeconds: parseInt(process.env.EXIT_CHECK_INTERVAL_SECONDS || '30', 10),
};

// Copy trading requires both keypair AND Jupiter API key
const copyTradingEnabled = !!(config.keypairPath && config.jupiterApiKey);

// Warn if partially configured
if (config.keypairPath && !config.jupiterApiKey) {
  console.warn('WARNING: KEYPAIR_PATH is set but JUPITER_API_KEY is missing.');
  console.warn('Get a free API key at https://portal.jup.ag/ to enable copy trading.');
}

async function main() {
  // Handle unhandled promise rejections to prevent crashes
  process.on('unhandledRejection', (reason) => {
    console.error('[Unhandled Rejection]', reason);
    // Don't exit, just log the error
  });

  // Handle uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('[Uncaught Exception]', error);
    // Don't exit immediately, but log the error
  });

  console.log('===========================================');
  console.log('   FOMO SOLANA TRADE TRACKER');
  if (copyTradingEnabled) {
    console.log('   + COPY TRADING BOT');
  }
  console.log('===========================================\n');
  
  console.log('Configuration:');
  console.log(`  Shredstream: ${config.shredstreamEndpoint}`);
  console.log(`  WebSocket port: ${config.wsPort}`);
  console.log(`  RPC: ${config.rpcEndpoint.slice(0, 40)}...`);
  console.log(`  Copy trading: ${copyTradingEnabled ? 'ENABLED' : 'DISABLED'}`);
  if (copyTradingEnabled) {
    console.log(`  Trade amount: $${config.tradeAmountUsdc}`);
    console.log(`  Allowed tokens: ${config.allowedTokens.map(t => t.slice(0, 8) + '...').join(', ')}`);
    console.log(`  Jito bundles: ${config.useJito ? 'ENABLED' : 'disabled'}`);
    if (config.useJito) {
      console.log(`  Jito tip: ${config.jitoTipLamports / 1_000_000_000} SOL`);
    }
  }
  console.log('');

  // Initialize RPC connection
  const connection = new Connection(config.rpcEndpoint, { commitment: 'confirmed' });

  const subscriptionManager = new SubscriptionManager();
  const wsServer = new TradeWebSocketServer(subscriptionManager);
  const shredstreamClient = new ShredstreamClient({
    endpoint: config.shredstreamEndpoint,
    reconnectDelay: 5000,
    maxReconnectAttempts: 10,
  });
  const txProcessor = new TransactionProcessor();
  const tradeAnalyzer = new TradeAnalyzer({ rpcUrl: config.rpcEndpoint });

  // Initialize copy trading components (if enabled)
  let copyTradeEngine: CopyTradeEngine | null = null;
  let exitManager: ExitManager | undefined;
  
  if (copyTradingEnabled) {
    console.log('Initializing copy trading...');
    
    const walletManager = new WalletManager({
      keypairPath: config.keypairPath!,
      connection,
    });
    
    await walletManager.printStatus();

    // Initialize position manager with risk limits
    const positionManager = new PositionManager(connection, {
      maxPositionSizeUsdc: config.maxPositionSizeUsdc,
      maxTotalExposureUsdc: config.maxTotalExposureUsdc,
      maxOpenPositions: config.maxOpenPositions,
      minUsdcReserve: config.minUsdcReserve,
    });

    // Initialize trade filter with smart filters
    const tradeFilter = new TradeFilter(connection, {
      enabled: config.filterEnabled,
      minLiquidityUsdc: config.filterMinLiquidityUsdc,
      maxPriceImpactPercent: config.filterMaxPriceImpactPercent,
      minTokenAgeSeconds: config.filterMinTokenAgeSeconds,
      min24hVolumeUsdc: config.filterMin24hVolumeUsdc,
      maxRecentPumpPercent: config.filterMaxRecentPumpPercent,
      whitelist: config.allowedTokens, // Allowed tokens bypass filters
    });

    // Start background metadata refresh
    if (config.filterEnabled) {
      tradeFilter.startBackgroundRefresh(60000); // Every 60s
    }
    
    const jupiterExecutor = new JupiterExecutor({
      connection,
      keypair: walletManager.getKeypair(),
      apiKey: config.jupiterApiKey!,
      slippageBps: config.slippageBps,
      priorityFeeMicroLamports: config.priorityFee,
      skipPreflight: true,
      useJito: config.useJito,
      jitoTipLamports: config.jitoTipLamports,
    });

    // Start pre-fetching quotes for allowed tokens
    // This keeps quotes warm so we can execute faster when a trade is detected
    if (config.allowedTokens.length > 0) {
      jupiterExecutor.startQuotePreFetch(config.allowedTokens, config.tradeAmountUsdc, 3000);
    }
    
    copyTradeEngine = new CopyTradeEngine(
      {
        tradeAmountUsdc: config.tradeAmountUsdc,
        allowedTokens: config.allowedTokens,
        copyBuysOnly: false,
        minTradeUsdc: 0.1,
      },
      jupiterExecutor,
      walletManager,
      positionManager,  // Enable position tracking
      tradeFilter  // Enable smart trade filters
    );
    
    // Set up copy trade event handlers
    copyTradeEngine.on(CopyTradeEvents.COPY_COMPLETE, (result) => {
      console.log('\n========================================');
      console.log('COPY TRADE SUCCESSFUL!');
      console.log(`Original: ${result.originalTrade.signature}`);
      console.log(`Copy: ${result.copyResult.signature}`);
      console.log(`Latency: ${result.copyLatencyMs}ms (copy) / ${result.endToEndLatencyMs}ms (e2e)`);
      console.log('========================================\n');
    });
    
    copyTradeEngine.on(CopyTradeEvents.COPY_FAILED, ({ trade, error }) => {
      console.error('\n========================================');
      console.error('COPY TRADE FAILED!');
      console.error(`Original: ${trade.signature}`);
      console.error(`Error: ${error}`);
      console.error('========================================\n');
    });

    // Set up position event handlers
    positionManager.on(PositionEvents.POSITION_OPENED, (position) => {
      console.log(`\n[Position] ✨ Opened ${position.symbol || position.tokenMint.slice(0, 8)}... for $${position.totalCostUsdc.toFixed(2)}`);
    });

    positionManager.on(PositionEvents.POSITION_CLOSED, (event: any) => {
      const pnlEmoji = event.realizedPnlUsdc >= 0 ? '💰' : '📉';
      console.log(`\n[Position] ${pnlEmoji} Closed ${event.symbol || event.tokenMint.slice(0, 8)}...`);
      console.log(`  Realized P&L: $${event.realizedPnlUsdc.toFixed(2)} (${event.realizedPnlPercent.toFixed(2)}%)`);
    });

    positionManager.on(PositionEvents.LIMIT_WARNING, (warning: any) => {
      console.warn(`\n[Position] ⚠️ ${warning.type} at ${warning.percent.toFixed(1)}% of limit`);
      console.warn(`  Current: $${warning.current.toFixed(2)} / Max: $${warning.max.toFixed(2)}`);
    });

    // Initialize exit manager if enabled
    if (config.exitEnabled) {
      // Parse take profit targets
      const takeProfitTargets = config.exitTakeProfitTargets.split(',').map(tp => {
        const [profitPercent, sellPercent] = tp.split(':').map(Number);
        return { profitPercent, sellPercent };
      });

      exitManager = new ExitManager(
        {
          takeProfitTargets,
          stopLossPercent: config.exitStopLossPercent,
          maxHoldTimeHours: config.exitMaxHoldHours,
          trailingStopPercent: config.exitTrailingStopPercent,
          trailingActivationPercent: config.exitTrailingActivationPercent,
        },
        positionManager,
        jupiterExecutor,
        config.exitCheckIntervalSeconds
      );

      // Set up exit event handlers
      exitManager.on(ExitEvents.EXIT_TRIGGERED, (event: any) => {
        console.log(`\n[Exit] 🎯 ${event.exitType} triggered for ${event.position.symbol || event.position.tokenMint.slice(0, 8)}...`);
        console.log(`  ${event.reason}`);
      });

      exitManager.on(ExitEvents.EXIT_EXECUTED, (event: any) => {
        console.log(`[Exit] ✅ Executed: ${event.signature}`);
      });

      exitManager.on(ExitEvents.EXIT_FAILED, (event: any) => {
        console.error(`[Exit] ❌ Failed: ${event.error}`);
      });

      // Start background checking
      exitManager.start();
    }
    
    // Subscribe copy trade engine to trade events
    copyTradeEngine.subscribe(tradeAnalyzer);
    
    // Track initial target wallets from .env
    for (const wallet of config.targetWallets) {
      tradeAnalyzer.addTrackedUser(wallet);
      console.log(`[CopyTrader] Tracking wallet: ${wallet}`);
    }
  }

  // Wire up the event pipeline:
  // 1. ShredstreamClient receives raw entries from Jito
  // 2. TransactionProcessor decodes entries into transactions
  // 3. TradeAnalyzer detects OKX/DFlow trades in transactions
  // 4. SubscriptionManager notifies subscribed clients

  txProcessor.subscribe(shredstreamClient);

  // Only analyze transactions involving addresses that clients are subscribed to
  txProcessor.on(TransactionEvents.TRANSACTION, (decodedTx) => {
    const trackedAddresses = subscriptionManager.getTrackedAddresses();
    if (trackedAddresses.length === 0) {
      return;
    }

    const involvedAddress = decodedTx.accountKeys.find((key: string) => 
      subscriptionManager.isAddressTracked(key)
    );

    if (involvedAddress) {
      // Handle async errors to prevent unhandled promise rejections
      tradeAnalyzer.analyzeTransaction(decodedTx).catch((error) => {
        console.error(`[TradeAnalyzer] Error analyzing transaction ${decodedTx.signature}:`, error);
        tradeAnalyzer.emit(TradeEvents.ERROR, error);
      });
    }
  });

  // Forward detected trades to subscription manager for client notification
  tradeAnalyzer.on(TradeEvents.TRADE, (trade) => {
    subscriptionManager.handleTrade(trade);
  });

  // Dynamically update tracked users when subscriptions change
  subscriptionManager.on(SubscriptionEvents.ADDRESS_ADDED, (address: string) => {
    tradeAnalyzer.addTrackedUser(address);
    console.log(`[Tracker] Now tracking: ${address}`);
  });

  subscriptionManager.on(SubscriptionEvents.ADDRESS_REMOVED, (address: string) => {
    tradeAnalyzer.removeTrackedUser(address);
    console.log(`[Tracker] Stopped tracking: ${address}`);
  });

  // Error handling for all components
  shredstreamClient.on(ShredstreamEvents.ERROR, (error) => {
    console.error('[Shredstream] Error:', error.message);
  });

  txProcessor.on(TransactionEvents.ERROR, (error) => {
    console.error('[TxProcessor] Error:', error.message);
  });

  tradeAnalyzer.on(TradeEvents.ERROR, (error) => {
    console.error('[TradeAnalyzer] Error:', error.message);
  });

  shredstreamClient.on(ShredstreamEvents.CONNECTED, () => {
    console.log('[Shredstream] Connected');
  });

  shredstreamClient.on(ShredstreamEvents.DISCONNECTED, () => {
    console.log('[Shredstream] Disconnected');
  });

  wsServer.start(config.wsPort);

  try {
    await shredstreamClient.connect();
  } catch (error) {
    console.error('Failed to connect to Shredstream:', error);
    process.exit(1);
  }

  // Periodic stats logging (only when there are active subscriptions)
  setInterval(() => {
    const stats = wsServer.getStats();
    if (stats.connectedClients > 0 || stats.subscriptionStats.totalAddresses > 0) {
      console.log(`[Stats] ${stats.connectedClients} clients, ${stats.subscriptionStats.totalAddresses} addresses tracked`);
    }
  }, 30000);

  // Periodic position logging for copy trading (every 5 minutes)
  if (copyTradeEngine) {
    setInterval(() => {
      const posManager = copyTradeEngine.getPositionManager();
      if (posManager && posManager.getPositions().length > 0) {
        posManager.printPositions().catch(err => {
          console.error('[Position] Error printing positions:', err);
        });
      }
    }, 300000); // 5 minutes
  }

  console.log('');
  console.log('System is running!');
  console.log('');
  console.log('WebSocket API:');
  console.log(`  Connect: ws://localhost:${config.wsPort}`);
  console.log('');
  console.log('  Subscribe:   {"type": "subscribe", "address": "<SOLANA_ADDRESS>"}');
  console.log('  Unsubscribe: {"type": "unsubscribe", "address": "<SOLANA_ADDRESS>"}');
  console.log('  List:        {"type": "get_subscriptions"}');
  if (copyTradingEnabled) {
    console.log('');
    console.log('Copy Trading:');
    console.log('  - Wallets subscribed via WebSocket will be copied automatically');
    console.log(`  - Each copy trade uses $${config.tradeAmountUsdc} USDC`);
  }
  console.log('');

  // Graceful shutdown handlers
  const shutdown = async () => {
    console.log('\nShutting down...');
    if (copyTradeEngine) {
      // Stop exit manager if running
      if (exitManager) {
        exitManager.stop();
        exitManager.printStats();
      }
      
      copyTradeEngine.printStats();
      const posManager = copyTradeEngine.getPositionManager();
      if (posManager) {
        await posManager.printPositions();
      }
    }
    wsServer.stop();
    shredstreamClient.disconnect();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
