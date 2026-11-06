use crate::types::TransferState;
use near_sdk::json_types::U128;

#[allow(dead_code)]
#[near_sdk::near(event_json(standard = "fliq_vault"))]
pub enum FliqEvent {
    #[event_version("1.0.0")]
    OrderRegistered {
        order_id: String,
        amount: U128,
        expiry: String,
        corridor: String,
    },
    #[event_version("1.0.0")]
    PayoutExecuted {
        order_id: String,
        transfer_state: TransferState,
    },
    #[event_version("1.0.0")]
    StatusSet {
        order_id: String,
        status: String,
        refs: String,
        last_updated: String,
    },
    #[event_version("1.0.0")]
    Recredited { order_id: String, amount: U128 },
    #[event_version("1.0.0")]
    OrderReleased { order_id: String },
}

// OPEN: event payload fields need backend approval; these payloads contain no personal data.
