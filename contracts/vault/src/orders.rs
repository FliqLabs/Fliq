use crate::types::{Amount, PayoutOrder, Timestamp, TransferState};
use near_sdk::{env, require, AccountId};

pub const MAX_ORDER_ID_LENGTH: usize = 64;
pub const MAX_CORRIDOR_LENGTH: usize = 32;
pub const ERR_EMPTY_ORDER_ID: &str = "order_id must not be empty";
pub const ERR_LONG_ORDER_ID: &str = "order_id must be at most 64 characters";
pub const ERR_ZERO_AMOUNT: &str = "amount must be greater than zero";
pub const ERR_EMPTY_CORRIDOR: &str = "corridor must not be empty";
pub const ERR_LONG_CORRIDOR: &str = "corridor must be at most 32 characters";
pub const ERR_BAD_DEPOSIT_ADDRESS: &str = "deposit_address must be a well formed NEAR account ID";

pub fn validate_order(order_id: &str, amount: Amount, corridor: &str) {
    require!(!order_id.is_empty(), ERR_EMPTY_ORDER_ID);
    require!(
        order_id.chars().count() <= MAX_ORDER_ID_LENGTH,
        ERR_LONG_ORDER_ID
    );
    require!(amount > 0, ERR_ZERO_AMOUNT);
    require!(!corridor.is_empty(), ERR_EMPTY_CORRIDOR);
    require!(
        corridor.chars().count() <= MAX_CORRIDOR_LENGTH,
        ERR_LONG_CORRIDOR
    );
}

pub fn validate_deposit_address(value: &str) -> AccountId {
    match value.parse::<AccountId>() {
        Ok(account_id) => account_id,
        Err(_) => env::panic_str(ERR_BAD_DEPOSIT_ADDRESS),
    }
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
