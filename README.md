# BlindDeal

You lock a secret price. So does the other side. If the ranges overlap, the deal settles at the midpoint. If they don't, you both get refunded and nobody sees a number.

Use it at [blinddeal.github.io](https://blinddeal.github.io). The code is in [github.com/blinddeal/blinddeal.github.io](https://github.com/blinddeal/blinddeal.github.io).

## How a deal works

The buyer locks a payment with a hidden maximum. The seller locks the asset with a hidden minimum. Each limit is stored as `sha256(price as little-endian u64 || 32-byte salt)`. The deal account keeps the hashes, not the raw prices.

At settle, the program checks one thing: is the buyer's max at least the seller's min? If yes, it pays the floored midpoint and returns the rest. If not, both sides are refunded.

This is commit-reveal, not encryption. The settle transaction still carries both prices and salts, so anyone who reads that transaction can see them. The buyer deposit is a public ceiling and must be at least the revealed buyer price. Helius Privacy Rings is not connected yet.

## Run the site

```bash
npm install
npm run dev
```

Then open [http://127.0.0.1:47331/](http://127.0.0.1:47331/).

## Program

Anchor 1.2.2. Program id `3EmcLYRjwELFoFwWfKgSJfycz1d75xXAXB3ChRHKgzYC`.

```bash
export PATH="$HOME/.local/bin:$HOME/.local/share/solana/install/active_release/bin:$PATH"
anchor build
cargo test -p blind-deal --lib
cargo test -p blind-deal-tests
```

`blind-deal-tests` loads `target/deploy/blind_deal.so` and `fixtures/spl_token.so` in LiteSVM.

The program rejects an empty commitment, a buyer price above the deposit, a party settling the other side's lock, a swapped vault, mint, or token program, a same-party deal, a zero asset amount, and an expiry outside `(now, now + 30 days]`. Both sides must be locked before settle, mutual cancel, or an expiry refund. Settle only works while the deal is open and unexpired. An expiry refund needs the deadline to have passed. A unilateral cancel only works while the other side is still unlocked. Closing the deal returns rent to the initializer after both vaults are empty.

The midpoint is `((buyer as u128 + seller as u128) / 2) as u64`, so a sum near `u64::MAX` does not overflow. Overlap means `buyer_price >= seller_price`. The seller is paid the midpoint. Extra tokens in a vault go back to the side that funded it. Only classic SPL Token accounts are accepted. Token-2022 is not.

Do not commit keypairs or `.env` files. The deployer key is not in this repo.

## SDK

`blinddeal-sdk` is a TypeScript client for browsers and Node 18+. It does not need Anchor at runtime.

```bash
npm install blinddeal-sdk @solana/web3.js
```

The default cluster is devnet. Pass `cluster`, your own `Connection`, or a `programId` if you deploy the program somewhere else.

```ts
import { PublicKey } from "@solana/web3.js";
import {
  associatedTokenAddress,
  commitment,
  createDeal,
  encodeReveal,
  expiryFromNow,
  lockBuyer,
  randomSalt,
  tokenAmount,
} from "blinddeal-sdk";

const max = tokenAmount("12.50", 6);
const salt = randomSalt();

await createDeal({
  wallet,
  buyer: wallet.publicKey,
  seller,
  paymentMint,
  assetMint,
  id: 1n,
  assetAmount: tokenAmount(1, 9),
  expiryTs: expiryFromNow(60 * 60),
  config: { cluster: "devnet" },
});

await lockBuyer({
  wallet,
  buyer: wallet.publicKey,
  seller,
  id: 1n,
  paymentMint,
  buyerPayment: associatedTokenAddress(paymentMint, wallet.publicKey),
  commitment: commitment(max, salt),
  amount: tokenAmount("20", 6),
  config: { cluster: "devnet" },
});

const mySlip = encodeReveal(max, salt);
```

Keep `salt` and `max` on the user's device. The deposit is public and must be at least the secret maximum.

Other calls: `lockSeller`, `settle`, `refund` (after expiry), `cancelBuyer`, `cancelSeller`, `cancel`, and `closeDeal`. `fetchDeal` returns `null` when the account does not exist. Status is `"open"`, `"settled"`, `"refunded"`, or `"cancelled"`.

From `sdk/`:

```bash
npm install
npm test
```

That builds ESM (`dist/index.js`), CommonJS (`dist/index.cjs`), and typings, then runs the tests.

To publish, add an `NPM_TOKEN` repository secret and run the Publish SDK workflow, or run `npm publish --access public` from `sdk/` after `npm login`. The workflow dry-runs unless you turn that off.
