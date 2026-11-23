import { PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

export const BLIND_DEAL_PROGRAM_ID = new PublicKey(
  "26gAVfqVbETimiSZSnp8ENUV6JkWzWbpoyQ4oh5YxRva",
);

export const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
export const SYSTEM_PROGRAM = SystemProgram.programId;

export const CLUSTERS = {
  "mainnet-beta": "https://api.mainnet-beta.solana.com",
  devnet: "https://api.devnet.solana.com",
  testnet: "https://api.testnet.solana.com",
  localnet: "http://127.0.0.1:8899",
} as const;

export type ClusterName = keyof typeof CLUSTERS;

const IX = {
  initialize: [175, 175, 109, 31, 13, 152, 155, 237],
  lockBuyer: [131, 207, 86, 194, 7, 85, 79, 59],
  lockSeller: [227, 47, 180, 220, 164, 248, 60, 240],
  settle: [175, 42, 185, 87, 144, 131, 102, 212],
  cancelBuyer: [83, 135, 167, 143, 232, 177, 99, 245],
  cancelSeller: [209, 29, 117, 195, 247, 127, 9, 163],
  cancelMutual: [162, 255, 214, 97, 3, 86, 149, 76],
  refundExpired: [118, 153, 164, 244, 40, 128, 242, 250],
  closeDeal: [157, 173, 33, 216, 146, 16, 65, 82],
} as const;

export const DISCRIMINATORS = IX;

export const DEAL_DISCRIMINATOR = Uint8Array.from([
  125, 223, 160, 234, 71, 162, 182, 219,
]);
