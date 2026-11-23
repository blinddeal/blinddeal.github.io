import {
  type Commitment,
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { connectionFrom, type BlindDealConfig } from "./config.js";

export interface DealWallet {
  publicKey: PublicKey;
  signTransaction<T extends Transaction>(tx: T): Promise<T>;
}

export async function sendInstructions(input: {
  wallet: DealWallet;
  instructions: TransactionInstruction[];
  connection?: Connection;
  config?: BlindDealConfig;
  commitment?: Commitment;
}): Promise<string> {
  const commitment = input.commitment ?? input.config?.commitment ?? "confirmed";
  const connection = input.connection ?? connectionFrom(input.config);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash(commitment);
  const tx = new Transaction({
    feePayer: input.wallet.publicKey,
    blockhash,
    lastValidBlockHeight,
  }).add(...input.instructions);
  const signed = await input.wallet.signTransaction(tx);
  const signature = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, commitment);
  return signature;
}

export function keypairWallet(keypair: Keypair): DealWallet {
  return {
    publicKey: keypair.publicKey,
    async signTransaction(tx) {
      tx.partialSign(keypair);
      return tx;
    },
  };
}
