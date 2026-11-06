use crate::errors;
use crate::types::PayoutCaller;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize, from_slice, to_vec};
use near_sdk::{AccountId, env};

#[derive(BorshDeserialize, BorshSerialize)]
struct PendingSpend {
    payer: AccountId,
    amount: u128,
}

// TEMPORARY: derives a private storage key for pending policy spend.
fn pending_key(order_id: &str) -> Vec<u8> {
    format!("fliq:temp:pending:{order_id}").into_bytes()
}

/// TEMPORARY: checks the payer-only policy before a vault reservation.
pub fn evaluate_payout(
    caller: &PayoutCaller,
    payer: &AccountId,
    order_id: &str,
    amount: u128,
    _corridor: &str,
) -> Result<(), String> {
    if caller.account_id != *payer {
        return Err(errors::TEMP_POLICY_DENIED.to_string());
    }
    if env::storage_has_key(&pending_key(order_id)) {
        return Err(errors::TEMP_PENDING_EXISTS.to_string());
    }
    let _ = amount;
    Ok(())
}

/// TEMPORARY: records pending spend only after the vault reservation succeeds.
pub fn track_pending(order_id: &str, payer: &AccountId, amount: u128) {
    let pending = PendingSpend {
        payer: payer.clone(),
        amount,
    };
    let value = match to_vec(&pending) {
        Ok(value) => value,
        Err(_) => env::panic_str(errors::TEMP_PENDING_CORRUPT),
    };
    env::storage_write(&pending_key(order_id), &value);
}

/// TEMPORARY: removes a pending spend after a failed transfer.
pub fn release_pending(order_id: &str) {
    env::storage_remove(&pending_key(order_id));
}

/// TEMPORARY: removes a pending spend after a successful transfer.
pub fn settle_pending(order_id: &str) {
    let key = pending_key(order_id);
    let value =
        env::storage_read(&key).unwrap_or_else(|| env::panic_str(errors::TEMP_PENDING_MISSING));
    let _pending = match from_slice::<PendingSpend>(&value) {
        Ok(pending) => pending,
        Err(_) => env::panic_str(errors::TEMP_PENDING_CORRUPT),
    };
    env::storage_remove(&key);
}
