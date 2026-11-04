use crate::{temp_policies, temp_vault};
use near_sdk::require;
use near_sdk::{AccountId, Promise};

pub fn authorize_payout(agent: &AccountId, amount: u128) {
    require!(
        temp_policies::can_spend(agent, amount),
        "agent spending policy denied this payout"
    );
}

pub fn create_transfer(recipient: &AccountId, amount: u128) -> Promise {
    temp_vault::create_transfer(recipient, amount)
}

pub fn restore_funds(account: &AccountId, amount: u128) {
    temp_vault::restore_funds(account, amount);
}

pub fn get_policy(public_key: &str) -> String {
    temp_policies::policy_for(public_key)
}
