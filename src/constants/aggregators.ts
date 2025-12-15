/**
 * Solana program IDs for fomo aggregators
 */

// OKX aggregator program ID
export const OKX_PROGRAM_ID = '6m2CDdhRgxpH4WjvdzxAYbGxwdGUz5MziiL5jek2kBma';

// DFlow aggregator program ID
export const DFLOW_PROGRAM_ID = 'DF1ow4tspfHX9JwWJsAb9epbkA8hmpSEAtxXy1V27QBH';

// Jito Shredstream proxy endpoint
export const SHREDSTREAM_ENDPOINT = '18.234.24.82:50051';

// Example fomo user address (for testing)
export const EXAMPLE_FOMO_USER = '6isQHCmrVqnXju22ej2PraPLYgJhryM11xMRo6GhgNSr';

// Swap instruction discriminators (first 8 bytes of instruction data)
export const OKX_SWAP_DISCRIMINATORS: readonly Uint8Array[] = [
  new Uint8Array([248, 198, 158, 145, 225, 117, 135, 200]), // swap
  new Uint8Array([19, 44, 130, 148, 72, 56, 44, 238]),      // proxy_swap
  new Uint8Array([30, 33, 208, 91, 31, 157, 37, 18]),       // commission_sol_proxy_swap
  new Uint8Array([81, 128, 134, 73, 114, 73, 45, 94]),      // commission_sol_swap
  new Uint8Array([96, 67, 12, 151, 129, 164, 18, 71]),      // commission_spl_proxy_swap
  new Uint8Array([235, 71, 211, 196, 114, 199, 143, 92]),   // commission_spl_swap
  new Uint8Array([69, 200, 254, 247, 40, 52, 118, 202]),    // platform_fee_sol_proxy_swap_v2
  new Uint8Array([69, 164, 210, 89, 146, 214, 173, 67]),    // platform_fee_spl_proxy_swap_v2
  new Uint8Array([240, 224, 38, 33, 176, 31, 241, 175]),    // swap_v3
  new Uint8Array([14, 191, 44, 246, 142, 225, 224, 157]),   // swap_tob_v3
  new Uint8Array([236, 71, 155, 68, 198, 98, 14, 118]),     // swap_tob_v3_enhanced
  new Uint8Array([63, 114, 246, 131, 51, 2, 247, 29]),      // swap_tob_v3_with_receiver
] as const;

export const DFLOW_SWAP_DISCRIMINATORS: readonly Uint8Array[] = [
  // SwapParams instructions
  new Uint8Array([248, 198, 158, 145, 225, 117, 135, 200]), // swap
  new Uint8Array([168, 172, 24, 77, 197, 156, 135, 101]),   // swap_with_destination
  new Uint8Array([205, 77, 127, 108, 241, 32, 196, 195]),   // swap_with_destination_native
  // Swap2Params instructions
  new Uint8Array([65, 75, 63, 76, 235, 91, 91, 136]),       // swap2
  new Uint8Array([95, 123, 213, 246, 122, 1, 86, 231]),     // swap2_with_destination
  new Uint8Array([222, 100, 184, 146, 186, 196, 105, 165]), // swap2_with_destination_native
] as const;

