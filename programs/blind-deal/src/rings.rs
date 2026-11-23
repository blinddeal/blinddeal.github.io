use anchor_lang::prelude::*;

use crate::error::BlindError;

pub struct RingsCompareRequest {
    pub buyer_commitment: [u8; 32],
    pub seller_commitment: [u8; 32],
    pub ring_program: Pubkey,
}

pub fn private_compare(request: &RingsCompareRequest) -> Option<bool> {
    let _ = request;
    None
}

pub fn ensure_clear_path(request: &RingsCompareRequest) -> Result<()> {
    if private_compare(request).is_some() {
        return err!(BlindError::RingsNotConnected);
    }
    Ok(())
}
