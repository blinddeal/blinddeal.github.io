pub mod error;
pub mod instructions;
pub mod rings;
pub mod state;

use anchor_lang::prelude::*;

pub use error::*;
pub use instructions::*;
pub use rings::*;
pub use state::*;

declare_id!("3EmcLYRjwELFoFwWfKgSJfycz1d75xXAXB3ChRHKgzYC");

pub const DEAL_SEED: &[u8] = b"deal";
pub const PAYMENT_SEED: &[u8] = b"payment";
pub const ASSET_SEED: &[u8] = b"asset";
pub const MAX_EXPIRY_WINDOW: i64 = 30 * 24 * 60 * 60;

#[program]
pub mod blind_deal {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        id: u64,
        asset_amount: u64,
        expiry_ts: i64,
    ) -> Result<()> {
        instructions::handle_initialize(ctx, id, asset_amount, expiry_ts)
    }

    pub fn lock_buyer(ctx: Context<LockBuyer>, commitment: [u8; 32], amount: u64) -> Result<()> {
        instructions::handle_lock_buyer(ctx, commitment, amount)
    }

    pub fn lock_seller(ctx: Context<LockSeller>, commitment: [u8; 32]) -> Result<()> {
        instructions::handle_lock_seller(ctx, commitment)
    }

    pub fn settle(
        ctx: Context<Settle>,
        buyer_price: u64,
        buyer_salt: [u8; 32],
        seller_price: u64,
        seller_salt: [u8; 32],
    ) -> Result<()> {
        instructions::handle_settle(ctx, buyer_price, buyer_salt, seller_price, seller_salt)
    }

    pub fn cancel_buyer(ctx: Context<CancelBuyer>) -> Result<()> {
        instructions::handle_cancel_buyer(ctx)
    }

    pub fn cancel_seller(ctx: Context<CancelSeller>) -> Result<()> {
        instructions::handle_cancel_seller(ctx)
    }

    pub fn cancel_mutual(ctx: Context<CancelMutual>) -> Result<()> {
        instructions::handle_cancel_mutual(ctx)
    }

    pub fn refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
        instructions::handle_refund_expired(ctx)
    }

    pub fn close_deal(ctx: Context<CloseDeal>) -> Result<()> {
        instructions::handle_close_deal(ctx)
    }
}

pub fn commitment(price: u64, salt: &[u8; 32]) -> [u8; 32] {
    solana_sha256_hasher::hashv(&[&price.to_le_bytes(), salt]).to_bytes()
}

pub fn midpoint(buyer_price: u64, seller_price: u64) -> u64 {
    ((buyer_price as u128 + seller_price as u128) / 2) as u64
}

pub fn with_deal_signer<T>(
    deal: &Deal,
    f: impl FnOnce(&[&[&[u8]]]) -> Result<T>,
) -> Result<T> {
    let id_bytes = deal.id.to_le_bytes();
    let bump = [deal.bump];
    let seeds: [&[u8]; 5] = [
        DEAL_SEED,
        deal.buyer.as_ref(),
        deal.seller.as_ref(),
        id_bytes.as_ref(),
        bump.as_ref(),
    ];
    f(&[&seeds])
}

#[cfg(test)]
mod host_tests {
    use super::*;
    use sha2::{Digest, Sha256};

    #[test]
    fn commitment_is_sha256_of_price_and_salt() {
        let price = 1_500u64;
        let salt = [0x11u8; 32];
        let mut hasher = Sha256::new();
        hasher.update(price.to_le_bytes());
        hasher.update(salt);
        let expected: [u8; 32] = hasher.finalize().into();
        assert_eq!(commitment(price, &salt), expected);
    }

    #[test]
    fn different_secrets_do_not_collide() {
        let salt = [7u8; 32];
        assert_ne!(commitment(10, &salt), commitment(11, &salt));
        assert_ne!(commitment(10, &salt), commitment(10, &[8u8; 32]));
    }

    #[test]
    fn midpoint_floors_and_survives_u64_max() {
        assert_eq!(midpoint(5, 2), 3);
        assert_eq!(midpoint(5, 5), 5);
        assert_eq!(midpoint(0, 0), 0);
        assert_eq!(midpoint(u64::MAX, u64::MAX), u64::MAX);
        assert_eq!(midpoint(u64::MAX, u64::MAX - 1), u64::MAX - 1);
    }
}
