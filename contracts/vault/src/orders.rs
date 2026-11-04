use crate::types::{Amount, PayoutOrder, Timestamp, TransferState};
use near_sdk::require;

pub const MAX_ORDER_ID_LENGTH: usize = 64;

pub fn validate_order(order_id: &str, amount: Amount, corridor: &str) {
    require!(!order_id.is_empty(), "order_id must not be empty");
    require!(
        order_id.chars().count() <= MAX_ORDER_ID_LENGTH,
        "order_id must be at most 64 characters"
    );
    require!(amount > 0, "amount must be greater than zero");
    require!(!corridor.is_empty(), "corridor must not be empty");
}

pub fn transition(order: &mut PayoutOrder, next: TransferState) -> Result<(), String> {
    let allowed = matches!(
        (&order.transfer_state, &next),
        (TransferState::Registered, TransferState::Executing)
            | (TransferState::Executing, TransferState::Dispatched)
            | (TransferState::Executing, TransferState::TransferFailed)
    );
    if allowed {
        order.transfer_state = next;
        Ok(())
    } else {
        Err(format!(
            "invalid transfer state transition from {:?} to {:?}",
            order.transfer_state, next
        ))
    }
}

pub fn is_expired(expiry: Timestamp, current: Timestamp) -> bool {
    current > expiry
}
