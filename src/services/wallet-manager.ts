/**
 * Wallet Manager Service
 * 
 * Handles wallet operations for the copy trading bot:
 * - Loading keypair from file
 * - Checking SOL and token balances
 * - Signing transactions
 */

import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { readFileSync } from 'fs';
import { USDC_MINT, TOKEN_PROGRAM_ID } from '../constants/tokens.js';

export interface WalletManagerConfig {
  /** Path to keypair JSON file */
  keypairPath: string;
  /** RPC connection */
  connection: Connection;
}

export interface TokenBalance {
  mint: string;
  balance: number;
  decimals: number;
  rawBalance: bigint;
}

export class WalletManager {
  private keypair: Keypair;
  private connection: Connection;
  public readonly publicKey: PublicKey;

  constructor(config: WalletManagerConfig) {
    // Load keypair from file
    const keypairData = JSON.parse(readFileSync(config.keypairPath, 'utf-8'));
    this.keypair = Keypair.fromSecretKey(new Uint8Array(keypairData));
    this.connection = config.connection;
    this.publicKey = this.keypair.publicKey;

    console.log(`[WalletManager] Loaded wallet: ${this.publicKey.toBase58()}`);
  }

  /**
   * Get the keypair for signing transactions
   */
  getKeypair(): Keypair {
    return this.keypair;
  }

  /**
   * Get SOL balance in SOL (not lamports)
   */
  async getSolBalance(): Promise<number> {
    const balance = await this.connection.getBalance(this.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  /**
   * Get USDC balance
   */
  async getUsdcBalance(): Promise<number> {
    return this.getTokenBalance(USDC_MINT);
  }

  /**
   * Get balance of any SPL token
   */
  async getTokenBalance(mintAddress: string): Promise<number> {
    try {
      const mint = new PublicKey(mintAddress);
      const tokenAccounts = await this.connection.getTokenAccountsByOwner(
        this.publicKey,
        { mint }
      );

      if (tokenAccounts.value.length === 0) {
        return 0;
      }

      // Get the balance from the first token account
      const accountInfo = await this.connection.getTokenAccountBalance(
        tokenAccounts.value[0].pubkey
      );

      return accountInfo.value.uiAmount || 0;
    } catch (error) {
      console.error(`[WalletManager] Error getting token balance for ${mintAddress}:`, error);
      return 0;
    }
  }

  /**
   * Get all token balances for the wallet
   */
  async getAllTokenBalances(): Promise<TokenBalance[]> {
    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        this.publicKey,
        { programId: new PublicKey(TOKEN_PROGRAM_ID) }
      );

      return tokenAccounts.value
        .map(account => {
          const info = account.account.data.parsed.info;
          return {
            mint: info.mint,
            balance: info.tokenAmount.uiAmount || 0,
            decimals: info.tokenAmount.decimals,
            rawBalance: BigInt(info.tokenAmount.amount),
          };
        })
        .filter(b => b.balance > 0);
    } catch (error) {
      console.error('[WalletManager] Error getting all token balances:', error);
      return [];
    }
  }

  /**
   * Print wallet status
   */
  async printStatus(): Promise<void> {
    const solBalance = await this.getSolBalance();
    const usdcBalance = await this.getUsdcBalance();
    
    console.log('\n=== Wallet Status ===');
    console.log(`Address: ${this.publicKey.toBase58()}`);
    console.log(`SOL Balance: ${solBalance.toFixed(4)} SOL`);
    console.log(`USDC Balance: $${usdcBalance.toFixed(2)}`);
    console.log('=====================\n');
  }
}

