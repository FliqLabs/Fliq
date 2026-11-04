use crate::types::PayoutCaller;
use near_sdk::borsh::{from_slice, to_vec, BorshDeserialize, BorshSerialize};
use near_sdk::{env, AccountId};

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
        return Err("temporary policy allows only the payer to spend".to_string());
    }
    if env::storage_has_key(&pending_key(order_id)) {
        return Err("temporary policy already has a pending spend for this order".to_string());
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
    let value = to_vec(&pending)
        .unwrap_or_else(|_| env::panic_str("temporary pending spend cannot be encoded"));
    env::storage_write(&pending_key(order_id), &value);
}

/// TEMPORARY: removes a pending spend after a failed transfer.
pub fn release_pending(order_id: &str) {
    env::storage_remove(&pending_key(order_id));
}

/// TEMPORARY: removes a pending spend after a successful transfer.
pub fn settle_pending(order_id: &str) {
    let key = pending_key(order_id);
    let value = env::storage_read(&key)
        .unwrap_or_else(|| env::panic_str("temporary pending spend does not exist"));
    let _pending = from_slice::<PendingSpend>(&value)
        .unwrap_or_else(|_| env::panic_str("temporary pending spend is corrupt"));
    env::storage_remove(&key);
}
