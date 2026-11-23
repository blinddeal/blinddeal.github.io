use std::path::PathBuf;
use std::str::FromStr;

use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, InstructionData, ToAccountMetas};
use blind_deal::state::{Deal, DealStatus};
use blind_deal::{commitment, ID as PROGRAM_PUBKEY};
use litesvm::LiteSVM;
use solana_address::Address;
use solana_clock::Clock;
use solana_instruction::{AccountMeta, Instruction};
use solana_keypair::Keypair;
use solana_message::Message;
use solana_signer::Signer;
use solana_transaction::Transaction;

const NOW: i64 = 1_700_000_000;
const TOKEN_PROGRAM: &str = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SYSTEM_PROGRAM: &str = "11111111111111111111111111111111";

struct World {
    svm: LiteSVM,
    buyer: Keypair,
    seller: Keypair,
    stranger: Keypair,
    payment_mint: Keypair,
    asset_mint: Keypair,
    buyer_payment: Keypair,
    seller_payment: Keypair,
    buyer_asset: Keypair,
    seller_asset: Keypair,
}

struct DealKeys {
    id: u64,
    deal: Address,
    payment_vault: Address,
    asset_vault: Address,
    expiry: i64,
}

fn address_str(value: &str) -> Address {
    Address::from_str(value).unwrap()
}

fn from_anchor(key: &Pubkey) -> Address {
    Address::new_from_array(key.to_bytes())
}

fn to_anchor(key: &Address) -> Pubkey {
    Pubkey::new_from_array(key.as_ref().try_into().unwrap())
}

fn program_id() -> Address {
    from_anchor(&PROGRAM_PUBKEY)
}

fn token_program() -> Address {
    address_str(TOKEN_PROGRAM)
}

fn system_program() -> Address {
    address_str(SYSTEM_PROGRAM)
}

fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("..")
}

fn boot() -> World {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(program_id(), repo_root().join("target/deploy/blind_deal.so"))
        .unwrap();
    svm.add_program_from_file(token_program(), repo_root().join("fixtures/spl_token.so"))
        .unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);
    let mut world = World {
        svm,
        buyer: Keypair::new(),
        seller: Keypair::new(),
        stranger: Keypair::new(),
        payment_mint: Keypair::new(),
        asset_mint: Keypair::new(),
        buyer_payment: Keypair::new(),
        seller_payment: Keypair::new(),
        buyer_asset: Keypair::new(),
        seller_asset: Keypair::new(),
    };
    world.svm.airdrop(&world.buyer.pubkey(), 20_000_000_000).unwrap();
    world.svm.airdrop(&world.seller.pubkey(), 20_000_000_000).unwrap();
    world.svm.airdrop(&world.stranger.pubkey(), 2_000_000_000).unwrap();
    create_mint(&mut world.svm, &world.buyer, &world.payment_mint, 6);
    create_mint(&mut world.svm, &world.buyer, &world.asset_mint, 0);
    create_token_account(
        &mut world.svm,
        &world.buyer,
        &world.buyer_payment,
        &world.payment_mint.pubkey(),
        &world.buyer.pubkey(),
    );
    create_token_account(
        &mut world.svm,
        &world.buyer,
        &world.seller_payment,
        &world.payment_mint.pubkey(),
        &world.seller.pubkey(),
    );
    create_token_account(
        &mut world.svm,
        &world.buyer,
        &world.buyer_asset,
        &world.asset_mint.pubkey(),
        &world.buyer.pubkey(),
    );
    create_token_account(
        &mut world.svm,
        &world.seller,
        &world.seller_asset,
        &world.asset_mint.pubkey(),
        &world.seller.pubkey(),
    );
    mint_to(
        &mut world.svm,
        &world.buyer,
        &world.payment_mint,
        &world.buyer_payment.pubkey(),
        1_000_000_000,
    );
    mint_to(
        &mut world.svm,
        &world.buyer,
        &world.asset_mint,
        &world.seller_asset.pubkey(),
        1_000,
    );
    world
}

macro_rules! tx {
    ($world:ident, buyer, $ix:expr) => {{
        let ix = $ix;
        send(&mut $world.svm, &[ix], &$world.buyer, &[])
    }};
    ($world:ident, seller, $ix:expr) => {{
        let ix = $ix;
        send(&mut $world.svm, &[ix], &$world.seller, &[])
    }};
    ($world:ident, stranger, $ix:expr) => {{
        let ix = $ix;
        send(&mut $world.svm, &[ix], &$world.stranger, &[])
    }};
    ($world:ident, both, $ix:expr) => {{
        let ix = $ix;
        send(&mut $world.svm, &[ix], &$world.buyer, &[&$world.seller])
    }};
}

fn send(
    svm: &mut LiteSVM,
    instructions: &[Instruction],
    payer: &Keypair,
    signers: &[&Keypair],
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let mut ixs = vec![compute_budget(1_400_000)];
    ixs.extend_from_slice(instructions);
    let message = Message::new(&ixs, Some(&payer.pubkey()));
    let tx = Transaction::new(&signers_as_slice(payer, signers), message, svm.latest_blockhash());
    svm.send_transaction(tx)
}

fn signers_as_slice<'a>(payer: &'a Keypair, extra: &'a [&'a Keypair]) -> Vec<&'a Keypair> {
    let mut all = vec![payer];
    for signer in extra {
        if signer.pubkey() != payer.pubkey() {
            all.push(*signer);
        }
    }
    all
}

fn compute_budget(units: u32) -> Instruction {
    let mut data = vec![2u8];
    data.extend_from_slice(&units.to_le_bytes());
    Instruction {
        program_id: address_str("ComputeBudget111111111111111111111111111111"),
        accounts: vec![],
        data,
    }
}

fn ok(result: Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>) {
    if let Err(err) = result {
        panic!("{}\n{:?}", err.meta.pretty_logs(), err.err);
    }
}

fn logs_of(
    result: &Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>,
) -> String {
    match result {
        Ok(meta) => meta.logs.join("\n"),
        Err(err) => err.meta.logs.join("\n"),
    }
}

fn assert_fails(
    result: Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>,
    needle: &str,
) {
    let text = logs_of(&result);
    assert!(result.is_err(), "expected failure, logs:\n{text}");
    assert!(
        text.contains(needle),
        "expected `{needle}` in logs:\n{text}"
    );
}

fn anchor_ix(program: Address, metas: Vec<anchor_lang::prelude::AccountMeta>, data: Vec<u8>) -> Instruction {
    Instruction {
        program_id: program,
        accounts: metas
            .into_iter()
            .map(|meta| AccountMeta {
                pubkey: from_anchor(&meta.pubkey),
                is_signer: meta.is_signer,
                is_writable: meta.is_writable,
            })
            .collect(),
        data,
    }
}

fn create_account_ix(from: Address, to: Address, lamports: u64, space: u64, owner: Address) -> Instruction {
    let mut data = Vec::with_capacity(52);
    data.extend_from_slice(&0u32.to_le_bytes());
    data.extend_from_slice(&lamports.to_le_bytes());
    data.extend_from_slice(&space.to_le_bytes());
    data.extend_from_slice(owner.as_ref());
    Instruction {
        program_id: system_program(),
        accounts: vec![AccountMeta::new(from, true), AccountMeta::new(to, true)],
        data,
    }
}

fn create_mint(svm: &mut LiteSVM, payer: &Keypair, mint: &Keypair, decimals: u8) {
    let lamports = svm.minimum_balance_for_rent_exemption(82);
    let create = create_account_ix(payer.pubkey(), mint.pubkey(), lamports, 82, token_program());
    let mut data = vec![20u8, decimals];
    data.extend_from_slice(payer.pubkey().as_ref());
    data.push(0);
    let init = Instruction {
        program_id: token_program(),
        accounts: vec![AccountMeta::new(mint.pubkey(), false)],
        data,
    };
    ok(send(svm, &[create, init], payer, &[mint]));
}

fn create_token_account(
    svm: &mut LiteSVM,
    payer: &Keypair,
    account: &Keypair,
    mint: &Address,
    owner: &Address,
) {
    let lamports = svm.minimum_balance_for_rent_exemption(165);
    let create = create_account_ix(payer.pubkey(), account.pubkey(), lamports, 165, token_program());
    let mut data = vec![18u8];
    data.extend_from_slice(owner.as_ref());
    let init = Instruction {
        program_id: token_program(),
        accounts: vec![
            AccountMeta::new(account.pubkey(), false),
            AccountMeta::new_readonly(*mint, false),
        ],
        data,
    };
    ok(send(svm, &[create, init], payer, &[account]));
}

fn mint_to(svm: &mut LiteSVM, authority: &Keypair, mint: &Keypair, dest: &Address, amount: u64) {
    let mut data = vec![7u8];
    data.extend_from_slice(&amount.to_le_bytes());
    let ix = Instruction {
        program_id: token_program(),
        accounts: vec![
            AccountMeta::new(mint.pubkey(), false),
            AccountMeta::new(*dest, false),
            AccountMeta::new_readonly(authority.pubkey(), true),
        ],
        data,
    };
    ok(send(svm, &[ix], authority, &[]));
}

fn token_amount(svm: &LiteSVM, account: &Address) -> u64 {
    let data = svm.get_account(account).unwrap().data;
    u64::from_le_bytes(data[64..72].try_into().unwrap())
}

fn load_deal(svm: &LiteSVM, deal: &Address) -> Deal {
    let data = svm.get_account(deal).expect("deal account").data;
    let mut slice: &[u8] = &data;
    Deal::try_deserialize(&mut slice).unwrap()
}

fn pda(seeds: &[&[u8]]) -> Address {
    Address::find_program_address(seeds, &program_id()).0
}

fn deal_keys(buyer: &Address, seller: &Address, id: u64, expiry: i64) -> DealKeys {
    let id_bytes = id.to_le_bytes();
    let deal = pda(&[b"deal", buyer.as_ref(), seller.as_ref(), &id_bytes]);
    let payment_vault = pda(&[b"payment", deal.as_ref()]);
    let asset_vault = pda(&[b"asset", deal.as_ref()]);
    DealKeys {
        id,
        deal,
        payment_vault,
        asset_vault,
        expiry,
    }
}

fn initialize_ix(world: &World, keys: &DealKeys, asset_amount: u64) -> Instruction {
    let accounts = blind_deal::accounts::Initialize {
        buyer: to_anchor(&world.buyer.pubkey()),
        seller: to_anchor(&world.seller.pubkey()),
        payment_mint: to_anchor(&world.payment_mint.pubkey()),
        asset_mint: to_anchor(&world.asset_mint.pubkey()),
        deal: to_anchor(&keys.deal),
        payment_vault: to_anchor(&keys.payment_vault),
        asset_vault: to_anchor(&keys.asset_vault),
        token_program: to_anchor(&token_program()),
        system_program: to_anchor(&system_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::Initialize {
            id: keys.id,
            asset_amount,
            expiry_ts: keys.expiry,
        }
        .data(),
    )
}

fn lock_buyer_ix(world: &World, keys: &DealKeys, commit: [u8; 32], amount: u64) -> Instruction {
    let accounts = blind_deal::accounts::LockBuyer {
        buyer: to_anchor(&world.buyer.pubkey()),
        deal: to_anchor(&keys.deal),
        buyer_payment: to_anchor(&world.buyer_payment.pubkey()),
        payment_vault: to_anchor(&keys.payment_vault),
        payment_mint: to_anchor(&world.payment_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::LockBuyer {
            commitment: commit,
            amount,
        }
        .data(),
    )
}

fn lock_seller_ix(world: &World, keys: &DealKeys, commit: [u8; 32]) -> Instruction {
    let accounts = blind_deal::accounts::LockSeller {
        seller: to_anchor(&world.seller.pubkey()),
        deal: to_anchor(&keys.deal),
        seller_asset: to_anchor(&world.seller_asset.pubkey()),
        asset_vault: to_anchor(&keys.asset_vault),
        asset_mint: to_anchor(&world.asset_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::LockSeller { commitment: commit }.data(),
    )
}

fn settle_ix(
    world: &World,
    keys: &DealKeys,
    party: &Address,
    buyer_price: u64,
    buyer_salt: [u8; 32],
    seller_price: u64,
    seller_salt: [u8; 32],
    buyer_payment: &Address,
    seller_payment: &Address,
    buyer_asset: &Address,
    seller_asset: &Address,
) -> Instruction {
    let accounts = blind_deal::accounts::Settle {
        party: to_anchor(party),
        deal: to_anchor(&keys.deal),
        buyer_payment: to_anchor(buyer_payment),
        seller_payment: to_anchor(seller_payment),
        buyer_asset: to_anchor(buyer_asset),
        seller_asset: to_anchor(seller_asset),
        payment_vault: to_anchor(&keys.payment_vault),
        asset_vault: to_anchor(&keys.asset_vault),
        payment_mint: to_anchor(&world.payment_mint.pubkey()),
        asset_mint: to_anchor(&world.asset_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::Settle {
            buyer_price,
            buyer_salt,
            seller_price,
            seller_salt,
        }
        .data(),
    )
}

fn open_funded(world: &mut World, id: u64, asset_amount: u64, deposit: u64, buyer_max: u64, seller_min: u64) -> (DealKeys, [u8; 32], [u8; 32]) {
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), id, NOW + 3_600);
    ok(tx!(world, buyer, initialize_ix(world, &keys, asset_amount)));
    let buyer_salt = [0x11; 32];
    let seller_salt = [0x22; 32];
    ok(tx!(
        world,
        buyer,
        lock_buyer_ix(world, &keys, commitment(buyer_max, &buyer_salt), deposit)
    ));
    ok(tx!(
        world,
        seller,
        lock_seller_ix(world, &keys, commitment(seller_min, &seller_salt))
    ));
    (keys, buyer_salt, seller_salt)
}

fn settle_default(
    world: &mut World,
    keys: &DealKeys,
    buyer_price: u64,
    buyer_salt: [u8; 32],
    seller_price: u64,
    seller_salt: [u8; 32],
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let ix = settle_ix(
        world,
        keys,
        &world.buyer.pubkey(),
        buyer_price,
        buyer_salt,
        seller_price,
        seller_salt,
        &world.buyer_payment.pubkey(),
        &world.seller_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    tx!(world, buyer, ix)
}

fn warp(world: &mut World, timestamp: i64) {
    let mut clock = world.svm.get_sysvar::<Clock>();
    clock.unix_timestamp = timestamp;
    world.svm.set_sysvar(&clock);
    world.svm.expire_blockhash();
}

fn fresh_blockhash(world: &mut World) {
    world.svm.expire_blockhash();
}

fn contains_bytes(data: &[u8], needle: &[u8]) -> bool {
    data.windows(needle.len()).any(|window| window == needle)
}

fn program_log_has_number(logs: &str, value: u64) -> bool {
    let needle = value.to_string();
    logs.lines().any(|line| {
        let Some(rest) = line.strip_prefix("Program log: ") else {
            return false;
        };
        rest.split(|c: char| !c.is_ascii_digit())
            .any(|word| word == needle)
    })
}

#[test]
fn deal_pays_floored_midpoint_and_hides_limits() {
    let mut world = boot();
    let buyer_before = token_amount(&world.svm, &world.buyer_payment.pubkey());
    let seller_asset_before = token_amount(&world.svm, &world.seller_asset.pubkey());
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 1, 4, 1_000, 801, 600);
    let stored = load_deal(&world.svm, &keys.deal);
    let raw = world.svm.get_account(&keys.deal).unwrap().data;
    assert!(!contains_bytes(&raw, &801u64.to_le_bytes()));
    assert!(!contains_bytes(&raw, &600u64.to_le_bytes()));
    assert!(!contains_bytes(&raw, &buyer_salt));
    assert!(!contains_bytes(&raw, &seller_salt));
    assert_eq!(stored.buyer_deposit, 1_000);
    assert_eq!(stored.buyer_commitment, commitment(801, &buyer_salt));
    let meta = settle_default(&mut world, &keys, 801, buyer_salt, 600, seller_salt).unwrap();
    let logs = meta.logs.join("\n");
    assert!(!program_log_has_number(&logs, 801), "{logs}");
    assert!(!program_log_has_number(&logs, 600), "{logs}");
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 700);
    assert_eq!(
        token_amount(&world.svm, &world.buyer_payment.pubkey()),
        buyer_before - 700
    );
    assert_eq!(token_amount(&world.svm, &world.buyer_asset.pubkey()), 4);
    assert_eq!(
        token_amount(&world.svm, &world.seller_asset.pubkey()),
        seller_asset_before - 4
    );
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 0);
    assert_eq!(token_amount(&world.svm, &keys.asset_vault), 0);
    let finished = load_deal(&world.svm, &keys.deal);
    assert_eq!(finished.status, DealStatus::Settled);
    assert_eq!(finished.buyer_deposit, 0);
    assert!(!contains_bytes(
        &world.svm.get_account(&keys.deal).unwrap().data,
        &801u64.to_le_bytes()
    ));
}

#[test]
fn no_overlap_refunds_both_and_stores_no_prices() {
    let mut world = boot();
    let payment_before = token_amount(&world.svm, &world.buyer_payment.pubkey());
    let asset_before = token_amount(&world.svm, &world.seller_asset.pubkey());
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 2, 7, 400, 250, 900);
    ok(settle_default(&mut world, &keys, 250, buyer_salt, 900, seller_salt));
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Refunded);
    assert_eq!(token_amount(&world.svm, &world.buyer_payment.pubkey()), payment_before);
    assert_eq!(token_amount(&world.svm, &world.seller_asset.pubkey()), asset_before);
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 0);
    assert_eq!(token_amount(&world.svm, &world.buyer_asset.pubkey()), 0);
    let raw = world.svm.get_account(&keys.deal).unwrap().data;
    assert!(!contains_bytes(&raw, &250u64.to_le_bytes()));
    assert!(!contains_bytes(&raw, &900u64.to_le_bytes()));
}

#[test]
fn equal_prices_settle_at_that_price() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 3, 1, 50, 50, 50);
    ok(settle_default(&mut world, &keys, 50, buyer_salt, 50, seller_salt));
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 50);
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Settled);
}

#[test]
fn odd_sum_floors_midpoint_toward_buyer() {
    let mut world = boot();
    let before = token_amount(&world.svm, &world.buyer_payment.pubkey());
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 4, 1, 5, 5, 2);
    ok(settle_default(&mut world, &keys, 5, buyer_salt, 2, seller_salt));
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 3);
    assert_eq!(token_amount(&world.svm, &world.buyer_payment.pubkey()), before - 3);
}

#[test]
fn u64_max_midpoint_does_not_overflow() {
    let mut world = boot();
    mint_to(
        &mut world.svm,
        &world.buyer,
        &world.payment_mint,
        &world.buyer_payment.pubkey(),
        u64::MAX - 1_000_000_000,
    );
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 5, 1, u64::MAX, u64::MAX, u64::MAX - 1);
    ok(settle_default(
        &mut world,
        &keys,
        u64::MAX,
        buyer_salt,
        u64::MAX - 1,
        seller_salt,
    ));
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), u64::MAX - 1);
    assert_eq!(token_amount(&world.svm, &world.buyer_payment.pubkey()), 1);
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Settled);
}

#[test]
fn double_settle_and_replay_are_rejected() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 6, 1, 100, 80, 40);
    let ix = settle_ix(
        &world,
        &keys,
        &world.buyer.pubkey(),
        80,
        buyer_salt,
        40,
        seller_salt,
        &world.buyer_payment.pubkey(),
        &world.seller_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    let message = Message::new(&[compute_budget(1_400_000), ix], Some(&world.buyer.pubkey()));
    let tx = Transaction::new(&[&world.buyer], message, world.svm.latest_blockhash());
    world.svm.send_transaction(tx.clone()).unwrap();
    assert!(world.svm.send_transaction(tx).is_err());
    fresh_blockhash(&mut world);
    assert_fails(
        settle_default(&mut world, &keys, 80, buyer_salt, 40, seller_salt),
        "NotOpen",
    );
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 60);
}

#[test]
fn refund_then_settle_and_second_refund_fail() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 7, 2, 90, 10, 80);
    ok(settle_default(&mut world, &keys, 10, buyer_salt, 80, seller_salt));
    fresh_blockhash(&mut world);
    assert_fails(
        settle_default(&mut world, &keys, 10, buyer_salt, 80, seller_salt),
        "NotOpen",
    );
    warp(&mut world, keys.expiry);
    assert_fails(refund(&mut world, &keys, true), "NotOpen");
}

#[test]
fn settle_then_expired_refund_fails() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 8, 1, 40, 40, 10);
    ok(settle_default(&mut world, &keys, 40, buyer_salt, 10, seller_salt));
    warp(&mut world, keys.expiry + 5);
    assert_fails(refund(&mut world, &keys, false), "NotOpen");
}

#[test]
fn bad_salt_bad_price_and_unfunded_max_fail() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 9, 1, 100, 70, 30);
    assert_fails(
        settle_default(&mut world, &keys, 70, [0u8; 32], 30, seller_salt),
        "BadCommitment",
    );
    assert_fails(
        settle_default(&mut world, &keys, 71, buyer_salt, 30, seller_salt),
        "BadCommitment",
    );
    assert_fails(
        settle_default(&mut world, &keys, 70, buyer_salt, 30, [3u8; 32]),
        "BadCommitment",
    );
    let early = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 91, NOW + 100);
    ok(tx!(world, buyer, initialize_ix(&world, &early, 1)));
    ok(tx!(world, buyer, lock_buyer_ix(&world, &early, commitment(10, &buyer_salt), 10)));
    ok(tx!(world, seller, lock_seller_ix(&world, &early, commitment(1, &seller_salt))));
    assert_fails(
        settle_default(&mut world, &early, 11, buyer_salt, 1, seller_salt),
        "BadCommitment",
    );
}

#[test]
fn deposit_below_revealed_max_is_rejected() {
    let mut world = boot();
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 10, NOW + 500);
    let buyer_salt = [4u8; 32];
    let seller_salt = [5u8; 32];
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 1)));
    ok(tx!(world, buyer, lock_buyer_ix(&world, &keys, commitment(20, &buyer_salt), 20)));
    ok(tx!(world, seller, lock_seller_ix(&world, &keys, commitment(10, &seller_salt))));
    assert_fails(
        settle_default(&mut world, &keys, 21, buyer_salt, 10, seller_salt),
        "BadCommitment",
    );
    let fake_salt = buyer_salt;
    let _ = fake_salt;
    let ix_price = commitment(25, &buyer_salt);
    assert_ne!(ix_price, commitment(20, &buyer_salt));
    assert_fails(
        {
            let mut salt = buyer_salt;
            salt[0] ^= 1;
            let _ = salt;
            settle_default(&mut world, &keys, 30, buyer_salt, 10, seller_salt)
        },
        "BadCommitment",
    );
    let commit = commitment(40, &[9u8; 32]);
    let keys_b = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 11, NOW + 500);
    ok(tx!(world, buyer, initialize_ix(&world, &keys_b, 1)));
    ok(tx!(world, buyer, lock_buyer_ix(&world, &keys_b, commit, 15)));
    ok(tx!(world, seller, lock_seller_ix(&world, &keys_b, commitment(1, &seller_salt))));
    assert_fails(
        settle_default(&mut world, &keys_b, 40, [9u8; 32], 1, seller_salt),
        "DepositTooSmall",
    );
    assert_eq!(load_deal(&world.svm, &keys_b.deal).status, DealStatus::Open);
    assert_eq!(token_amount(&world.svm, &keys_b.payment_vault), 15);
}

#[test]
fn strangers_and_swapped_roles_cannot_lock_or_settle() {
    let mut world = boot();
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 12, NOW + 800);
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 1)));
    let mut rogue = lock_buyer_ix(&world, &keys, [1u8; 32], 10);
    rogue.accounts[0].pubkey = world.seller.pubkey();
    assert_fails(tx!(world, seller, rogue), "ConstraintHasOne");
    let mut stranger_lock = lock_seller_ix(&world, &keys, [2u8; 32]);
    stranger_lock.accounts[0].pubkey = world.stranger.pubkey();
    assert_fails(
        tx!(world, stranger, stranger_lock),
        "ConstraintHasOne",
    );
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 13, 1, 30, 30, 10);
    let ix = settle_ix(
        &world,
        &keys,
        &world.stranger.pubkey(),
        30,
        buyer_salt,
        10,
        seller_salt,
        &world.buyer_payment.pubkey(),
        &world.seller_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    assert_fails(tx!(world, stranger, ix), "NotParty");
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 30);
}

#[test]
fn substituted_vault_destination_and_mint_are_rejected() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 14, 3, 80, 80, 20);
    let other = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 140, NOW + 900);
    ok(tx!(world, buyer, initialize_ix(&world, &other, 3)));
    let mut wrong_vault = settle_ix(
        &world,
        &keys,
        &world.buyer.pubkey(),
        80,
        buyer_salt,
        20,
        seller_salt,
        &world.buyer_payment.pubkey(),
        &world.seller_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    for meta in wrong_vault.accounts.iter_mut() {
        if meta.pubkey == keys.payment_vault {
            meta.pubkey = other.payment_vault;
        }
    }
    assert_fails(tx!(world, buyer, wrong_vault), "ConstraintSeeds");
    let stranger_payment = Keypair::new();
    let buyer_wrong_mint = Keypair::new();
    let payment_mint = world.payment_mint.pubkey();
    let asset_mint = world.asset_mint.pubkey();
    let stranger = world.stranger.pubkey();
    let buyer = world.buyer.pubkey();
    create_token_account(
        &mut world.svm,
        &world.buyer,
        &stranger_payment,
        &payment_mint,
        &stranger,
    );
    create_token_account(
        &mut world.svm,
        &world.buyer,
        &buyer_wrong_mint,
        &asset_mint,
        &buyer,
    );
    let wrong_owner = settle_ix(
        &world,
        &keys,
        &world.buyer.pubkey(),
        80,
        buyer_salt,
        20,
        seller_salt,
        &world.buyer_payment.pubkey(),
        &stranger_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    assert_fails(
        tx!(world, buyer, wrong_owner),
        "ConstraintTokenOwner",
    );
    let wrong_mint = settle_ix(
        &world,
        &keys,
        &world.buyer.pubkey(),
        80,
        buyer_salt,
        20,
        seller_salt,
        &buyer_wrong_mint.pubkey(),
        &world.seller_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    assert_fails(
        tx!(world, buyer, wrong_mint),
        "ConstraintTokenMint",
    );
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Open);
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 80);
}

#[test]
fn token_program_substitution_is_rejected() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 15, 1, 25, 25, 5);
    let mut ix = settle_ix(
        &world,
        &keys,
        &world.buyer.pubkey(),
        25,
        buyer_salt,
        5,
        seller_salt,
        &world.buyer_payment.pubkey(),
        &world.seller_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    for meta in ix.accounts.iter_mut() {
        if meta.pubkey == token_program() {
            meta.pubkey = system_program();
        }
    }
    assert_fails(tx!(world, buyer, ix), "InvalidProgramId");
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 25);
}

#[test]
fn same_party_zero_amounts_past_and_far_expiry_rejected() {
    let mut world = boot();
    let same = deal_keys(&world.buyer.pubkey(), &world.buyer.pubkey(), 16, NOW + 50);
    let mut ix = initialize_ix(&world, &same, 1);
    ix.accounts[1].pubkey = world.buyer.pubkey();
    assert_fails(tx!(world, buyer, ix), "SameParty");
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 17, NOW + 50);
    assert_fails(
        tx!(world, buyer, initialize_ix(&world, &keys, 0)),
        "ZeroAmount",
    );
    let past = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 18, NOW);
    assert_fails(
        tx!(world, buyer, initialize_ix(&world, &past, 1)),
        "ExpiryNotFuture",
    );
    let far = deal_keys(
        &world.buyer.pubkey(),
        &world.seller.pubkey(),
        19,
        NOW + (30 * 24 * 60 * 60) + 10,
    );
    assert_fails(
        tx!(world, buyer, initialize_ix(&world, &far, 1)),
        "ExpiryTooFar",
    );
}

#[test]
fn duplicate_id_collides_and_distinct_ids_do_not() {
    let mut world = boot();
    let first = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 20, NOW + 80);
    let second = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 21, NOW + 80);
    ok(tx!(world, buyer, initialize_ix(&world, &first, 1)));
    assert!(tx!(world, buyer, initialize_ix(&world, &first, 1)).is_err());
    ok(tx!(world, buyer, initialize_ix(&world, &second, 2)));
    assert_ne!(first.deal, second.deal);
    assert_ne!(first.payment_vault, second.payment_vault);
    assert_ne!(first.asset_vault, second.asset_vault);
}

#[test]
fn relock_and_partial_settle_are_rejected() {
    let mut world = boot();
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 22, NOW + 90);
    let salt = [6u8; 32];
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 1)));
    ok(tx!(world, buyer, lock_buyer_ix(&world, &keys, commitment(10, &salt), 10)));
    assert_fails(
        tx!(world, buyer, lock_buyer_ix(&world, &keys, commitment(12, &salt), 12)),
        "BuyerAlreadyLocked",
    );
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 10);
    assert_fails(
        settle_default(&mut world, &keys, 10, salt, 1, salt),
        "SellerNotLocked",
    );
    ok(tx!(world, seller, lock_seller_ix(&world, &keys, commitment(1, &salt))));
    assert_fails(
        tx!(world, seller, lock_seller_ix(&world, &keys, commitment(2, &salt))),
        "SellerAlreadyLocked",
    );
    assert_fails(
        tx!(world, buyer, lock_buyer_ix(&world, &keys, [0u8; 32], 5)),
        "BuyerAlreadyLocked",
    );
}

#[test]
fn empty_commitment_and_zero_deposit_rejected() {
    let mut world = boot();
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 23, NOW + 90);
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 1)));
    assert_fails(
        tx!(world, buyer, lock_buyer_ix(&world, &keys, [0u8; 32], 5)),
        "EmptyCommitment",
    );
    assert_fails(
        tx!(world, buyer, lock_buyer_ix(&world, &keys, [9u8; 32], 0)),
        "ZeroAmount",
    );
    assert_fails(
        tx!(world, seller, lock_seller_ix(&world, &keys, [0u8; 32])),
        "EmptyCommitment",
    );
}

#[test]
fn seller_cannot_lock_a_different_amount() {
    let mut world = boot();
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 24, NOW + 90);
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 5_000)));
    let before = token_amount(&world.svm, &world.seller_asset.pubkey());
    assert!(tx!(world, seller, lock_seller_ix(&world, &keys, [8u8; 32])).is_err());
    assert_eq!(token_amount(&world.svm, &world.seller_asset.pubkey()), before);
    assert!(!load_deal(&world.svm, &keys.deal).seller_locked);
}

#[test]
fn unilateral_cancel_stops_once_both_lock_and_mutual_unwinds() {
    let mut world = boot();
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 25, NOW + 1_000);
    let payment_before = token_amount(&world.svm, &world.buyer_payment.pubkey());
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 2)));
    ok(tx!(world, buyer, lock_buyer_ix(&world, &keys, commitment(15, &[1u8; 32]), 15)));
    ok(tx!(world, buyer, cancel_buyer(&world, &keys)));
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Cancelled);
    assert_eq!(token_amount(&world.svm, &world.buyer_payment.pubkey()), payment_before);
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 0);

    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 26, NOW + 1_000);
    let asset_before = token_amount(&world.svm, &world.seller_asset.pubkey());
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 2)));
    ok(tx!(world, seller, lock_seller_ix(&world, &keys, commitment(9, &[2u8; 32]))));
    assert_fails(
        tx!(world, buyer, cancel_buyer(&world, &keys)),
        "BothLocked",
    );
    ok(tx!(world, seller, cancel_seller(&world, &keys)));
    assert_eq!(token_amount(&world.svm, &world.seller_asset.pubkey()), asset_before);
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Cancelled);

    let (keys, _, _) = open_funded(&mut world, 27, 2, 18, 18, 4);
    assert_fails(
        tx!(world, buyer, cancel_buyer(&world, &keys)),
        "BothLocked",
    );
    assert_fails(
        tx!(world, seller, cancel_seller(&world, &keys)),
        "BothLocked",
    );
    let payment_before = token_amount(&world.svm, &world.buyer_payment.pubkey());
    let asset_before = token_amount(&world.svm, &world.seller_asset.pubkey());
    ok(tx!(world, both, cancel_mutual(&world, &keys)));
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Cancelled);
    assert_eq!(token_amount(&world.svm, &world.buyer_payment.pubkey()), payment_before + 18);
    assert_eq!(token_amount(&world.svm, &world.seller_asset.pubkey()), asset_before + 2);
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 0);
}

#[test]
fn expiry_boundary_rejects_the_wrong_path() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 28, 1, 22, 22, 6);
    warp(&mut world, keys.expiry - 1);
    assert_fails(refund(&mut world, &keys, true), "NotExpired");
    ok(settle_default(&mut world, &keys, 22, buyer_salt, 6, seller_salt));
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 14);

    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 29, 1, 16, 9, 40);
    warp(&mut world, keys.expiry);
    assert_fails(
        settle_default(&mut world, &keys, 9, buyer_salt, 40, seller_salt),
        "Expired",
    );
    let payment_before = token_amount(&world.svm, &world.buyer_payment.pubkey());
    let asset_before = token_amount(&world.svm, &world.seller_asset.pubkey());
    ok(refund(&mut world, &keys, false));
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Refunded);
    assert_eq!(token_amount(&world.svm, &world.buyer_payment.pubkey()), payment_before + 16);
    assert_eq!(token_amount(&world.svm, &world.seller_asset.pubkey()), asset_before + 1);
    assert_fails(refund(&mut world, &keys, true), "NotOpen");
}

#[test]
fn close_returns_rent_to_initializer_and_rejects_drain() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 30, 1, 12, 12, 4);
    assert_fails(
        tx!(world, buyer, close_ix(&world, &keys, &world.buyer.pubkey())),
        "NotFinished",
    );
    ok(settle_default(&mut world, &keys, 12, buyer_salt, 4, seller_salt));
    let attacker_before = world.svm.get_balance(&world.stranger.pubkey()).unwrap();
    assert_fails(
        tx!(world, buyer, close_ix(&world, &keys, &world.stranger.pubkey())),
        "NotParty",
    );
    assert_eq!(world.svm.get_balance(&world.stranger.pubkey()).unwrap(), attacker_before);
    assert!(world.svm.get_account(&keys.deal).is_some());
    fresh_blockhash(&mut world);
    let before = world.svm.get_balance(&world.buyer.pubkey()).unwrap();
    let meta = tx!(world, buyer, close_ix(&world, &keys, &world.buyer.pubkey()))
    .unwrap();
    let after = world.svm.get_balance(&world.buyer.pubkey()).unwrap();
    assert!(world.svm.get_account(&keys.deal).is_none());
    assert!(world.svm.get_account(&keys.payment_vault).is_none());
    assert!(world.svm.get_account(&keys.asset_vault).is_none());
    assert!(after + meta.fee > before);
    assert!(tx!(world, buyer, close_ix(&world, &keys, &world.buyer.pubkey()))
    .is_err());
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 1)));
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Open);
    assert!(!load_deal(&world.svm, &keys.deal).buyer_locked);
}

#[test]
fn donation_does_not_change_the_seller_payout() {
    let mut world = boot();
    let (keys, buyer_salt, seller_salt) = open_funded(&mut world, 31, 1, 100, 80, 60);
    let mut data = vec![3u8];
    data.extend_from_slice(&15u64.to_le_bytes());
    let donate = Instruction {
        program_id: token_program(),
        accounts: vec![
            AccountMeta::new(world.buyer_payment.pubkey(), false),
            AccountMeta::new(keys.payment_vault, false),
            AccountMeta::new_readonly(world.buyer.pubkey(), true),
        ],
        data,
    };
    ok(tx!(world, buyer, donate));
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 115);
    ok(settle_default(&mut world, &keys, 80, buyer_salt, 60, seller_salt));
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 70);
    assert_eq!(token_amount(&world.svm, &keys.payment_vault), 0);
}

#[test]
fn seller_can_settle_and_one_sided_locks_are_isolated() {
    let mut world = boot();
    let keys = deal_keys(&world.buyer.pubkey(), &world.seller.pubkey(), 32, NOW + 400);
    let buyer_salt = [7u8; 32];
    let seller_salt = [8u8; 32];
    ok(tx!(world, buyer, initialize_ix(&world, &keys, 1)));
    ok(tx!(world, seller, lock_seller_ix(&world, &keys, commitment(5, &seller_salt))));
    ok(tx!(world, buyer, lock_buyer_ix(&world, &keys, commitment(9, &buyer_salt), 9)));
    let ix = settle_ix(
        &world,
        &keys,
        &world.seller.pubkey(),
        9,
        buyer_salt,
        5,
        seller_salt,
        &world.buyer_payment.pubkey(),
        &world.seller_payment.pubkey(),
        &world.buyer_asset.pubkey(),
        &world.seller_asset.pubkey(),
    );
    ok(tx!(world, seller, ix));
    assert_eq!(token_amount(&world.svm, &world.seller_payment.pubkey()), 7);
    assert_eq!(load_deal(&world.svm, &keys.deal).status, DealStatus::Settled);
}

fn cancel_buyer(world: &World, keys: &DealKeys) -> Instruction {
    let accounts = blind_deal::accounts::CancelBuyer {
        buyer: to_anchor(&world.buyer.pubkey()),
        deal: to_anchor(&keys.deal),
        buyer_payment: to_anchor(&world.buyer_payment.pubkey()),
        payment_vault: to_anchor(&keys.payment_vault),
        payment_mint: to_anchor(&world.payment_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::CancelBuyer {}.data(),
    )
}

fn cancel_seller(world: &World, keys: &DealKeys) -> Instruction {
    let accounts = blind_deal::accounts::CancelSeller {
        seller: to_anchor(&world.seller.pubkey()),
        deal: to_anchor(&keys.deal),
        seller_asset: to_anchor(&world.seller_asset.pubkey()),
        asset_vault: to_anchor(&keys.asset_vault),
        asset_mint: to_anchor(&world.asset_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::CancelSeller {}.data(),
    )
}

fn cancel_mutual(world: &World, keys: &DealKeys) -> Instruction {
    let accounts = blind_deal::accounts::CancelMutual {
        buyer: to_anchor(&world.buyer.pubkey()),
        seller: to_anchor(&world.seller.pubkey()),
        deal: to_anchor(&keys.deal),
        buyer_payment: to_anchor(&world.buyer_payment.pubkey()),
        seller_payment: to_anchor(&world.seller_payment.pubkey()),
        buyer_asset: to_anchor(&world.buyer_asset.pubkey()),
        seller_asset: to_anchor(&world.seller_asset.pubkey()),
        payment_vault: to_anchor(&keys.payment_vault),
        asset_vault: to_anchor(&keys.asset_vault),
        payment_mint: to_anchor(&world.payment_mint.pubkey()),
        asset_mint: to_anchor(&world.asset_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::CancelMutual {}.data(),
    )
}

fn refund(world: &mut World, keys: &DealKeys, buyer_signs: bool) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let party = if buyer_signs { world.buyer.pubkey() } else { world.seller.pubkey() };
    let accounts = blind_deal::accounts::RefundExpired {
        party: to_anchor(&party),
        deal: to_anchor(&keys.deal),
        buyer_payment: to_anchor(&world.buyer_payment.pubkey()),
        seller_payment: to_anchor(&world.seller_payment.pubkey()),
        buyer_asset: to_anchor(&world.buyer_asset.pubkey()),
        seller_asset: to_anchor(&world.seller_asset.pubkey()),
        payment_vault: to_anchor(&keys.payment_vault),
        asset_vault: to_anchor(&keys.asset_vault),
        payment_mint: to_anchor(&world.payment_mint.pubkey()),
        asset_mint: to_anchor(&world.asset_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    let ix = anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::RefundExpired {}.data(),
    );
    if buyer_signs {
        send(&mut world.svm, &[ix], &world.buyer, &[])
    } else {
        send(&mut world.svm, &[ix], &world.seller, &[])
    }
}

fn close_ix(world: &World, keys: &DealKeys, initializer: &Address) -> Instruction {
    let accounts = blind_deal::accounts::CloseDeal {
        party: to_anchor(&world.buyer.pubkey()),
        deal: to_anchor(&keys.deal),
        initializer: to_anchor(initializer),
        payment_vault: to_anchor(&keys.payment_vault),
        asset_vault: to_anchor(&keys.asset_vault),
        payment_mint: to_anchor(&world.payment_mint.pubkey()),
        asset_mint: to_anchor(&world.asset_mint.pubkey()),
        token_program: to_anchor(&token_program()),
    };
    anchor_ix(
        program_id(),
        accounts.to_account_metas(None),
        blind_deal::instruction::CloseDeal {}.data(),
    )
}
