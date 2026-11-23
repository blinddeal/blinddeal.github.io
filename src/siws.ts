import { PublicKey } from "@solana/web3.js";

export const SIWS_DOMAIN = "blinddeal.github.io";
const STORAGE_KEY = "blinddeal.siws";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type SiwsSession = {
  address: string;
  domain: string;
  statement: string;
  nonce: string;
  issuedAt: string;
  uri: string;
  chainId: string;
  signature: string;
  walletName: string;
};

export function siwsDomain(): string {
  if (typeof location === "undefined") return SIWS_DOMAIN;
  if (location.hostname === "localhost" || location.hostname === "127.0.0.1") return location.host;
  return SIWS_DOMAIN;
}

export function siwsUri(): string {
  if (typeof location === "undefined") return "https://blinddeal.github.io";
  return location.origin + location.pathname;
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildSiwsMessage(input: {
  domain?: string;
  address: string;
  statement?: string;
  uri?: string;
  chainId?: string;
  nonce: string;
  issuedAt: string;
}): string {
  const domain = input.domain ?? siwsDomain();
  const statement =
    input.statement ??
    "Sign in to BlindDeal. This proves you hold this wallet. It does not spend funds or lock a price.";
  const uri = input.uri ?? siwsUri();
  const chainId = input.chainId ?? "devnet";
  return [
    `${domain} wants you to sign in with your Solana account:`,
    input.address,
    "",
    statement,
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${chainId}`,
    `Nonce: ${input.nonce}`,
    `Issued At: ${input.issuedAt}`,
  ].join("\n");
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

export async function verifyEd25519(address: string, message: Uint8Array, signature: Uint8Array): Promise<boolean> {
  if (signature.length !== 64) return false;
  try {
    const keyBytes = Uint8Array.from(new PublicKey(address).toBytes());
    const sigBytes = Uint8Array.from(signature);
    const msgBytes = Uint8Array.from(message);
    const key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]);
    return crypto.subtle.verify("Ed25519", key, sigBytes, msgBytes);
  } catch {
    return false;
  }
}

export function loadSiwsSession(): SiwsSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SiwsSession;
    if (!parsed.address || !parsed.signature || !parsed.issuedAt || !parsed.nonce) return null;
    const issued = Date.parse(parsed.issuedAt);
    if (!Number.isFinite(issued) || Date.now() - issued > MAX_AGE_MS) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function saveSiwsSession(session: SiwsSession) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSiwsSession() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function sessionMatches(session: SiwsSession | null, address: PublicKey | string | null): boolean {
  if (!session || !address) return false;
  const text = typeof address === "string" ? address : address.toBase58();
  return session.address === text;
}
