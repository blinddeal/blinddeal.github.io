use anchor_lang::prelude::*;
use anchor_spl::token::{self, CloseAccount, Mint, TokenAccount, TransferChecked};

use crate::state::Deal;
use crate::with_deal_signer;

pub fn transfer_from_user<'info>(
    from: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    token::transfer_checked(
        CpiContext::new(
            token::ID,
            TransferChecked {
                from,
                mint,
                to,
                authority,
            },
        ),
        amount,
        decimals,
    )
}

pub fn transfer_from_deal<'info>(
    deal: &Deal,
    from: AccountInfo<'info>,
    mint: AccountInfo<'info>,
    to: AccountInfo<'info>,
    authority: AccountInfo<'info>,
    amount: u64,
    decimals: u8,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    with_deal_signer(deal, |seeds| {
        token::transfer_checked(
            CpiContext::new_with_signer(
                token::ID,
                TransferChecked {
                    from: from.clone(),
                    mint: mint.clone(),
                    to: to.clone(),
                    authority: authority.clone(),
                },
                seeds,
            ),
            amount,
            decimals,
        )
    })
}

pub fn close_vault<'info>(
    deal: &Deal,
    account: AccountInfo<'info>,
    destination: AccountInfo<'info>,
    authority: AccountInfo<'info>,
) -> Result<()> {
    with_deal_signer(deal, |seeds| {
        token::close_account(CpiContext::new_with_signer(
            token::ID,
            CloseAccount {
                account: account.clone(),
                destination: destination.clone(),
                authority: authority.clone(),
            },
            seeds,
        ))
    })
}

pub fn require_open(deal: &Deal) -> Result<()> {
    require!(
        deal.status == crate::state::DealStatus::Open,
        crate::error::BlindError::NotOpen
    );
    Ok(())
}

pub fn require_party(deal: &Deal, signer: Pubkey) -> Result<()> {
    require!(
        signer == deal.buyer || signer == deal.seller,
        crate::error::BlindError::NotParty
    );
    Ok(())
}

pub struct PayLegs<'a, 'info> {
    pub payment_vault: &'a Account<'info, TokenAccount>,
    pub asset_vault: &'a Account<'info, TokenAccount>,
    pub payment_mint: &'a Account<'info, Mint>,
    pub asset_mint: &'a Account<'info, Mint>,
    pub buyer_payment: AccountInfo<'info>,
    pub seller_payment: AccountInfo<'info>,
    pub buyer_asset: AccountInfo<'info>,
    pub seller_asset: AccountInfo<'info>,
    pub deal_ai: AccountInfo<'info>,
}

pub fn settle_pots<'info>(
    deal: &Deal,
    legs: PayLegs<'_, 'info>,
    midpoint: Option<u64>,
    strict: bool,
) -> Result<()> {
    let payment_pot = legs.payment_vault.amount;
    let asset_pot = legs.asset_vault.amount;
    if strict {
        require!(
            payment_pot >= deal.buyer_deposit,
            crate::error::BlindError::PaymentShort
        );
        require!(
            asset_pot >= deal.asset_amount,
            crate::error::BlindError::AssetShort
        );
    }
    match midpoint {
        Some(price) => {
            require!(
                payment_pot >= price,
                crate::error::BlindError::PaymentShort
            );
            transfer_from_deal(
                deal,
                legs.payment_vault.to_account_info(),
                legs.payment_mint.to_account_info(),
                legs.seller_payment,
                legs.deal_ai.clone(),
                price,
                legs.payment_mint.decimals,
            )?;
            transfer_from_deal(
                deal,
                legs.payment_vault.to_account_info(),
                legs.payment_mint.to_account_info(),
                legs.buyer_payment,
                legs.deal_ai.clone(),
                payment_pot
                    .checked_sub(price)
                    .ok_or(crate::error::BlindError::PaymentShort)?,
                legs.payment_mint.decimals,
            )?;
            transfer_from_deal(
                deal,
                legs.asset_vault.to_account_info(),
                legs.asset_mint.to_account_info(),
                legs.buyer_asset,
                legs.deal_ai,
                asset_pot,
                legs.asset_mint.decimals,
            )?;
        }
        None => {
            transfer_from_deal(
                deal,
                legs.payment_vault.to_account_info(),
                legs.payment_mint.to_account_info(),
                legs.buyer_payment,
                legs.deal_ai.clone(),
                payment_pot,
                legs.payment_mint.decimals,
            )?;
            transfer_from_deal(
                deal,
                legs.asset_vault.to_account_info(),
                legs.asset_mint.to_account_info(),
                legs.seller_asset,
                legs.deal_ai,
                asset_pot,
                legs.asset_mint.decimals,
            )?;
        }
    }
    Ok(())
}
