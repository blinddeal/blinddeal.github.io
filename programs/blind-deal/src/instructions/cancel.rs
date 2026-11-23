use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::BlindError;
use crate::state::{Deal, DealStatus};
use crate::{ASSET_SEED, DEAL_SEED, PAYMENT_SEED};

use super::shared::{require_open, settle_pots, transfer_from_deal, PayLegs};

fn finish_cancel(deal: &mut Deal) {
    deal.status = DealStatus::Cancelled;
    deal.buyer_locked = false;
    deal.seller_locked = false;
    deal.buyer_deposit = 0;
}

#[derive(Accounts)]
pub struct CancelBuyer<'info> {
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

pub fn handle_cancel_buyer(ctx: Context<CancelBuyer>) -> Result<()> {
    require_open(&ctx.accounts.deal)?;
    require!(!ctx.accounts.deal.seller_locked, BlindError::BothLocked);
    let snapshot = (*ctx.accounts.deal).clone();
    let pot = ctx.accounts.payment_vault.amount;
    finish_cancel(&mut ctx.accounts.deal);
    ctx.accounts.deal.exit(&crate::ID)?;
    transfer_from_deal(
        &snapshot,
        ctx.accounts.payment_vault.to_account_info(),
        ctx.accounts.payment_mint.to_account_info(),
        ctx.accounts.buyer_payment.to_account_info(),
        ctx.accounts.deal.to_account_info(),
        pot,
        ctx.accounts.payment_mint.decimals,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct CancelSeller<'info> {
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

pub fn handle_cancel_seller(ctx: Context<CancelSeller>) -> Result<()> {
    require_open(&ctx.accounts.deal)?;
    require!(!ctx.accounts.deal.buyer_locked, BlindError::BothLocked);
    let snapshot = (*ctx.accounts.deal).clone();
    let pot = ctx.accounts.asset_vault.amount;
    finish_cancel(&mut ctx.accounts.deal);
    ctx.accounts.deal.exit(&crate::ID)?;
    transfer_from_deal(
        &snapshot,
        ctx.accounts.asset_vault.to_account_info(),
        ctx.accounts.asset_mint.to_account_info(),
        ctx.accounts.seller_asset.to_account_info(),
        ctx.accounts.deal.to_account_info(),
        pot,
        ctx.accounts.asset_mint.decimals,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct CancelMutual<'info> {
    pub buyer: Signer<'info>,
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [DEAL_SEED, deal.buyer.as_ref(), deal.seller.as_ref(), &deal.id.to_le_bytes()],
        bump = deal.bump,
        has_one = buyer,
        has_one = seller,
        has_one = payment_mint,
        has_one = asset_mint
    )]
    pub deal: Box<Account<'info, Deal>>,
    #[account(mut, token::mint = payment_mint, token::authority = buyer, token::token_program = token_program)]
    pub buyer_payment: Account<'info, TokenAccount>,
    #[account(mut, token::mint = payment_mint, token::authority = seller, token::token_program = token_program)]
    pub seller_payment: Account<'info, TokenAccount>,
    #[account(mut, token::mint = asset_mint, token::authority = buyer, token::token_program = token_program)]
    pub buyer_asset: Account<'info, TokenAccount>,
    #[account(mut, token::mint = asset_mint, token::authority = seller, token::token_program = token_program)]
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

pub fn handle_cancel_mutual(ctx: Context<CancelMutual>) -> Result<()> {
    require_open(&ctx.accounts.deal)?;
    let snapshot = (*ctx.accounts.deal).clone();
    finish_cancel(&mut ctx.accounts.deal);
    ctx.accounts.deal.exit(&crate::ID)?;
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
        None,
        false,
    )?;
    Ok(())
}

#[derive(Accounts)]
pub struct RefundExpired<'info> {
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

pub fn handle_refund_expired(ctx: Context<RefundExpired>) -> Result<()> {
    super::shared::require_party(&ctx.accounts.deal, ctx.accounts.party.key())?;
    require_open(&ctx.accounts.deal)?;
    let now = Clock::get()?.unix_timestamp;
    require!(now >= ctx.accounts.deal.expiry_ts, BlindError::NotExpired);
    let snapshot = (*ctx.accounts.deal).clone();
    let deal = &mut ctx.accounts.deal;
    deal.status = DealStatus::Refunded;
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
        None,
        false,
    )?;
    Ok(())
}
