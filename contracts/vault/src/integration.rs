use crate::temp_policies;
use crate::temp_vault;
use crate::types::{Amount, BalanceView, PayoutCaller};
use near_sdk::AccountId;

pub fn reserve_for_order(order_id: &str, payer: &AccountId, amount: Amount) {
    temp_vault::reserve_for_order(order_id, payer, amount);
    temp_policies::track_pending(order_id, payer, amount);
}

pub fn commit_outflow(order_id: &str) {
    temp_vault::commit_outflow(order_id);
}

pub fn release_reservation(order_id: &str) {
    temp_vault::release_reservation(order_id);
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

pub fn get_balance(account: &AccountId) -> BalanceView {
    temp_vault::get_balance(account)
}
