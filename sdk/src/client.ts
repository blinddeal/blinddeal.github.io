import type { PublicKey } from "@solana/web3.js";
import type { BlindDealConfig } from "./config.js";
import {
  cancelBuyerInstruction,
  cancelMutualInstruction,
  cancelSellerInstruction,
  closeDealInstruction,
  createDealInstruction,
  lockBuyerInstruction,
  lockSellerInstruction,
  refundExpiredInstruction,
  settleInstruction,
  type DealParties,
  type SettleAccounts,
} from "./instructions.js";
import { sendInstructions, type DealWallet } from "./send.js";

interface Sendable {
  wallet: DealWallet;
  config?: BlindDealConfig;
}

export async function createDeal(input: Parameters<typeof createDealInstruction>[0] & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [createDealInstruction(input)],
  });
}

export async function lockBuyer(input: Parameters<typeof lockBuyerInstruction>[0] & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [lockBuyerInstruction(input)],
  });
}

export async function lockSeller(input: Parameters<typeof lockSellerInstruction>[0] & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [lockSellerInstruction(input)],
  });
}

export async function settle(input: Parameters<typeof settleInstruction>[0] & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [settleInstruction(input)],
  });
}

export async function refund(input: SettleAccounts & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [refundExpiredInstruction(input)],
  });
}

export async function cancelBuyer(input: Parameters<typeof cancelBuyerInstruction>[0] & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [cancelBuyerInstruction(input)],
  });
}

export async function cancelSeller(input: Parameters<typeof cancelSellerInstruction>[0] & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [cancelSellerInstruction(input)],
  });
}

export async function cancel(input: SettleAccounts & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [cancelMutualInstruction(input)],
  });
}

export async function closeDeal(input: Parameters<typeof closeDealInstruction>[0] & Sendable): Promise<string> {
  return sendInstructions({
    wallet: input.wallet,
    config: input.config,
    instructions: [closeDealInstruction(input)],
  });
}

export type { DealParties, SettleAccounts, PublicKey };
