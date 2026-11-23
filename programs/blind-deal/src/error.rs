use anchor_lang::prelude::*;

#[error_code]
pub enum BlindError {
    #[msg("Buyer and seller must be different wallets")]
    SameParty,
    #[msg("Expiry must be in the future")]
    ExpiryNotFuture,
    #[msg("Expiry is further out than 30 days")]
    ExpiryTooFar,
    #[msg("Deal is not open")]
    NotOpen,
    #[msg("Buyer already locked")]
    BuyerAlreadyLocked,
    #[msg("Seller already locked")]
    SellerAlreadyLocked,
    #[msg("Buyer has not locked")]
    BuyerNotLocked,
    #[msg("Seller has not locked")]
    SellerNotLocked,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Commitment is empty")]
    EmptyCommitment,
    #[msg("Revealed price does not match the commitment")]
    BadCommitment,
    #[msg("Deposit does not cover the revealed max")]
    DepositTooSmall,
    #[msg("Both sides are locked; use settle, mutual cancel, or wait for expiry")]
    BothLocked,
    #[msg("Deal has not expired")]
    NotExpired,
    #[msg("Deal has expired")]
    Expired,
    #[msg("Signer is not the buyer or the seller")]
    NotParty,
    #[msg("Vault still holds tokens")]
    VaultNotEmpty,
    #[msg("Deal is not finished")]
    NotFinished,
    #[msg("Privacy Rings comparison is not connected on this build")]
    RingsNotConnected,
    #[msg("Payment vault is short")]
    PaymentShort,
    #[msg("Asset vault is short")]
    AssetShort,
}
