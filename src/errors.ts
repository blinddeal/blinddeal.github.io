const ANCHOR: Record<number, string> = {
  6000: "Buyer and seller must be different wallets.",
  6001: "Expiry must be in the future.",
  6002: "Expiry cannot be further than 30 days out.",
  6003: "This deal is not open.",
  6004: "The buyer already locked.",
  6005: "The seller already locked.",
  6006: "The buyer has not locked yet.",
  6007: "The seller has not locked yet.",
  6008: "Amount must be greater than zero.",
  6009: "The commitment cannot be empty.",
  6010: "The revealed price does not match the locked commitment.",
  6011: "The deposit is smaller than the revealed maximum.",
  6012: "Both sides are already locked. Settle, cancel together, or wait for expiry.",
  6013: "This deal has not expired yet.",
  6014: "This deal has expired.",
  6015: "Only the buyer or the seller can do that.",
  6016: "The vault still holds tokens.",
  6017: "This deal is not finished yet.",
  6018: "Privacy Rings comparison is not connected on this build.",
  6019: "The payment vault does not have enough tokens.",
  6020: "The asset vault does not have enough tokens.",
};

function firstLine(text: string): string {
  return text.split("\n")[0]?.trim() ?? text;
}

export function explainError(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  const lower = text.toLowerCase();
  if (lower.includes("user rejected") || lower.includes("rejected the request") || lower.includes("user denied")) {
    return "The wallet declined the signature.";
  }
  const named = text.match(/Error Message: ([^\n]+)/);
  if (named?.[1]) return named[1].trim();
  const hex = text.match(/custom program error: (0x[0-9a-f]+)/i);
  if (hex?.[1]) {
    const code = Number.parseInt(hex[1], 16);
    if (ANCHOR[code]) return ANCHOR[code];
  }
  const dec = text.match(/custom program error: (\d+)/i);
  if (dec?.[1]) {
    const code = Number.parseInt(dec[1], 10);
    if (ANCHOR[code]) return ANCHOR[code];
  }
  if (lower.includes("attempt to debit an account") || lower.includes("insufficient lamports") || lower.includes("insufficient funds")) {
    return "This wallet needs a little devnet SOL for fees. Request some from the Solana faucet.";
  }
  if ((lower.includes("could not find") && lower.includes("program")) || lower.includes("invalid program id")) {
    return "The BlindDeal program is not on devnet yet, so this transaction cannot be sent.";
  }
  if (lower.includes("invalid public key")) {
    return "That address is not a valid Solana public key.";
  }
  if (lower.includes("blockhash not found") || lower.includes("transaction was not confirmed")) {
    return "The network did not confirm that transaction in time. Try again.";
  }
  const line = firstLine(text);
  return line.length > 180 ? line.slice(0, 177) + "…" : line || "The transaction did not go through.";
}
