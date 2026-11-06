use crate::errors;
use crate::temp_policies;
use crate::types::{Amount, PayoutCaller};
use crate::vault::{BalanceView, RefundError, ReservationError, Vault};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, env};

pub fn reserve_for_order(vault: &mut Vault, order_id: &str, payer: &AccountId, amount: Amount) {
    if let Err(error) = vault.reserve_for_order(order_id, payer, amount) {
        match error {
            ReservationError::AlreadyExists => env::panic_str(errors::ORDER_EXISTS),
            ReservationError::AmountMustBePositive => env::panic_str(errors::INVALID_AMOUNT),
            ReservationError::InsufficientBalance => env::panic_str(errors::INSUFFICIENT_BALANCE),
            ReservationError::ArithmeticOverflow | ReservationError::NotFound => {
                env::panic_str(errors::VAULT_RESERVATION_FAILED)
            }
        }
    }
}

pub fn track_pending(order_id: &str, payer: &AccountId, amount: Amount) {
    temp_policies::track_pending(order_id, payer, amount);
}

pub fn commit_outflow(vault: &mut Vault, order_id: &str) {
    if let Err(error) = vault.commit_outflow(order_id) {
        let _ = error;
        env::panic_str(errors::VAULT_COMMIT_FAILED);
    }
}

pub fn release_reservation(vault: &mut Vault, order_id: &str) {
    if let Err(error) = vault.release_reservation(order_id) {
        let _ = error;
        env::panic_str(errors::VAULT_RELEASE_FAILED);
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
        match error {
            RefundError::AlreadyRecredited => env::panic_str(errors::ALREADY_RECREDITED),
            RefundError::AmountMustBePositive => env::panic_str(errors::INVALID_AMOUNT),
            RefundError::ExceedsOutflow => env::panic_str(errors::RECREDIT_EXCEEDS_ORDER),
            RefundError::ExceedsUnallocatedBalance | RefundError::Underbacked => {
                env::panic_str(errors::RECREDIT_EXCEEDS_UNATTRIBUTED)
            }
            RefundError::NotFound | RefundError::PayerNotRegistered => {
                env::panic_str(errors::REFUND_NOT_ALLOWED)
            }
            RefundError::ArithmeticOverflow => env::panic_str(errors::VAULT_REFUND_FAILED),
        }
    }
}

pub fn get_balance(vault: &Vault, account: &AccountId) -> BalanceView {
    vault.balance_of(account).into()
}
