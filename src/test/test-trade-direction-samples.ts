/**
 * Manual check of trade direction and USDC amount using parseTradeDetails.
 *
 * This test calls parseTradeDetails which internally uses both parseAggregatorInstruction
 * and analyzeTokenTransfers to determine trade details.
 *
 * Run with:
 *   RPC_ENDPOINT=https://solana-mainnet.g.alchemy.com/v2/rHh9-faE9mkIfUP3TRiTW npm run test:trade-direction
 */

import { Connection } from '@solana/web3.js';
import { TradeAnalyzer } from '../services/trade-analyzer.js';
import type { DecodedTransaction } from '../types/transaction.js';

const RPC_URL = process.env.RPC_ENDPOINT || '';

if (!RPC_URL) {
  console.error('Please set RPC_ENDPOINT to a mainnet RPC URL');
  process.exit(1);
}

const samples = [
  {
    signature: '56gaKhd4Rziu7TU5Er3cRgd91vUqRFccnNnrvQVVon7Jo68T2wLvVaDuJpm55ZnoekEZoeaKKCNAJFHDRkeHh4Vd',
    expectedDirection: 'buy' as const,
    expectedUsdc: 22.617872,
    aggregator: 'okx' as const,
  },
  {
    signature: '4xZahWNpbPxcj3rKXmqQ3312Lkm9iTcHqjC8yvWdzqAefqmLFnnVBjeBjT4k1m7RtScqNfV1LERMBXFmMARJWULU',
    expectedDirection: 'sell' as const,
    expectedUsdc: 0.95,
    aggregator: 'okx' as const,
  },
];

async function main() {
  const connection = new Connection(RPC_URL);
  const analyzer = new TradeAnalyzer({ rpcUrl: RPC_URL });

  for (const sample of samples) {
    console.log(`\nChecking ${sample.signature} ...`);

    const txRes = await connection.getTransaction(sample.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: 'confirmed',
    });

    if (!txRes || !txRes.transaction) {
      console.error('Transaction not found');
      continue;
    }

    // Create DecodedTransaction object from RPC response
    const rawTx: any = txRes.transaction;
    const message: any = rawTx.message;
    
    // Check if versioned transaction
    const isVersioned = ('version' in rawTx && rawTx.version !== null && rawTx.version !== undefined) ||
                        (message?.constructor?.name === 'MessageV0') ||
                        (typeof message?.getAccountKeys === 'function');
    
    // Build account keys from static keys + lookup table addresses
    let accountKeys: string[] = [];
    if (isVersioned) {
      const staticKeys = message.staticAccountKeys || [];
      accountKeys = staticKeys.map((k: any) => 
        typeof k === 'string' ? k : k.toBase58()
      );
    } else {
      // Legacy - use accountKeys from message
      if (message.accountKeys) {
        accountKeys = message.accountKeys.map((k: any) => 
          typeof k === 'string' ? k : k.toBase58()
        );
      }
    }
    
    // Build full account keys including lookup table addresses
    let fullAccountKeys = [...accountKeys];
    const loaded = txRes.meta?.loadedAddresses;
    if (loaded) {
      const extras = [
        ...(loaded.writable || []),
        ...(loaded.readonly || []),
      ].map((k: any) => (typeof k === 'string' ? k : k.toBase58()));
      fullAccountKeys = [...fullAccountKeys, ...extras];
    }
    
    // Create DecodedTransaction object
    // The transaction object from RPC should already be a Transaction or VersionedTransaction
    const decodedTx: DecodedTransaction = {
      signature: sample.signature,
      transaction: rawTx as any, // Use the transaction object directly - it's already the right type
      accountKeys,
      slot: txRes.slot || 0,
      isVersioned,
    };
    
    // Use fee payer as user address
    const userAddress = fullAccountKeys[0];

    // Call parseTradeDetails with the appropriate aggregator
    try {
      const trade = await (analyzer as any).parseTradeDetails(
        decodedTx,
        sample.aggregator,
        userAddress,
        fullAccountKeys
      );

      if (!trade) {
        console.error('  Could not parse trade details (returned null)');
        continue;
      }

      // Verify results
      const delta = Math.abs(trade.usdcAmount - sample.expectedUsdc);
      const amountOk = delta < 0.5; // allow some slippage/fees difference

      console.log(`  Trade details:`);
      console.log(`    - direction: ${trade.direction}`);
      console.log(`    - tokenMint: ${trade.tokenMint}`);
      console.log(`    - usdcAmount: ${trade.usdcAmount.toFixed(6)}`);
      console.log(`    - tokenAmount: ${trade.tokenAmount.toString()}`);
      console.log(`    - aggregator: ${trade.aggregator}`);
      
      console.log(`  Verification:`);
      console.log(`    Direction: expected=${sample.expectedDirection}, got=${trade.direction}`);
      console.log(`    USDC: expected≈${sample.expectedUsdc}, got=${trade.usdcAmount.toFixed(6)} (delta=${delta.toFixed(6)})`);

      if (trade.direction === sample.expectedDirection && amountOk) {
        console.log('  ✅ PASS');
      } else {
        console.log('  ❌ FAIL');
      }
    } catch (error) {
      console.error(`  Error parsing trade details: ${error}`);
      if (error instanceof Error) {
        console.error(`    ${error.stack}`);
      }
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
