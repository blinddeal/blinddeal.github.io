import { PublicKey } from "@solana/web3.js";
import { dealAddress, type DealState } from "blinddeal-sdk";
import { appConfig } from "./cluster";
import { type DealRef, parseDealRef, readHashParams } from "./session";

export type Offer = {
  version: 1;
  creator: string;
  role: "buyer" | "seller";
  paymentMint: string;
  assetMint: string;
  assetAmount: string;
  label: string;
  expirySeconds: number;
  id: string;
  counterparty?: string;
};

export type Route =
  | { kind: "deal"; address: PublicKey; ref?: DealRef; reveal?: string }
  | { kind: "invite"; offer: Offer; reveal?: string }
  | { kind: "legacy"; ref: DealRef; reveal?: string }
  | { kind: "desk" };

export type StoredDeal = {
  kind: "deal" | "invite";
  id: string;
  address?: string;
  buyer?: string;
  seller?: string;
  creator: string;
  role: "buyer" | "seller";
  paymentMint: string;
  assetMint: string;
  assetAmount: string;
  label: string;
  expirySeconds: number;
  createdAt: string;
  status?: string;
};

const DEALS_KEY = "blinddeal.mydeals.v1";
const THEIR_PREFIX = "blinddeal.their.";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function textEncoder() {
  return new TextEncoder();
}

function textDecoder() {
  return new TextDecoder();
}

function parseOptionalKey(value: unknown): string | undefined {
  if (typeof value !== "string" || !value) return undefined;
  new PublicKey(value);
  return value;
}

export function encodeOffer(offer: Offer): string {
  const body = {
    v: 1,
    c: offer.creator,
    r: offer.role === "buyer" ? "b" : "s",
    p: offer.paymentMint,
    a: offer.assetMint,
    n: offer.assetAmount,
    l: offer.label.slice(0, 80),
    e: offer.expirySeconds,
    i: offer.id,
    ...(offer.counterparty ? { s: offer.counterparty } : {}),
  };
  return "i." + toBase64Url(textEncoder().encode(JSON.stringify(body)));
}

export function decodeOffer(payload: string): Offer | null {
  const raw = payload.startsWith("i.") ? payload.slice(2) : payload;
  try {
    const parsed = JSON.parse(textDecoder().decode(fromBase64Url(raw))) as Record<string, unknown>;
    if (parsed.v !== 1 || typeof parsed.c !== "string" || (parsed.r !== "b" && parsed.r !== "s")) return null;
    if (typeof parsed.p !== "string" || typeof parsed.a !== "string" || typeof parsed.n !== "string") return null;
    if (typeof parsed.i !== "string") return null;
    new PublicKey(parsed.c);
    new PublicKey(parsed.p);
    new PublicKey(parsed.a);
    return {
      version: 1,
      creator: parsed.c,
      role: parsed.r === "b" ? "buyer" : "seller",
      paymentMint: parsed.p,
      assetMint: parsed.a,
      assetAmount: String(parsed.n),
      label: typeof parsed.l === "string" ? parsed.l.slice(0, 80) : "",
      expirySeconds: typeof parsed.e === "number" && parsed.e > 0 ? parsed.e : 60 * 60 * 24,
      id: parsed.i,
      ...(parseOptionalKey(parsed.s) ? { counterparty: parseOptionalKey(parsed.s) } : {}),
    };
  } catch {
    return null;
  }
}

function hashAndSearch(): { hashPath: string; params: URLSearchParams } {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const qIndex = hash.indexOf("?");
  const hashPath = qIndex >= 0 ? hash.slice(0, qIndex) : hash;
  const hashQuery = qIndex >= 0 ? hash.slice(qIndex + 1) : "";
  const params = new URLSearchParams(hashQuery);
  const search = readHashParams();
  for (const [key, value] of search) {
    if (!params.has(key)) params.set(key, value);
  }
  const urlParams = new URLSearchParams(window.location.search);
  for (const [key, value] of urlParams) {
    if (!params.has(key)) params.set(key, value);
  }
  return { hashPath, params };
}

function asPublicKey(value: string | null): PublicKey | null {
  if (!value) return null;
  try {
    return new PublicKey(value.trim());
  } catch {
    return null;
  }
}

export function parseRoute(): Route {
  if (typeof window === "undefined") return { kind: "desk" };
  const { hashPath, params } = hashAndSearch();
  const reveal = params.get("r") ?? undefined;
  const queryDeal = params.get("d");
  const path = hashPath.replace(/^\/+/, "");
  const token = path.startsWith("d/") ? path.slice(2) : queryDeal;
  if (token) {
    if (token.startsWith("i.") || decodeOffer(token)) {
      const offer = decodeOffer(token);
      if (offer) return { kind: "invite", offer, reveal };
    }
    const address = asPublicKey(token);
    if (address) return { kind: "deal", address, reveal };
  }
  const legacy = parseDealRef(params);
  if (legacy) return { kind: "legacy", ref: legacy, reveal };
  return { kind: "desk" };
}

export function writeRoute(hash: string) {
  const next = hash.startsWith("#") ? hash : "#" + hash;
  const current = window.location.pathname + window.location.search + next;
  window.history.replaceState(null, "", current);
}

export function dealShareUrl(address: string, reveal?: string): string {
  const base = window.location.origin + window.location.pathname + "#/d/" + address;
  return reveal ? base + "?r=" + encodeURIComponent(reveal) : base;
}

export function inviteShareUrl(offer: Offer): string {
  return window.location.origin + window.location.pathname + "#/d/" + encodeOffer(offer);
}

export function queryDealUrl(address: string): string {
  return window.location.origin + window.location.pathname + "?d=" + address;
}

export function loadMyDeals(): StoredDeal[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(DEALS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredDeal[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveMyDeals(deals: StoredDeal[]) {
  window.localStorage.setItem(DEALS_KEY, JSON.stringify(deals.slice(0, 40)));
}

export function upsertMyDeal(entry: StoredDeal) {
  const deals = loadMyDeals().filter((item) => {
    if (entry.address && item.address) return item.address !== entry.address;
    return !(item.kind === entry.kind && item.id === entry.id && item.creator === entry.creator);
  });
  deals.unshift(entry);
  saveMyDeals(deals);
}

export function updateMyDeal(match: (item: StoredDeal) => boolean, patch: Partial<StoredDeal>) {
  saveMyDeals(loadMyDeals().map((item) => (match(item) ? { ...item, ...patch } : item)));
}

export function loadTheirReveal(deal: string): string | null {
  return window.localStorage.getItem(THEIR_PREFIX + deal);
}

export function saveTheirReveal(deal: string, slip: string) {
  window.localStorage.setItem(THEIR_PREFIX + deal, slip);
}

export function offerParties(offer: Offer, counterparty: PublicKey): DealRef {
  const creator = new PublicKey(offer.creator);
  const other = offer.counterparty ? new PublicKey(offer.counterparty) : counterparty;
  const buyer = offer.role === "buyer" ? creator : other;
  const seller = offer.role === "seller" ? creator : other;
  return { buyer, seller, id: BigInt(offer.id) };
}

export function offerDealAddress(offer: Offer, counterparty: PublicKey): PublicKey {
  const parties = offerParties(offer, counterparty);
  return dealAddress(parties.buyer, parties.seller, parties.id, appConfig());
}

export function recordFromDeal(deal: DealState, role: "buyer" | "seller", label: string, expirySeconds: number): StoredDeal {
  return {
    kind: "deal",
    id: deal.id.toString(),
    address: deal.address.toBase58(),
    buyer: deal.buyer.toBase58(),
    seller: deal.seller.toBase58(),
    creator: role === "buyer" ? deal.buyer.toBase58() : deal.seller.toBase58(),
    role,
    paymentMint: deal.paymentMint.toBase58(),
    assetMint: deal.assetMint.toBase58(),
    assetAmount: deal.assetAmount.toString(),
    label,
    expirySeconds,
    createdAt: new Date().toISOString(),
    status: deal.status,
  };
}

export function saltBackupText(input: {
  deal: string;
  role: string;
  label: string;
  priceText: string;
  slip: string;
  saltHex: string;
}): string {
  return [
    "BlindDeal reveal backup",
    "Deal: " + input.deal,
    input.label ? "Item: " + input.label : "",
    "Role: " + input.role,
    "Limit: " + input.priceText,
    "Salt: " + input.saltHex,
    "Slip: " + input.slip,
    "Saved: " + new Date().toISOString(),
    "",
    "Keep this file. You need it to settle if this browser is cleared.",
    "",
  ]
    .filter((line, index, all) => line !== "" || all[index - 1] !== "")
    .join("\n");
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
