use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct Deal {
    pub buyer: Pubkey,
    pub seller: Pubkey,
    pub initializer: Pubkey,
    pub payment_mint: Pubkey,
    pub asset_mint: Pubkey,
    pub asset_amount: u64,
    pub buyer_deposit: u64,
    pub buyer_commitment: [u8; 32],
    pub seller_commitment: [u8; 32],
    pub expiry_ts: i64,
    pub created_ts: i64,
    pub status: DealStatus,
    pub id: u64,
    pub bump: u8,
    pub payment_vault_bump: u8,
    pub asset_vault_bump: u8,
    pub buyer_locked: bool,
    pub seller_locked: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, InitSpace, Debug)]
pub enum DealStatus {
    Open,
    Settled,
    Refunded,
    Cancelled,
}

impl Deal {
    pub fn is_terminal(&self) -> bool {
        self.status != DealStatus::Open
    }
}
