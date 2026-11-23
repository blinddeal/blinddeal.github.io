import { Connection, PublicKey } from "@solana/web3.js";
import { BLIND_DEAL_PROGRAM_ID, decodeDeal, type DealState } from "blinddeal-sdk";

export async function findDealsForInitializer(conn: Connection, initializer: PublicKey): Promise<DealState[]> {
  const accounts = await conn.getProgramAccounts(BLIND_DEAL_PROGRAM_ID, {
    filters: [{ memcmp: { offset: 72, bytes: initializer.toBase58() } }],
  });
  const deals: DealState[] = [];
  for (const item of accounts) {
    try {
      deals.push(decodeDeal(item.pubkey, new Uint8Array(item.account.data)));
    } catch {
      continue;
    }
  }
  return deals;
}

export async function findDealById(
  conn: Connection,
  initializer: PublicKey,
  id: bigint,
): Promise<DealState | null> {
  const deals = await findDealsForInitializer(conn, initializer);
  return deals.find((item) => item.id === id) ?? null;
}
