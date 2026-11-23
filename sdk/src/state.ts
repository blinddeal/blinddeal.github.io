import { Connection, PublicKey } from "@solana/web3.js";
import { connectionFrom, type BlindDealConfig } from "./config.js";
import { DEAL_DISCRIMINATOR } from "./ids.js";
import { readI64, readU64 } from "./codec.js";

export type DealStatusName = "open" | "settled" | "refunded" | "cancelled";

export interface DealState {
  address: PublicKey;
  buyer: PublicKey;
  seller: PublicKey;
  initializer: PublicKey;
  paymentMint: PublicKey;
  assetMint: PublicKey;
  assetAmount: bigint;
  buyerDeposit: bigint;
  buyerCommitment: Uint8Array;
  sellerCommitment: Uint8Array;
  expiryTs: bigint;
  createdTs: bigint;
  status: DealStatusName;
  id: bigint;
  bump: number;
  paymentVaultBump: number;
  assetVaultBump: number;
  buyerLocked: boolean;
  sellerLocked: boolean;
}

const STATUS: DealStatusName[] = ["open", "settled", "refunded", "cancelled"];

export function decodeDeal(address: PublicKey, data: Uint8Array): DealState {
  if (data.length < 8 + 270 || !data.slice(0, 8).every((byte, i) => byte === DEAL_DISCRIMINATOR[i])) {
    throw new Error("account is not a BlindDeal deal");
  }
  let offset = 8;
  const pubkey = () => {
    const key = new PublicKey(data.slice(offset, offset + 32));
    offset += 32;
    return key;
  };
  const buyer = pubkey();
  const seller = pubkey();
  const initializer = pubkey();
  const paymentMint = pubkey();
  const assetMint = pubkey();
  const assetAmount = readU64(data, offset);
  offset += 8;
  const buyerDeposit = readU64(data, offset);
  offset += 8;
  const buyerCommitment = data.slice(offset, offset + 32);
  offset += 32;
  const sellerCommitment = data.slice(offset, offset + 32);
  offset += 32;
  const expiryTs = readI64(data, offset);
  offset += 8;
  const createdTs = readI64(data, offset);
  offset += 8;
  const status = STATUS[data[offset]];
  if (!status) throw new Error("unknown deal status");
  offset += 1;
  const id = readU64(data, offset);
  offset += 8;
  const bump = data[offset];
  const paymentVaultBump = data[offset + 1];
  const assetVaultBump = data[offset + 2];
  offset += 3;
  return {
    address,
    buyer,
    seller,
    initializer,
    paymentMint,
    assetMint,
    assetAmount,
    buyerDeposit,
    buyerCommitment,
    sellerCommitment,
    expiryTs,
    createdTs,
    status,
    id,
    bump,
    paymentVaultBump,
    assetVaultBump,
    buyerLocked: data[offset] === 1,
    sellerLocked: data[offset + 1] === 1,
  };
}

export async function fetchDeal(
  address: PublicKey,
  config?: BlindDealConfig,
): Promise<DealState | null> {
  const connection: Connection = connectionFrom(config);
  const info = await connection.getAccountInfo(address, config?.commitment ?? "confirmed");
  if (!info) return null;
  return decodeDeal(address, new Uint8Array(info.data));
}
