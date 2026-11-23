import { PublicKey } from "@solana/web3.js";
import { decodeReveal, encodeReveal } from "blinddeal-sdk";

const PREFIX = "blinddeal.slip.";

export type Slip = { price: bigint; salt: Uint8Array };

export type DealRef = {
  buyer: PublicKey;
  seller: PublicKey;
  id: bigint;
};

export function readHashParams(): URLSearchParams {
  const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : window.location.hash;
  const query = hash.includes("?") ? hash.slice(hash.indexOf("?")) : window.location.search;
  return new URLSearchParams(query);
}

export function parseDealRef(params = readHashParams()): DealRef | null {
  const buyer = params.get("buyer");
  const seller = params.get("seller");
  const id = params.get("id");
  if (!buyer || !seller || !id) return null;
  try {
    return { buyer: new PublicKey(buyer), seller: new PublicKey(seller), id: BigInt(id) };
  } catch {
    return null;
  }
}

export function writeDealHash(ref: DealRef) {
  const params = new URLSearchParams({
    buyer: ref.buyer.toBase58(),
    seller: ref.seller.toBase58(),
    id: ref.id.toString(),
  });
  const next = "#desk?" + params.toString();
  window.history.replaceState(null, "", window.location.pathname + window.location.search + next);
}

export function dealLink(ref: DealRef): string {
  const params = new URLSearchParams({
    buyer: ref.buyer.toBase58(),
    seller: ref.seller.toBase58(),
    id: ref.id.toString(),
  });
  return window.location.origin + window.location.pathname + "#desk?" + params.toString();
}

export function slipKey(deal: string): string {
  return PREFIX + deal;
}

export function loadSlip(deal: string): Slip | null {
  const raw = window.localStorage.getItem(slipKey(deal));
  if (!raw) return null;
  try {
    return decodeReveal(raw);
  } catch {
    return null;
  }
}

export function saveSlip(deal: string, slip: Slip) {
  window.localStorage.setItem(slipKey(deal), encodeReveal(slip.price, slip.salt));
}

export function storedSlipText(deal: string): string | null {
  return window.localStorage.getItem(slipKey(deal));
}

export function offerSlipKey(creator: string, id: string): string {
  return "invite." + creator + "." + id;
}

export function copySlip(fromKey: string, toKey: string) {
  const raw = storedSlipText(fromKey);
  if (raw) window.localStorage.setItem(slipKey(toKey), raw);
}
