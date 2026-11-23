use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::BlindError;
use crate::state::{Deal, DealStatus};
use crate::{ASSET_SEED, DEAL_SEED, MAX_EXPIRY_WINDOW, PAYMENT_SEED};

#[derive(Accounts)]
#[instruction(id: u64)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub buyer: Signer<'info>,
    /// CHECK: seller pubkey is stored and must sign later lock, settle, or cancel instructions
    pub seller: UncheckedAccount<'info>,
    pub payment_mint: Account<'info, Mint>,
    pub asset_mint: Account<'info, Mint>,
    #[account(
        init,
        payer = buyer,
        space = 8 + Deal::INIT_SPACE,
        seeds = [DEAL_SEED, buyer.key().as_ref(), seller.key().as_ref(), &id.to_le_bytes()],
        bump
    )]
    pub deal: Account<'info, Deal>,
    #[account(
        init,
        payer = buyer,
        token::mint = payment_mint,
        token::authority = deal,
        token::token_program = token_program,
        seeds = [PAYMENT_SEED, deal.key().as_ref()],
        bump
    )]
    pub payment_vault: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = buyer,
        token::mint = asset_mint,
        token::authority = deal,
        token::token_program = token_program,
        seeds = [ASSET_SEED, deal.key().as_ref()],
        bump
    )]
    pub asset_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_initialize(
    ctx: Context<Initialize>,
    id: u64,
    asset_amount: u64,
    expiry_ts: i64,
) -> Result<()> {
    require_keys_neq!(
        ctx.accounts.buyer.key(),
        ctx.accounts.seller.key(),
        BlindError::SameParty
    );
    require!(asset_amount > 0, BlindError::ZeroAmount);
    let now = Clock::get()?.unix_timestamp;
    require!(expiry_ts > now, BlindError::ExpiryNotFuture);
    require!(
        expiry_ts <= now.saturating_add(MAX_EXPIRY_WINDOW),
        BlindError::ExpiryTooFar
    );
    let deal = &mut ctx.accounts.deal;
    deal.buyer = ctx.accounts.buyer.key();
    deal.seller = ctx.accounts.seller.key();
    deal.initializer = ctx.accounts.buyer.key();
    deal.payment_mint = ctx.accounts.payment_mint.key();
    deal.asset_mint = ctx.accounts.asset_mint.key();
    deal.asset_amount = asset_amount;
    deal.buyer_deposit = 0;
    deal.buyer_commitment = [0u8; 32];
    deal.seller_commitment = [0u8; 32];
    deal.expiry_ts = expiry_ts;
    deal.created_ts = now;
    deal.status = DealStatus::Open;
    deal.id = id;
    deal.bump = ctx.bumps.deal;
    deal.payment_vault_bump = ctx.bumps.payment_vault;
    deal.asset_vault_bump = ctx.bumps.asset_vault;
    deal.buyer_locked = false;
    deal.seller_locked = false;
    Ok(())
}
