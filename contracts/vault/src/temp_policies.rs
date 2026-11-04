use near_sdk::AccountId;

/// Temporary stand-in for Aria's policy implementation.
pub fn can_spend(_agent: &AccountId, _amount: u128) -> bool {
    true
}

pub fn policy_for(_public_key: &str) -> String {
    String::new()
}
