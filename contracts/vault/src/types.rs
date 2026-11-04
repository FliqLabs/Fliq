use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{AccountId, BorshStorageKey};

pub type Amount = u128;
pub type Timestamp = u64;

pub const DEFAULT_MAX_EXPIRY: Timestamp = 24 * 60 * 60 * 1_000_000_000;

// OPEN: expiry unit is not agreed; this currently follows NEAR block timestamp nanoseconds.
pub fn now() -> Timestamp {
    near_sdk::env::block_timestamp()
}

#[derive(BorshSerialize, BorshStorageKey)]
pub enum StorageKey {
    Orders,
    Receipts,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Config {
    pub owner: AccountId,
    pub registration_account: AccountId,
    pub approved_usdc_token_contract: AccountId,
    pub max_expiry: Timestamp,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BalanceView {
    pub total: String,
    pub available: String,
    pub reserved: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutCaller {
    pub account_id: AccountId,
    // OPEN: identity for relayed agent calls.
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub enum TransferState {
    Registered,
    Executing,
    Dispatched,
    TransferFailed,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutOrder {
    pub order_id: String,
    pub payer: AccountId,
    pub deposit_address: AccountId,
    pub amount: Amount,
    pub expiry: Timestamp,
    pub corridor: String,
    pub transfer_state: TransferState,
    pub created_at: Timestamp,
}

/// A receipt keeps the NEAR-verified transfer state visibly separate from backend reporting.
/// The backend status is not proof of bank settlement.
#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Receipt {
    pub order_id: String,
    pub order: PayoutOrder,
    pub transfer_state: TransferState,
    pub backend_status: String,
    pub refs: String,
    pub last_updated: Timestamp,
}

pub const BACKEND_STATUSES: &[&str] = &[
    "created",
    "awaiting_deposit",
    "deposit_seen",
    "routing",
    "with_provider",
    "paying_out",
    "settled",
    "refunding",
    "refunded",
    "provider_timeout",
    "awaiting_recon",
    "expired",
    "failed",
];
