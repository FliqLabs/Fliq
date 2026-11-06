use crate::temp_policies;
use crate::types::{Amount, PayoutCaller};
use crate::vault::{BalanceView, Vault};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, env};

pub fn reserve_for_order(vault: &mut Vault, order_id: &str, payer: &AccountId, amount: Amount) {
    if let Err(error) = vault.reserve_for_order(order_id, payer, amount) {
        env::panic_str(&format!("vault reservation failed: {error:?}"));
    }
    temp_policies::track_pending(order_id, payer, amount);
}

pub fn commit_outflow(vault: &mut Vault, order_id: &str) {
    if let Err(error) = vault.commit_outflow(order_id) {
        env::panic_str(&format!("vault outflow commit failed: {error:?}"));
    }
}

pub fn release_reservation(vault: &mut Vault, order_id: &str) {
    if let Err(error) = vault.release_reservation(order_id) {
        env::panic_str(&format!("vault reservation release failed: {error:?}"));
    }
}

pub fn evaluate_payout(
    caller: &PayoutCaller,
    payer: &AccountId,
    order_id: &str,
    amount: Amount,
    corridor: &str,
) -> Result<(), String> {
    temp_policies::evaluate_payout(caller, payer, order_id, amount, corridor)
}

pub fn release_pending(order_id: &str) {
    temp_policies::release_pending(order_id);
}

pub fn settle_pending(order_id: &str) {
    temp_policies::settle_pending(order_id);
}

pub fn recredit_refund(
    vault: &mut Vault,
    order_id: &str,
    amount: U128,
    actual_token_balance: U128,
) {
    if let Err(error) = vault.recredit_refund(order_id, amount.0, actual_token_balance.0) {
        env::panic_str(&format!("vault refund recredit failed: {error:?}"));
    }
}

pub fn get_balance(vault: &Vault, account: &AccountId) -> BalanceView {
    vault.balance_of(account).into()
}
