import { sha256 } from "@noble/hashes/sha256";

export function u64Bytes(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error("value is outside u64");
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}

export function i64Bytes(value: bigint): Uint8Array {
  if (value < -0x8000000000000000n || value > 0x7fffffffffffffffn) {
    throw new Error("value is outside i64");
  }
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigInt64(0, value, true);
  return out;
}

export function readU64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

export function readI64(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigInt64(offset, true);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytes32(value: Uint8Array, label: string): Uint8Array {
  if (value.length !== 32) {
    throw new Error(`${label} must be 32 bytes`);
  }
  return value;
}

export function commitment(price: bigint, salt: Uint8Array): Uint8Array {
  return sha256(concatBytes(u64Bytes(price), bytes32(salt, "salt")));
}

export function randomSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  crypto.getRandomValues(salt);
  return salt;
}

export function encodeReveal(price: bigint, salt: Uint8Array): string {
  const raw = concatBytes(u64Bytes(price), bytes32(salt, "salt"));
  let binary = "";
  for (const byte of raw) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeReveal(slip: string): { price: bigint; salt: Uint8Array } {
  const binary = atob(slip);
  const raw = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (raw.length !== 40) throw new Error("reveal slip must be 40 bytes");
  return { price: readU64(raw, 0), salt: raw.slice(8) };
}

export function tokenAmount(amount: string | number, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18) {
    throw new Error("decimals must be an integer from 0 to 18");
  }
  const text = String(amount).trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error("amount is not a decimal number");
  const negative = text.startsWith("-");
  const [whole, fraction = ""] = text.replace("-", "").split(".");
  if (fraction.length > decimals) throw new Error("amount has too many decimal places");
  const digits = `${whole}${fraction.padEnd(decimals, "0")}`.replace(/^0+(?=\d)/, "");
  return BigInt(digits) * (negative ? -1n : 1n);
}

export function expiryFromNow(seconds: number): bigint {
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("expiry must be in the future");
  return BigInt(Math.floor(Date.now() / 1000) + Math.floor(seconds));
}
