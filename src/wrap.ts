import { PublicKey, SystemProgram, type Connection, type TransactionInstruction } from "@solana/web3.js";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { associatedTokenAddress } from "blinddeal-sdk";
import { WRAPPED_SOL } from "./cluster";

export async function wrapSolInstructions(
  conn: Connection,
  owner: PublicKey,
  lamports: bigint,
): Promise<TransactionInstruction[]> {
  const ata = associatedTokenAddress(WRAPPED_SOL, owner);
  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(owner, ata, owner, WRAPPED_SOL, TOKEN_PROGRAM_ID),
  ];
  let have = 0n;
  try {
    const account = await getAccount(conn, ata, "confirmed");
    have = account.amount;
  } catch {
    have = 0n;
  }
  if (have >= lamports) return [];
  const need = lamports - have;
  ixs.push(SystemProgram.transfer({ fromPubkey: owner, toPubkey: ata, lamports: Number(need) }));
  ixs.push(createSyncNativeInstruction(ata, TOKEN_PROGRAM_ID));
  return ixs;
}
