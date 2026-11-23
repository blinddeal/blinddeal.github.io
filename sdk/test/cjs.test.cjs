const assert = require("node:assert/strict");
const test = require("node:test");
const sdk = require("../dist/index.cjs");

test("commonjs entry exports the public helpers", () => {
  assert.equal(typeof sdk.commitment, "function");
  assert.equal(typeof sdk.createDeal, "function");
  assert.equal(typeof sdk.fetchDeal, "function");
  assert.equal(sdk.clusterUrl("devnet"), "https://api.devnet.solana.com");
  assert.equal(sdk.BLIND_DEAL_PROGRAM_ID.toBase58(), "26gAVfqVbETimiSZSnp8ENUV6JkWzWbpoyQ4oh5YxRva");
});
