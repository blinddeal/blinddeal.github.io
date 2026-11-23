import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount, NATIVE_MINT } from "@solana/spl-token";
import { associatedTokenAddress, BLIND_DEAL_PROGRAM_ID, clusterUrl, type BlindDealConfig, type ClusterName } from "blinddeal-sdk";

export const CLUSTER: ClusterName = "devnet";
export const WRAPPED_SOL = NATIVE_MINT;
export const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const DEVNET_USDT = new PublicKey("AiHg4W4gu35uEWHkWsFYy5SBzJhj1gspoXnc37qaf9cQ");
export const FAUCET_URL = "https://faucet.solana.com";
export const FAUCET_USDC = "https://faucet.circle.com";
export const EXPLORER = "https://explorer.solana.com";
export const HIDDEN_ASSET_MINT = WRAPPED_SOL;
export const HIDDEN_ASSET_AMOUNT = "0.000000001";
export const DEFAULT_EXPIRY_SECONDS = 60 * 60 * 24;

export type PaymentChoice = "usdc" | "usdt";

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
  if (mint.equals(DEVNET_USDC) || mint.equals(DEVNET_USDT)) return 6;
  const info = await conn.getParsedAccountInfo(mint, "confirmed");
  const data = info.value?.data;
  if (data && typeof data === "object" && "parsed" in data) {
    const decimals = (data.parsed as { info?: { decimals?: number } })?.info?.decimals;
    if (typeof decimals === "number") return decimals;
  }
  throw new Error("That payment token could not be read on this network.");
}

export async function solLamports(conn: Connection, owner: PublicKey): Promise<number> {
  return conn.getBalance(owner, "confirmed");
}

export async function tokenBalance(conn: Connection, owner: PublicKey, mint: PublicKey): Promise<bigint> {
  try {
    const account = await getAccount(conn, associatedTokenAddress(mint, owner), "confirmed");
    return account.amount;
  } catch {
    return 0n;
  }
}

export function tokenLabel(mint: PublicKey | string): string {
  const text = typeof mint === "string" ? mint : mint.toBase58();
  if (text === WRAPPED_SOL.toBase58()) return "SOL";
  if (text === DEVNET_USDC.toBase58()) return "USDC";
  if (text === DEVNET_USDT.toBase58()) return "USDT";
  return text.slice(0, 4) + "…" + text.slice(-4);
}

export function paymentMintFor(choice: PaymentChoice): PublicKey {
  return choice === "usdt" ? DEVNET_USDT : DEVNET_USDC;
}

export function paymentChoiceFor(mint: PublicKey | string): PaymentChoice | null {
  const text = typeof mint === "string" ? mint : mint.toBase58();
  if (text === DEVNET_USDC.toBase58()) return "usdc";
  if (text === DEVNET_USDT.toBase58()) return "usdt";
  return null;
}

export function missingPaymentHelp(mint: PublicKey | string): { token: string; text: string; href?: string; linkLabel?: string } {
  const token = tokenLabel(mint);
  if (token === "USDC") {
    return {
      token,
      text: "This wallet does not have enough devnet USDC. Get test tokens from the Circle faucet.",
      href: FAUCET_USDC,
      linkLabel: "Open the Circle faucet",
    };
  }
  if (token === "USDT") {
    return {
      token,
      text: "This wallet does not have enough devnet USDT. This is a BlindDeal test token, not Tether's official USDT. If you need test funds, use USDC and get some from the Circle faucet.",
      href: FAUCET_USDC,
      linkLabel: "Open the Circle faucet",
    };
  }
  return {
    token,
    text: "This wallet does not have enough of the payment token for this deal.",
  };
}
