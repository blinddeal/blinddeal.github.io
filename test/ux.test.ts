import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { decodeOffer, encodeOffer, saltBackupText, type Offer } from "../src/offer.ts";
import { buildSiwsMessage, bytesToBase64, randomNonce, verifyEd25519 } from "../src/siws.ts";
import { explainError } from "../src/errors.ts";

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, "crypto", { value: webcrypto });
}

function sampleOffer(): Offer {
  const creator = Keypair.generate().publicKey.toBase58();
  const payment = Keypair.generate().publicKey.toBase58();
  const asset = Keypair.generate().publicKey.toBase58();
  return {
    version: 1,
    creator,
    role: "seller",
    paymentMint: payment,
    assetMint: asset,
    assetAmount: "1000000",
    label: "One rare sticker",
    expirySeconds: 86400,
    id: "1710000000000",
  };
}

test("offer payloads round-trip in a share token", () => {
  const offer = sampleOffer();
  const token = encodeOffer(offer);
  assert.match(token, /^i\./);
  const opened = decodeOffer(token);
  assert.deepEqual(opened, offer);
  assert.equal(decodeOffer("not-an-offer"), null);
});

test("SIWS messages include the site domain, address, nonce, and issued-at", () => {
  const address = Keypair.generate().publicKey.toBase58();
  const nonce = randomNonce();
  const issuedAt = "2026-11-23T01:20:00.000Z";
  const message = buildSiwsMessage({
    domain: "blinddeal.github.io",
    address,
    uri: "https://blinddeal.github.io/",
    chainId: "devnet",
    nonce,
    issuedAt,
  });
  assert.match(message, /^blinddeal\.github\.io wants you to sign in with your Solana account:\n/);
  assert.ok(message.includes(address));
  assert.ok(message.includes("Nonce: " + nonce));
  assert.ok(message.includes("Issued At: " + issuedAt));
  assert.ok(message.includes("This proves you hold this wallet"));
  assert.ok(!message.includes("hackathon"));
});

test("Ed25519 signatures on a SIWS message verify for the matching wallet", async () => {
  const pair = Keypair.generate();
  const address = pair.publicKey.toBase58();
  const message = buildSiwsMessage({
    domain: "blinddeal.github.io",
    address,
    uri: "https://blinddeal.github.io/",
    chainId: "devnet",
    nonce: "abc123",
    issuedAt: "2026-11-23T01:20:00.000Z",
  });
  const body = new TextEncoder().encode(message);
  const pkcs8 = ed25519Pkcs8(pair.secretKey);
  const key = await webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "Ed25519" }, false, ["sign"]);
  const signature = new Uint8Array(await webcrypto.subtle.sign("Ed25519", key, body));
  assert.equal(await verifyEd25519(address, body, signature), true);
  const other = Keypair.generate().publicKey.toBase58();
  assert.equal(await verifyEd25519(other, body, signature), false);
  assert.equal(typeof bytesToBase64(signature), "string");
});

test("salt backup text keeps the deal, limit, salt, and slip", () => {
  const text = saltBackupText({
    deal: "Deal111111111111111111111111111111111111111",
    role: "seller",
    label: "One rare sticker",
    priceText: "1.5 SOL",
    slip: "AQID",
    saltHex: "aa".repeat(32),
  });
  assert.match(text, /BlindDeal reveal backup/);
  assert.match(text, /Item: One rare sticker/);
  assert.match(text, /Limit: 1.5 SOL/);
  assert.match(text, /Slip: AQID/);
  assert.match(text, /Keep this file/);
});

test("insufficient funds errors point at the devnet faucet", () => {
  const message = explainError(new Error("Attempt to debit an account but found no record of a prior credit"));
  assert.match(message, /devnet SOL for fees/);
  assert.match(message, /faucet/i);
});

function ed25519Pkcs8(secretKey: Uint8Array): Uint8Array {
  const seed = secretKey.slice(0, 32);
  const prefix = Uint8Array.from([
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
  ]);
  const out = new Uint8Array(prefix.length + 32);
  out.set(prefix);
  out.set(seed, prefix.length);
  return out;
}

test("return-link payloads keep the other party's wallet", () => {
  const offer = sampleOffer();
  offer.role = "buyer";
  offer.counterparty = Keypair.generate().publicKey.toBase58();
  const opened = decodeOffer(encodeOffer(offer));
  assert.equal(opened?.counterparty, offer.counterparty);
  assert.equal(opened?.role, "buyer");
});
