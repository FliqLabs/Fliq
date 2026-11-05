use crate::types::BalanceView;
use near_sdk::borsh::{BorshDeserialize, BorshSerialize, from_slice, to_vec};
use near_sdk::{AccountId, env};

#[derive(BorshDeserialize, BorshSerialize)]
struct Reservation {
    payer: AccountId,
    amount: u128,
}

// TEMPORARY: derives a private storage key for an account balance.
fn account_key(prefix: &str, account: &AccountId) -> Vec<u8> {
    format!("fliq:temp:{prefix}:account:{account}").into_bytes()
}

// TEMPORARY: derives a private storage key for an order reservation.
fn reservation_key(order_id: &str) -> Vec<u8> {
    format!("fliq:temp:reservation:{order_id}").into_bytes()
}

// TEMPORARY: reads an amount from the stand-in ledger.
fn read_amount(key: &[u8]) -> u128 {
    match env::storage_read(key) {
        Some(value) => match from_slice::<u128>(&value) {
            Ok(amount) => amount,
            Err(_) => env::panic_str("temporary vault amount is corrupt"),
        },
        None => 0,
    }
}

// TEMPORARY: writes an amount to the stand-in ledger.
fn write_amount(key: &[u8], amount: u128) {
    let value = to_vec(&amount)
        .unwrap_or_else(|_| env::panic_str("temporary vault amount cannot be encoded"));
    env::storage_write(key, &value);
}

// TEMPORARY: reads one stand-in reservation.
fn read_reservation(order_id: &str) -> Reservation {
    let value = env::storage_read(&reservation_key(order_id))
        .unwrap_or_else(|| env::panic_str("temporary reservation does not exist"));
    from_slice(&value).unwrap_or_else(|_| env::panic_str("temporary reservation is corrupt"))
}

// TEMPORARY: removes one stand-in reservation.
fn remove_reservation(order_id: &str) {
    env::storage_remove(&reservation_key(order_id));
}

/// TEMPORARY: stands in for Dapper's available/reserved balance ledger.
pub fn reserve_for_order(order_id: &str, payer: &AccountId, amount: u128) {
    let reservation_key = reservation_key(order_id);
    if env::storage_has_key(&reservation_key) {
        env::panic_str("temporary vault reservation already exists");
    }
    let available_key = account_key("available", payer);
    let reserved_key = account_key("reserved", payer);
    let available = read_amount(&available_key);
    if available < amount {
        env::panic_str("temporary vault available balance is insufficient");
    }
    let reserved = read_amount(&reserved_key);
    let next_reserved = reserved
        .checked_add(amount)
        .unwrap_or_else(|| env::panic_str("temporary vault reserved balance overflow"));
    write_amount(&available_key, available - amount);
    write_amount(&reserved_key, next_reserved);
    let reservation = Reservation {
        payer: payer.clone(),
        amount,
    };
    let value = to_vec(&reservation)
        .unwrap_or_else(|_| env::panic_str("temporary reservation cannot be encoded"));
    env::storage_write(&reservation_key, &value);
}

/// TEMPORARY: removes a successful reservation permanently and is single-use.
pub fn commit_outflow(order_id: &str) {
    let reservation = read_reservation(order_id);
    let reserved_key = account_key("reserved", &reservation.payer);
    let reserved = read_amount(&reserved_key);
    if reserved < reservation.amount {
        env::panic_str("temporary vault reserved balance is insufficient");
    }
    write_amount(&reserved_key, reserved - reservation.amount);
    remove_reservation(order_id);
}

/// TEMPORARY: returns a failed reservation to available balance and is single-use.
pub fn release_reservation(order_id: &str) {
    let reservation = read_reservation(order_id);
    let available_key = account_key("available", &reservation.payer);
    let reserved_key = account_key("reserved", &reservation.payer);
    let available = read_amount(&available_key);
    let reserved = read_amount(&reserved_key);
    if reserved < reservation.amount {
        env::panic_str("temporary vault reserved balance is insufficient");
    }
    let next_available = available
        .checked_add(reservation.amount)
        .unwrap_or_else(|| env::panic_str("temporary vault available balance overflow"));
    write_amount(&available_key, next_available);
    write_amount(&reserved_key, reserved - reservation.amount);
    remove_reservation(order_id);
}

/// TEMPORARY: reports total, available, and reserved amounts as JSON-safe strings.
pub fn get_balance(account: &AccountId) -> BalanceView {
    let available = read_amount(&account_key("available", account));
    let reserved = read_amount(&account_key("reserved", account));
    let total = available
        .checked_add(reserved)
        .unwrap_or_else(|| env::panic_str("temporary vault balance overflow"));
    BalanceView {
        total: total.to_string(),
        available: available.to_string(),
        reserved: reserved.to_string(),
    }
}

/// TEMPORARY: test-only funding hook; real deposits belong to Dapper.
#[cfg(all(feature = "testing", debug_assertions))]
pub fn credit_for_testing(account: &AccountId, amount: u128) {
    let key = account_key("available", account);
    let available = read_amount(&key);
    let updated = available
        .checked_add(amount)
        .unwrap_or_else(|| env::panic_str("temporary vault available balance overflow"));
    write_amount(&key, updated);
}
