use near_sdk::borsh::BorshSerialize;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, BorshStorageKey, near};

pub const MAX_ORDER_TTL_NS: u64 = 3_600_000_000_000;

#[derive(BorshSerialize, BorshStorageKey)]
pub enum StorageKey {
    Orders,
    Receipts,
    PayoutsPending,
    UsedRefundTransactions,
}

#[near(serializers = [borsh, json])]
#[derive(Clone)]
pub struct Config {
    pub owner: AccountId,
    pub registration_account: AccountId,
    pub approved_usdc_token_contract: AccountId,
    pub max_order_ttl_ns: u64,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OrderState {
    Registered,
    Executed,
    Released,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Default, Debug, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct ReceiptRefs {
    pub provider: Option<String>,
    pub provider_order: Option<String>,
    pub bank_reference: Option<String>,
    pub refund_tx: Option<String>,
}

impl ReceiptRefs {
    pub fn merge_once(&mut self, next: Self) -> Result<bool, ()> {
        let mut changed = false;
        changed |= merge_field_once(&mut self.provider, next.provider)?;
        changed |= merge_field_once(&mut self.provider_order, next.provider_order)?;
        changed |= merge_field_once(&mut self.bank_reference, next.bank_reference)?;
        changed |= merge_field_once(&mut self.refund_tx, next.refund_tx)?;
        Ok(changed)
    }

    pub fn values(&self) -> impl Iterator<Item = &String> {
        [
            self.provider.as_ref(),
            self.provider_order.as_ref(),
            self.bank_reference.as_ref(),
            self.refund_tx.as_ref(),
        ]
        .into_iter()
        .flatten()
    }
}

fn merge_field_once(current: &mut Option<String>, next: Option<String>) -> Result<bool, ()> {
    let Some(next) = next else {
        return Ok(false);
    };
    match current {
        None => {
            *current = Some(next);
            Ok(true)
        }
        Some(value) if *value == next => Ok(false),
        Some(_) => Err(()),
    }
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct PayoutOrder {
    pub order_id: String,
    pub payer: AccountId,
    pub deposit_address: AccountId,
    pub amount: u128,
    pub expires_at_ns: u64,
    pub corridor: String,
    pub state: OrderState,
}

#[near(serializers = [borsh])]
#[derive(Clone, Default)]
pub struct ReceiptRecord {
    pub status: Option<String>,
    pub refs: ReceiptRefs,
    pub recredited_amount: u128,
}

#[near(serializers = [json])]
pub struct ReceiptView {
    pub order_id: String,
    pub payer: AccountId,
    pub deposit_address: AccountId,
    pub amount: U128,
    pub expires_at_ns: String,
    pub corridor: String,
    pub state: OrderState,
    pub status: Option<String>,
    pub refs: ReceiptRefs,
    pub recredited_amount: U128,
}

impl ReceiptView {
    pub fn from_records(order: PayoutOrder, receipt: ReceiptRecord) -> Self {
        Self {
            order_id: order.order_id,
            payer: order.payer,
            deposit_address: order.deposit_address,
            amount: U128(order.amount),
            expires_at_ns: order.expires_at_ns.to_string(),
            corridor: order.corridor,
            state: order.state,
            status: receipt.status,
            refs: receipt.refs,
            recredited_amount: U128(receipt.recredited_amount),
        }
    }
}
