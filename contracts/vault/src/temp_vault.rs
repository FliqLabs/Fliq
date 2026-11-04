use near_sdk::{AccountId, Promise};

/// Temporary stand-in for Dapper's vault implementation.
pub fn create_transfer(_recipient: &AccountId, _amount: u128) -> Promise {
    Promise::new(near_sdk::env::current_account_id())
}

pub fn restore_funds(_account: &AccountId, _amount: u128) {}
