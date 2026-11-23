import { Connection, PublicKey } from "@solana/web3.js";
import { NATIVE_MINT } from "@solana/spl-token";
import { BLIND_DEAL_PROGRAM_ID, clusterUrl, type BlindDealConfig, type ClusterName } from "blinddeal-sdk";

export const CLUSTER: ClusterName = "devnet";
export const WRAPPED_SOL = NATIVE_MINT;
export const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const FAUCET_URL = "https://faucet.solana.com";
export const EXPLORER = "https://explorer.solana.com";

function hashCluster(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  return new URLSearchParams(query).get("cluster");
}

export function appCluster(): ClusterName {
  if (typeof window === "undefined") return CLUSTER;
  if (window.location.hostname === "blinddeal.github.io") return "devnet";
  const query = new URLSearchParams(window.location.search).get("cluster") ?? hashCluster();
  if (query === "localnet" || query === "devnet" || query === "testnet" || query === "mainnet-beta") return query;
  try {
    const stored = window.localStorage.getItem("blinddeal.cluster");
    if (stored === "localnet" || stored === "devnet") return stored;
  } catch {
    return CLUSTER;
  }
  return CLUSTER;
}

export const CONFIG: BlindDealConfig = {
  get cluster() {
    return appCluster();
  },
  commitment: "confirmed",
};

export function appConfig(): BlindDealConfig {
  return CONFIG;
}

export function connection(): Connection {
  return new Connection(clusterUrl(appCluster()), "confirmed");
}

export async function programIsLive(conn: Connection): Promise<boolean> {
  const info = await conn.getAccountInfo(BLIND_DEAL_PROGRAM_ID, "confirmed");
  return Boolean(info?.executable);
}

export function explorerTx(signature: string): string {
  return EXPLORER + "/tx/" + signature + "?cluster=" + appCluster();
}

export function explorerAddress(address: string): string {
  return EXPLORER + "/address/" + address + "?cluster=" + appCluster();
}

export async function mintDecimals(conn: Connection, mint: PublicKey): Promise<number> {
  if (mint.equals(WRAPPED_SOL)) return 9;
  const info = await conn.getParsedAccountInfo(mint, "confirmed");
  const data = info.value?.data;
  if (data && typeof data === "object" && "parsed" in data) {
    const decimals = (data.parsed as { info?: { decimals?: number } })?.info?.decimals;
    if (typeof decimals === "number") return decimals;
  }
  throw new Error("That mint could not be read on this cluster.");
}

export async function solLamports(conn: Connection, owner: PublicKey): Promise<number> {
  return conn.getBalance(owner, "confirmed");
}

export function tokenLabel(mint: PublicKey | string): string {
  const text = typeof mint === "string" ? mint : mint.toBase58();
  if (text === WRAPPED_SOL.toBase58()) return "SOL";
  if (text === DEVNET_USDC.toBase58()) return "USDC";
  return text.slice(0, 4) + "…" + text.slice(-4);
}

