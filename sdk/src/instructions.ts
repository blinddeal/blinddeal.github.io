import { Buffer } from "buffer";
import {
  PublicKey,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { bytes32, concatBytes, i64Bytes, u64Bytes } from "./codec.js";
import { programIdOf, type BlindDealConfig } from "./config.js";
import { DISCRIMINATORS } from "./ids.js";
import { assetVaultAddress, dealAddress, paymentVaultAddress } from "./pda.js";

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean) {
  return { pubkey, isSigner, isWritable };
}

function ix(config: BlindDealConfig | undefined, discriminator: readonly number[], data: Uint8Array, keys: ReturnType<typeof meta>[]) {
  return new TransactionInstruction({
    programId: programIdOf(config),
    keys,
    data: Buffer.from(concatBytes(Uint8Array.from(discriminator), data)),
  });
}

export interface DealParties {
  buyer: PublicKey;
  seller: PublicKey;
  id: bigint;
  config?: BlindDealConfig;
}

export function createDealInstruction(input: DealParties & {
  paymentMint: PublicKey;
  assetMint: PublicKey;
  assetAmount: bigint;
  expiryTs: bigint;
}): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.initialize, concatBytes(u64Bytes(input.id), u64Bytes(input.assetAmount), i64Bytes(input.expiryTs)), [
    meta(input.buyer, true, true),
    meta(input.seller, false, false),
    meta(input.paymentMint, false, false),
    meta(input.assetMint, false, false),
    meta(deal, false, true),
    meta(paymentVaultAddress(deal, input.config), false, true),
    meta(assetVaultAddress(deal, input.config), false, true),
    meta(TOKEN_PROGRAM_ID, false, false),
    meta(SystemProgram.programId, false, false),
  ]);
}

export function lockBuyerInstruction(input: DealParties & {
  buyerPayment: PublicKey;
  paymentMint: PublicKey;
  commitment: Uint8Array;
  amount: bigint;
}): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.lockBuyer, concatBytes(bytes32(input.commitment, "commitment"), u64Bytes(input.amount)), [
    meta(input.buyer, true, false),
    meta(deal, false, true),
    meta(input.buyerPayment, false, true),
    meta(paymentVaultAddress(deal, input.config), false, true),
    meta(input.paymentMint, false, false),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

export function lockSellerInstruction(input: DealParties & {
  sellerAsset: PublicKey;
  assetMint: PublicKey;
  commitment: Uint8Array;
}): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.lockSeller, bytes32(input.commitment, "commitment"), [
    meta(input.seller, true, false),
    meta(deal, false, true),
    meta(input.sellerAsset, false, true),
    meta(assetVaultAddress(deal, input.config), false, true),
    meta(input.assetMint, false, false),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

export interface SettleAccounts extends DealParties {
  party: PublicKey;
  buyerPayment: PublicKey;
  sellerPayment: PublicKey;
  buyerAsset: PublicKey;
  sellerAsset: PublicKey;
  paymentMint: PublicKey;
  assetMint: PublicKey;
}

export function settleInstruction(input: SettleAccounts & {
  buyerPrice: bigint;
  buyerSalt: Uint8Array;
  sellerPrice: bigint;
  sellerSalt: Uint8Array;
}): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(
    input.config,
    DISCRIMINATORS.settle,
    concatBytes(
      u64Bytes(input.buyerPrice),
      bytes32(input.buyerSalt, "buyer salt"),
      u64Bytes(input.sellerPrice),
      bytes32(input.sellerSalt, "seller salt"),
    ),
    settleKeys(input, deal),
  );
}

function settleKeys(input: SettleAccounts, deal: PublicKey) {
  return [
    meta(input.party, true, false),
    meta(deal, false, true),
    meta(input.buyerPayment, false, true),
    meta(input.sellerPayment, false, true),
    meta(input.buyerAsset, false, true),
    meta(input.sellerAsset, false, true),
    meta(paymentVaultAddress(deal, input.config), false, true),
    meta(assetVaultAddress(deal, input.config), false, true),
    meta(input.paymentMint, false, false),
    meta(input.assetMint, false, false),
    meta(TOKEN_PROGRAM_ID, false, false),
  ];
}

export function refundExpiredInstruction(input: SettleAccounts): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.refundExpired, new Uint8Array(), settleKeys(input, deal));
}

export function cancelBuyerInstruction(input: DealParties & {
  buyerPayment: PublicKey;
  paymentMint: PublicKey;
}): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.cancelBuyer, new Uint8Array(), [
    meta(input.buyer, true, false),
    meta(deal, false, true),
    meta(input.buyerPayment, false, true),
    meta(paymentVaultAddress(deal, input.config), false, true),
    meta(input.paymentMint, false, false),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

export function cancelSellerInstruction(input: DealParties & {
  sellerAsset: PublicKey;
  assetMint: PublicKey;
}): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.cancelSeller, new Uint8Array(), [
    meta(input.seller, true, false),
    meta(deal, false, true),
    meta(input.sellerAsset, false, true),
    meta(assetVaultAddress(deal, input.config), false, true),
    meta(input.assetMint, false, false),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

export function cancelMutualInstruction(input: SettleAccounts): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.cancelMutual, new Uint8Array(), [
    meta(input.buyer, true, false),
    meta(input.seller, true, false),
    meta(deal, false, true),
    meta(input.buyerPayment, false, true),
    meta(input.sellerPayment, false, true),
    meta(input.buyerAsset, false, true),
    meta(input.sellerAsset, false, true),
    meta(paymentVaultAddress(deal, input.config), false, true),
    meta(assetVaultAddress(deal, input.config), false, true),
    meta(input.paymentMint, false, false),
    meta(input.assetMint, false, false),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

export function closeDealInstruction(input: DealParties & {
  party: PublicKey;
  initializer: PublicKey;
  paymentMint: PublicKey;
  assetMint: PublicKey;
}): TransactionInstruction {
  const deal = dealAddress(input.buyer, input.seller, input.id, input.config);
  return ix(input.config, DISCRIMINATORS.closeDeal, new Uint8Array(), [
    meta(input.party, true, false),
    meta(deal, false, true),
    meta(input.initializer, false, true),
    meta(paymentVaultAddress(deal, input.config), false, true),
    meta(assetVaultAddress(deal, input.config), false, true),
    meta(input.paymentMint, false, false),
    meta(input.assetMint, false, false),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}
