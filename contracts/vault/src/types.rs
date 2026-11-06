use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::json_types::{U64, U128};
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{AccountId, BorshStorageKey};

pub type Amount = u128;
pub type Timestamp = u64;

pub const DEFAULT_MAX_EXPIRY: Timestamp = 24 * 60 * 60 * 1_000_000_000;
pub const DEFAULT_PAYOUT_TIMEOUT: Timestamp = 10 * 60 * 1_000_000_000;

// OPEN: expiry unit is not agreed; this currently follows NEAR block timestamp nanoseconds.
pub fn now() -> Timestamp {
    near_sdk::env::block_timestamp()
}

#[derive(BorshSerialize, BorshStorageKey)]
pub enum StorageKey {
    Orders,
    Receipts,
    UsedRefundTransactions,
    PayoutKeys,
}

#[derive(
    BorshDeserialize, BorshSerialize, Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize,
)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
pub struct ReceiptRefs {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider_order: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bank_reference: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refund_tx: Option<String>,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct Config {
    pub owner: AccountId,
    pub registration_account: AccountId,
    pub approved_usdc_token_contract: AccountId,
    pub max_expiry: U64,
    pub payout_timeout: U64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct BalanceView {
    pub total: U128,
    pub available: U128,
    pub reserved: U128,
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
    Released,
}

#[derive(BorshDeserialize, BorshSerialize, Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct PayoutOrder {
    pub order_id: String,
    pub payer: AccountId,
    pub deposit_address: AccountId,
    pub amount: U128,
    pub expiry: U64,
    pub corridor: String,
    pub transfer_state: TransferState,
    pub created_at: U64,
    pub executing_since: Option<U64>,
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
    pub refs: ReceiptRefs,
    pub last_updated: U64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ReceiptView {
    pub order_id: String,
    pub order: PayoutOrder,
    pub transfer_state: TransferState,
    pub expired: bool,
    pub executing_since: Option<U64>,
    pub backend_status: String,
    pub refs: ReceiptRefs,
    pub last_updated: U64,
}

pub const BACKEND_STATUSES: &[&str] = &[
    "created",
    "refused",
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
    "not_received",
    "failed",
];
