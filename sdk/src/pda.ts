import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { u64Bytes } from "./codec.js";
import { programIdOf, type BlindDealConfig } from "./config.js";

export function dealAddress(
  buyer: PublicKey,
  seller: PublicKey,
  id: bigint,
  config?: BlindDealConfig,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deal"), buyer.toBuffer(), seller.toBuffer(), Buffer.from(u64Bytes(id))],
    programIdOf(config),
  )[0];
}

export function paymentVaultAddress(deal: PublicKey, config?: BlindDealConfig): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), deal.toBuffer()],
    programIdOf(config),
  )[0];
}

export function assetVaultAddress(deal: PublicKey, config?: BlindDealConfig): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), deal.toBuffer()],
    programIdOf(config),
  )[0];
}

export function associatedTokenAddress(mint: PublicKey, owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(mint, owner, true);
}
