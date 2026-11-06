use crate::types::ReceiptRefs;
use near_sdk::AccountId;
use near_sdk::json_types::U128;

pub enum FliqEvent {
    OrderRegistered {
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: U128,
        expires_at_ns: String,
        corridor: String,
    },
    PayoutExecuted {
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: U128,
        public_key: String,
    },
    StatusSet {
        order_id: String,
        status: String,
        refs: ReceiptRefs,
    },
    OrderReleased {
        order_id: String,
        payer: AccountId,
        amount: U128,
    },
    Transferred {
        from: AccountId,
        to: AccountId,
        amount: U128,
    },
}

impl FliqEvent {
    pub fn emit(self) {
        let (event, data) = match self {
            Self::OrderRegistered {
                order_id,
                payer,
                deposit_address,
                amount,
                expires_at_ns,
                corridor,
            } => (
                "order_registered",
                near_sdk::serde_json::json!({
                    "order_id": order_id,
                    "payer": payer,
                    "deposit_address": deposit_address,
                    "amount": amount,
                    "expires_at_ns": expires_at_ns,
                    "corridor": corridor,
                }),
            ),
            Self::PayoutExecuted {
                order_id,
                payer,
                deposit_address,
                amount,
                public_key,
            } => (
                "payout_executed",
                near_sdk::serde_json::json!({
                    "order_id": order_id,
                    "payer": payer,
                    "deposit_address": deposit_address,
                    "amount": amount,
                    "public_key": public_key,
                }),
            ),
            Self::StatusSet {
                order_id,
                status,
                refs,
            } => (
                "status_set",
                near_sdk::serde_json::json!({
                    "order_id": order_id,
                    "status": status,
                    "refs": refs,
                }),
            ),
            Self::OrderReleased {
                order_id,
                payer,
                amount,
            } => (
                "order_released",
                near_sdk::serde_json::json!({
                    "order_id": order_id,
                    "payer": payer,
                    "amount": amount,
                }),
            ),
            Self::Transferred { from, to, amount } => (
                "transferred",
                near_sdk::serde_json::json!({
                    "from": from,
                    "to": to,
                    "amount": amount,
                }),
            ),
        };
        let envelope = near_sdk::serde_json::json!({
            "standard": "fliq_vault",
            "version": "1.0.0",
            "event": event,
            "data": [data],
        });
        near_sdk::env::log_str(&format!("EVENT_JSON:{envelope}"));
    }
}
