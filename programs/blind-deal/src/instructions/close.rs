use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::error::BlindError;
use crate::state::Deal;
use crate::{ASSET_SEED, DEAL_SEED, PAYMENT_SEED};

use super::shared::{close_vault, require_party};

#[derive(Accounts)]
pub struct CloseDeal<'info> {
    pub party: Signer<'info>,
    #[account(
        mut,
        close = initializer,
        seeds = [DEAL_SEED, deal.buyer.as_ref(), deal.seller.as_ref(), &deal.id.to_le_bytes()],
        bump = deal.bump
    )]
    pub deal: Account<'info, Deal>,
    #[account(mut, constraint = initializer.key() == deal.initializer @ BlindError::NotParty)]
    pub initializer: SystemAccount<'info>,
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

pub fn handle_close_deal(ctx: Context<CloseDeal>) -> Result<()> {
    require_party(&ctx.accounts.deal, ctx.accounts.party.key())?;
    require!(ctx.accounts.deal.is_terminal(), BlindError::NotFinished);
    require!(
        ctx.accounts.payment_vault.amount == 0 && ctx.accounts.asset_vault.amount == 0,
        BlindError::VaultNotEmpty
    );
    let snapshot = (*ctx.accounts.deal).clone();
    close_vault(
        &snapshot,
        ctx.accounts.payment_vault.to_account_info(),
        ctx.accounts.initializer.to_account_info(),
        ctx.accounts.deal.to_account_info(),
    )?;
    close_vault(
        &snapshot,
        ctx.accounts.asset_vault.to_account_info(),
        ctx.accounts.initializer.to_account_info(),
        ctx.accounts.deal.to_account_info(),
    )?;
    Ok(())
}
