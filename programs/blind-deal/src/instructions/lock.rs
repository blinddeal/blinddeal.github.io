use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::BlindError;
use crate::state::Deal;
use crate::{ASSET_SEED, DEAL_SEED, PAYMENT_SEED};

use super::shared::{require_open, transfer_from_user};

#[derive(Accounts)]
pub struct LockBuyer<'info> {
    pub buyer: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.buyer.as_ref(), deal.seller.as_ref(), &deal.id.to_le_bytes()],
        bump = deal.bump,
        has_one = buyer,
        has_one = payment_mint
    )]
    pub deal: Account<'info, Deal>,
    #[account(mut, token::mint = payment_mint, token::authority = buyer, token::token_program = token_program)]
    pub buyer_payment: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [PAYMENT_SEED, deal.key().as_ref()],
        bump = deal.payment_vault_bump,
        token::mint = payment_mint,
        token::authority = deal,
        token::token_program = token_program
    )]
    pub payment_vault: Account<'info, TokenAccount>,
    pub payment_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_lock_buyer(ctx: Context<LockBuyer>, commitment: [u8; 32], amount: u64) -> Result<()> {
    require_open(&ctx.accounts.deal)?;
    require!(!ctx.accounts.deal.buyer_locked, BlindError::BuyerAlreadyLocked);
    require!(amount > 0, BlindError::ZeroAmount);
    require!(commitment != [0u8; 32], BlindError::EmptyCommitment);
    let before = ctx.accounts.payment_vault.amount;
    transfer_from_user(
        ctx.accounts.buyer_payment.to_account_info(),
        ctx.accounts.payment_mint.to_account_info(),
        ctx.accounts.payment_vault.to_account_info(),
        ctx.accounts.buyer.to_account_info(),
        amount,
        ctx.accounts.payment_mint.decimals,
    )?;
    ctx.accounts.payment_vault.reload()?;
    require!(
        ctx.accounts.payment_vault.amount == before.saturating_add(amount),
        BlindError::PaymentShort
    );
    let deal = &mut ctx.accounts.deal;
    deal.buyer_deposit = amount;
    deal.buyer_commitment = commitment;
    deal.buyer_locked = true;
    Ok(())
}

#[derive(Accounts)]
pub struct LockSeller<'info> {
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.buyer.as_ref(), deal.seller.as_ref(), &deal.id.to_le_bytes()],
        bump = deal.bump,
        has_one = seller,
        has_one = asset_mint
    )]
    pub deal: Account<'info, Deal>,
    #[account(mut, token::mint = asset_mint, token::authority = seller, token::token_program = token_program)]
    pub seller_asset: Account<'info, TokenAccount>,
    #[account(
        mut,
        seeds = [ASSET_SEED, deal.key().as_ref()],
        bump = deal.asset_vault_bump,
        token::mint = asset_mint,
        token::authority = deal,
        token::token_program = token_program
    )]
    pub asset_vault: Account<'info, TokenAccount>,
    pub asset_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
}

pub fn handle_lock_seller(ctx: Context<LockSeller>, commitment: [u8; 32]) -> Result<()> {
    require_open(&ctx.accounts.deal)?;
    require!(!ctx.accounts.deal.seller_locked, BlindError::SellerAlreadyLocked);
    require!(commitment != [0u8; 32], BlindError::EmptyCommitment);
    let amount = ctx.accounts.deal.asset_amount;
    let before = ctx.accounts.asset_vault.amount;
    transfer_from_user(
        ctx.accounts.seller_asset.to_account_info(),
        ctx.accounts.asset_mint.to_account_info(),
        ctx.accounts.asset_vault.to_account_info(),
        ctx.accounts.seller.to_account_info(),
        amount,
        ctx.accounts.asset_mint.decimals,
    )?;
    ctx.accounts.asset_vault.reload()?;
    require!(
        ctx.accounts.asset_vault.amount == before.saturating_add(amount),
        BlindError::AssetShort
    );
    let deal = &mut ctx.accounts.deal;
    deal.seller_commitment = commitment;
    deal.seller_locked = true;
    Ok(())
}
