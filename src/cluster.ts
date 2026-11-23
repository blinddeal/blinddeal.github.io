import { Connection, PublicKey } from "@solana/web3.js";
import { BLIND_DEAL_PROGRAM_ID, clusterUrl, type BlindDealConfig } from "blinddeal-sdk";

export const CLUSTER = "devnet" as const;
export const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const CONFIG: BlindDealConfig = { cluster: CLUSTER, commitment: "confirmed" };
export const EXPLORER = "https://explorer.solana.com";

export function connection(): Connection {
  return new Connection(clusterUrl(CLUSTER), "confirmed");
}

export async function programIsLive(conn: Connection): Promise<boolean> {
  const info = await conn.getAccountInfo(BLIND_DEAL_PROGRAM_ID, "confirmed");
  return Boolean(info?.executable);
}

export function explorerTx(signature: string): string {
  return EXPLORER + "/tx/" + signature + "?cluster=" + CLUSTER;
}

export function explorerAddress(address: string): string {
  return EXPLORER + "/address/" + address + "?cluster=" + CLUSTER;
}

export async function mintDecimals(conn: Connection, mint: PublicKey): Promise<number> {
  const info = await conn.getParsedAccountInfo(mint, "confirmed");
  const data = info.value?.data;
  if (data && typeof data === "object" && "parsed" in data) {
    const decimals = (data.parsed as { info?: { decimals?: number } })?.info?.decimals;
    if (typeof decimals === "number") return decimals;
  }
  throw new Error("That mint could not be read on devnet.");
}
