use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::BlindError;
use crate::rings::{ensure_clear_path, RingsCompareRequest};
use crate::state::{Deal, DealStatus};
use crate::{commitment, midpoint, ASSET_SEED, DEAL_SEED, PAYMENT_SEED};

use super::shared::{require_open, require_party, settle_pots, PayLegs};

#[derive(Accounts)]
pub struct Settle<'info> {
    pub party: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.buyer.as_ref(), deal.seller.as_ref(), &deal.id.to_le_bytes()],
        bump = deal.bump,
        has_one = payment_mint,
        has_one = asset_mint
    )]
    pub deal: Box<Account<'info, Deal>>,
    #[account(mut, token::mint = payment_mint, token::authority = deal.buyer, token::token_program = token_program)]
    pub buyer_payment: Account<'info, TokenAccount>,
    #[account(mut, token::mint = payment_mint, token::authority = deal.seller, token::token_program = token_program)]
    pub seller_payment: Account<'info, TokenAccount>,
    #[account(mut, token::mint = asset_mint, token::authority = deal.buyer, token::token_program = token_program)]
    pub buyer_asset: Account<'info, TokenAccount>,
    #[account(mut, token::mint = asset_mint, token::authority = deal.seller, token::token_program = token_program)]
    pub seller_asset: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [PAYMENT_SEED, deal.key().as_ref()],
        bump = deal.payment_vault_bump,
        token::mint = payment_mint,
        token::authority = deal,
        token::token_program = token_program
    )]
    pub payment_vault: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [ASSET_SEED, deal.key().as_ref()],
        bump = deal.asset_vault_bump,
        token::mint = asset_mint,
        token::authority = deal,
        token::token_program = token_program
    )]
    pub asset_vault: Account<'info, TokenAccount>,
    pub payment_mint: Account<'info, Mint>,
    pub asset_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_settle(
    ctx: Context<Settle>,
    buyer_price: u64,
    buyer_salt: [u8; 32],
    seller_price: u64,
    seller_salt: [u8; 32],
) -> Result<()> {
    require_party(&ctx.accounts.deal, ctx.accounts.party.key())?;
    require_open(&ctx.accounts.deal)?;
    require!(ctx.accounts.deal.buyer_locked, BlindError::BuyerNotLocked);
    require!(ctx.accounts.deal.seller_locked, BlindError::SellerNotLocked);
    let now = Clock::get()?.unix_timestamp;
    require!(now < ctx.accounts.deal.expiry_ts, BlindError::Expired);
    require!(
        commitment(buyer_price, &buyer_salt) == ctx.accounts.deal.buyer_commitment,
        BlindError::BadCommitment
    );
    require!(
        commitment(seller_price, &seller_salt) == ctx.accounts.deal.seller_commitment,
        BlindError::BadCommitment
    );
    require!(
        ctx.accounts.deal.buyer_deposit >= buyer_price,
        BlindError::DepositTooSmall
    );
    ensure_clear_path(&RingsCompareRequest {
        buyer_commitment: ctx.accounts.deal.buyer_commitment,
        seller_commitment: ctx.accounts.deal.seller_commitment,
        ring_program: Pubkey::default(),
    })?;
    let snapshot = (*ctx.accounts.deal).clone();
    let overlap = buyer_price >= seller_price;
    let clearing = if overlap {
        Some(midpoint(buyer_price, seller_price))
    } else {
        None
    };
    let deal = &mut ctx.accounts.deal;
    deal.status = if overlap {
        DealStatus::Settled
    } else {
        DealStatus::Refunded
    };
    deal.buyer_locked = false;
    deal.seller_locked = false;
    deal.buyer_deposit = 0;
    deal.exit(&crate::ID)?;
    settle_pots(
        &snapshot,
        PayLegs {
            payment_vault: &ctx.accounts.payment_vault,
            asset_vault: &ctx.accounts.asset_vault,
            payment_mint: &ctx.accounts.payment_mint,
            asset_mint: &ctx.accounts.asset_mint,
            buyer_payment: ctx.accounts.buyer_payment.to_account_info(),
            seller_payment: ctx.accounts.seller_payment.to_account_info(),
            buyer_asset: ctx.accounts.buyer_asset.to_account_info(),
            seller_asset: ctx.accounts.seller_asset.to_account_info(),
            deal_ai: ctx.accounts.deal.to_account_info(),
        },
        clearing,
        true,
    )?;
    Ok(())
}
