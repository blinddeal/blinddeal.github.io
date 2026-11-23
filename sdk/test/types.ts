import { Keypair } from "@solana/web3.js";
import {
  type BlindDealConfig,
  type DealWallet,
  clusterUrl,
  commitment,
  createDealInstruction,
  keypairWallet,
} from "../dist/index.js";

const config: BlindDealConfig = { cluster: "devnet", programId: "3EmcLYRjwELFoFwWfKgSJfycz1d75xXAXB3ChRHKgzYC" };
const wallet: DealWallet = keypairWallet(Keypair.generate());
const hash: Uint8Array = commitment(1n, new Uint8Array(32));
const url: string = clusterUrl(config.cluster);

void wallet;
void hash;
void url;
void createDealInstruction;
