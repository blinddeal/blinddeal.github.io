import assert from "node:assert/strict";
import test from "node:test";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import {
  associatedTokenAddress,
  commitment,
  createDeal,
  dealAddress,
  fetchDeal,
  keypairWallet,
  lockBuyer,
  lockSeller,
  randomSalt,
  settle,
} from "../sdk/dist/index.js";

const PROGRAM = "26gAVfqVbETimiSZSnp8ENUV6JkWzWbpoyQ4oh5YxRva";
const url = "http://127.0.0.1:8899";

test("create, lock both sides, and settle against a local validator", async (t) => {
  const connection = new Connection(url, "confirmed");
  const version = await connection.getVersion();
  t.diagnostic("validator " + JSON.stringify(version));
  const info = await connection.getAccountInfo(new (await import("@solana/web3.js")).PublicKey(PROGRAM), "confirmed");
  assert.ok(info?.executable, "program must be loaded");

  const payer = Keypair.generate();
  const buyer = Keypair.generate();
  const seller = Keypair.generate();
  for (const key of [payer, buyer, seller]) {
    const sig = await connection.requestAirdrop(key.publicKey, 2 * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }

  const paymentMint = await createMint(connection, payer, payer.publicKey, null, 6);
  const assetMint = await createMint(connection, payer, payer.publicKey, null, 0);
  const buyerPayment = await getOrCreateAssociatedTokenAccount(connection, payer, paymentMint, buyer.publicKey);
  const sellerAsset = await getOrCreateAssociatedTokenAccount(connection, payer, assetMint, seller.publicKey);
  await getOrCreateAssociatedTokenAccount(connection, payer, paymentMint, seller.publicKey);
  await getOrCreateAssociatedTokenAccount(connection, payer, assetMint, buyer.publicKey);
  await mintTo(connection, payer, paymentMint, buyerPayment.address, payer, 5_000_000);
  await mintTo(connection, payer, assetMint, sellerAsset.address, payer, 1);

  const config = { cluster: "localnet", commitment: "confirmed", connection, programId: PROGRAM };
  const id = BigInt(Date.now());
  const expiryTs = BigInt(Math.floor(Date.now() / 1000) + 60 * 60);
  await createDeal({
    wallet: keypairWallet(buyer),
    buyer: buyer.publicKey,
    seller: seller.publicKey,
    id,
    paymentMint,
    assetMint,
    assetAmount: 1n,
    expiryTs,
    config,
  });

  const buyerSalt = randomSalt();
  const sellerSalt = randomSalt();
  const buyerPrice = 2_000_000n;
  const sellerPrice = 1_000_000n;
  await lockBuyer({
    wallet: keypairWallet(buyer),
    buyer: buyer.publicKey,
    seller: seller.publicKey,
    id,
    buyerPayment: buyerPayment.address,
    paymentMint,
    commitment: commitment(buyerPrice, buyerSalt),
    amount: buyerPrice,
    config,
  });
  await lockSeller({
    wallet: keypairWallet(seller),
    buyer: buyer.publicKey,
    seller: seller.publicKey,
    id,
    sellerAsset: sellerAsset.address,
    assetMint,
    commitment: commitment(sellerPrice, sellerSalt),
    config,
  });

  const address = dealAddress(buyer.publicKey, seller.publicKey, id, config);
  const locked = await fetchDeal(address, config);
  assert.equal(locked?.buyerLocked, true);
  assert.equal(locked?.sellerLocked, true);
  assert.equal(locked?.status, "open");

  await settle({
    wallet: keypairWallet(buyer),
    buyer: buyer.publicKey,
    seller: seller.publicKey,
    id,
    party: buyer.publicKey,
    buyerPayment: associatedTokenAddress(paymentMint, buyer.publicKey),
    sellerPayment: associatedTokenAddress(paymentMint, seller.publicKey),
    buyerAsset: associatedTokenAddress(assetMint, buyer.publicKey),
    sellerAsset: associatedTokenAddress(assetMint, seller.publicKey),
    paymentMint,
    assetMint,
    buyerPrice,
    buyerSalt,
    sellerPrice,
    sellerSalt,
    config,
  });

  const settled = await fetchDeal(address, config);
  assert.equal(settled?.status, "settled");
  t.diagnostic("deal " + address.toBase58() + " settled at midpoint");
});
