use crate::models::ReceiptRefs;
use near_sdk::AccountId;

#[near_sdk::near(event_json(standard = "fliq_vault"))]
pub enum FliqVaultEvent {
    #[event_version("1.0.0")]
    OrderRegistered {
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: String,
        expires_at_ns: String,
        corridor: String,
    },
    #[event_version("1.0.0")]
    PayoutExecuted {
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: String,
        public_key: String,
    },
    #[event_version("1.0.0")]
    OrderReleased {
        order_id: String,
        payer: AccountId,
        amount: String,
    },
    #[event_version("1.0.0")]
    StatusSet {
        order_id: String,
        status: String,
        refs: ReceiptRefs,
    },
    #[event_version("1.0.0")]
    Transferred {
        from: AccountId,
        to: AccountId,
        amount: String,
    },
}
