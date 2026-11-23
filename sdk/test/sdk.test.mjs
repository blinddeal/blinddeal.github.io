import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  BLIND_DEAL_PROGRAM_ID,
  assetVaultAddress,
  clusterUrl,
  commitment,
  createDealInstruction,
  dealAddress,
  decodeReveal,
  encodeReveal,
  paymentVaultAddress,
  programIdOf,
  tokenAmount,
} from "../dist/index.js";

test("commitment is sha256 of the little-endian price and the salt", () => {
  const price = 1500n;
  const salt = new Uint8Array(32).fill(0x11);
  const body = Buffer.alloc(40);
  body.writeBigUInt64LE(price);
  Buffer.from(salt).copy(body, 8);
  const expected = createHash("sha256").update(body).digest();
  assert.deepEqual(Buffer.from(commitment(price, salt)), expected);
  assert.notDeepEqual(commitment(price, salt), commitment(price + 1n, salt));
});

test("reveal slips round-trip", () => {
  const salt = new Uint8Array(32).fill(7);
  const slip = encodeReveal(42n, salt);
  const opened = decodeReveal(slip);
  assert.equal(opened.price, 42n);
  assert.deepEqual(opened.salt, salt);
});

test("token amounts honor decimals", () => {
  assert.equal(tokenAmount("1.5", 6), 1_500_000n);
  assert.equal(tokenAmount(2, 0), 2n);
  assert.throws(() => tokenAmount("1.234", 2));
});

test("deal addresses match the program seeds", () => {
  const buyer = Keypair.generate().publicKey;
  const seller = Keypair.generate().publicKey;
  const id = 9n;
  const idBytes = Buffer.alloc(8);
  idBytes.writeBigUInt64LE(id);
  const [expected] = PublicKey.findProgramAddressSync(
    [Buffer.from("deal"), buyer.toBuffer(), seller.toBuffer(), idBytes],
    BLIND_DEAL_PROGRAM_ID,
  );
  const deal = dealAddress(buyer, seller, id);
  assert.equal(deal.toBase58(), expected.toBase58());
  const [payment] = PublicKey.findProgramAddressSync(
    [Buffer.from("payment"), deal.toBuffer()],
    BLIND_DEAL_PROGRAM_ID,
  );
  const [asset] = PublicKey.findProgramAddressSync(
    [Buffer.from("asset"), deal.toBuffer()],
    BLIND_DEAL_PROGRAM_ID,
  );
  assert.equal(paymentVaultAddress(deal).toBase58(), payment.toBase58());
  assert.equal(assetVaultAddress(deal).toBase58(), asset.toBase58());
});

test("createDeal instruction uses the initialize discriminator and a custom program id", () => {
  const buyer = Keypair.generate().publicKey;
  const seller = Keypair.generate().publicKey;
  const programId = Keypair.generate().publicKey;
  const ix = createDealInstruction({
    buyer,
    seller,
    id: 4n,
    paymentMint: Keypair.generate().publicKey,
    assetMint: Keypair.generate().publicKey,
    assetAmount: 1n,
    expiryTs: 1_900_000_000n,
    config: { programId },
  });
  assert.deepEqual([...ix.data.subarray(0, 8)], [175, 175, 109, 31, 13, 152, 155, 237]);
  assert.equal(ix.programId.toBase58(), programId.toBase58());
  assert.equal(ix.keys[0].pubkey.toBase58(), buyer.toBase58());
  assert.equal(ix.keys[0].isSigner, true);
  assert.equal(ix.keys.length, 9);
  assert.equal(programIdOf({ programId: programId.toBase58() }).toBase58(), programId.toBase58());
});

test("clusters default to devnet and accept a raw url", () => {
  assert.equal(clusterUrl(), "https://api.devnet.solana.com");
  assert.equal(clusterUrl("localnet"), "http://127.0.0.1:8899");
  assert.equal(clusterUrl("https://rpc.example"), "https://rpc.example");
  assert.throws(() => clusterUrl("mars"));
});
