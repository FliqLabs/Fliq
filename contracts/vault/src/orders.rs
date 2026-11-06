use crate::Contract;
use crate::errors;
use crate::integration;
use crate::receipts::FliqEvent;
use crate::types::{
    Amount, BACKEND_STATUSES, PayoutCaller, PayoutOrder, Receipt, Timestamp, TransferState, now,
};
use near_sdk::json_types::U128;
use near_sdk::{AccountId, Gas, NearToken, Promise, env, require};

pub const MAX_ORDER_ID_LENGTH: usize = 64;
pub const MAX_CORRIDOR_LENGTH: usize = 32;
pub const ERR_EMPTY_ORDER_ID: &str = errors::INVALID_ORDER_ID;
pub const ERR_LONG_ORDER_ID: &str = errors::INVALID_ORDER_ID;
pub const ERR_ZERO_AMOUNT: &str = errors::INVALID_AMOUNT;
pub const ERR_EMPTY_CORRIDOR: &str = errors::INVALID_CORRIDOR;
pub const ERR_LONG_CORRIDOR: &str = errors::INVALID_CORRIDOR;
pub const ERR_BAD_DEPOSIT_ADDRESS: &str = errors::INVALID_ADDRESS;
pub const MAX_REFS_LENGTH: usize = 256;
pub const ERR_REFS_TOO_LONG: &str = errors::INVALID_REFS;
pub const ERR_REFS_FORMAT: &str = errors::INVALID_REFS;

const BACKFILLABLE_STATUSES: &[&str] = &[
    "awaiting_deposit",
    "deposit_seen",
    "routing",
    "with_provider",
    "paying_out",
    "settled",
    "refunding",
    "refunded",
];

fn status_successors(status: &str) -> &'static [&'static str] {
    match status {
        "created" => &["awaiting_deposit", "provider_timeout", "failed", "refused"],
        "provider_timeout" => &["awaiting_recon"],
        "awaiting_recon" => &["awaiting_deposit", "failed"],
        "awaiting_deposit" => &["deposit_seen", "expired", "not_received"],
        "deposit_seen" => &["routing", "with_provider"],
        "routing" => &["with_provider", "refunding"],
        "with_provider" => &["paying_out", "refunding"],
        "paying_out" => &["settled", "refunding"],
        "refunding" => &["refunded", "failed"],
        _ => &[],
    }
}

fn status_distance(from: &str, to: &str) -> Option<usize> {
    let mut queue = vec![(from.to_owned(), 0)];
    let mut visited = std::collections::BTreeSet::from([from.to_owned()]);
    while let Some((current, distance)) = queue.first().cloned() {
        queue.remove(0);
        if current == to {
            return Some(distance);
        }
        for next in status_successors(&current) {
            if visited.insert((*next).to_owned()) {
                queue.push(((*next).to_owned(), distance + 1));
            }
        }
    }
    None
}

pub fn validate_refs(refs: &str) {
    require!(refs.chars().count() <= MAX_REFS_LENGTH, ERR_REFS_TOO_LONG);
    require!(
        refs.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ':' | '/' | '.' | '_' | '-')
        }),
        ERR_REFS_FORMAT
    );
}

pub fn validate_status_transition(
    receipt: &Receipt,
    status: &str,
    refs: &str,
    transfer_state: &TransferState,
) -> Result<bool, String> {
    require!(BACKEND_STATUSES.contains(&status), errors::INVALID_STATUS);
    validate_refs(refs);
    if receipt.backend_status == status && receipt.refs == refs {
        return Ok(false);
    }
    if matches!(
        receipt.backend_status.as_str(),
        "settled" | "refunded" | "expired" | "failed" | "refused" | "not_received"
    ) {
        return Err(errors::STATUS_TERMINAL.to_string());
    }
    let distance = status_distance(&receipt.backend_status, status)
        .ok_or_else(|| errors::STATUS_BACKWARD.to_string())?;
    if distance > 1 && !BACKFILLABLE_STATUSES.contains(&status) {
        return Err(errors::STATUS_BACKWARD.to_string());
    }
    if matches!(status, "paying_out" | "settled") && *transfer_state != TransferState::Dispatched {
        return Err(errors::INVALID_STATE.to_string());
    }
    Ok(true)
}

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
        Err(errors::INVALID_STATE.to_string())
    }
}

pub fn is_expired(expiry: near_sdk::json_types::U64, current: Timestamp) -> bool {
    current >= expiry.0
}

pub fn set_status(contract: &mut Contract, order_id: String, status: String, refs: String) {
    require!(
        env::predecessor_account_id() == contract.config.registration_account,
        errors::REGISTRATION_ONLY
    );
    require!(order_exists(contract, &order_id), errors::ORDER_NOT_FOUND);
    let Some(order) = contract.orders.get(&order_id) else {
        env::panic_str(errors::ORDER_NOT_FOUND);
    };
    require!(
        order.transfer_state != TransferState::Released,
        errors::RELEASED_ORDER
    );
    let Some(mut receipt) = contract.receipts.get(&order_id) else {
        env::panic_str(errors::RECEIPT_NOT_FOUND);
    };
    let changed = match validate_status_transition(&receipt, &status, &refs, &order.transfer_state)
    {
        Ok(changed) => changed,
        Err(error) => env::panic_str(&error),
    };
    if !changed {
        return;
    }
    receipt.backend_status = status.clone();
    receipt.refs = refs.clone();
    receipt.last_updated = now().into();
    let last_updated = receipt.last_updated.0.to_string();
    contract.receipts.insert(&order_id, &receipt);
    FliqEvent::StatusSet {
        order_id,
        status,
        refs,
        last_updated,
    }
    .emit();
}

pub fn order_exists(contract: &Contract, order_id: &str) -> bool {
    contract.orders.contains_key(&order_id.to_string())
}

pub fn order_payer(contract: &Contract, order_id: &str) -> Option<AccountId> {
    contract
        .orders
        .get(&order_id.to_string())
        .map(|order| order.payer.clone())
}

pub fn order_amount(contract: &Contract, order_id: &str) -> Option<Amount> {
    contract
        .orders
        .get(&order_id.to_string())
        .map(|order| order.amount.0)
}

pub fn order_transfer_state(contract: &Contract, order_id: &str) -> Option<TransferState> {
    contract
        .orders
        .get(&order_id.to_string())
        .map(|order| order.transfer_state.clone())
}

pub fn payout(
    contract: &mut Contract,
    order_id: String,
    amount: U128,
    deposit_address: AccountId,
) -> Promise {
    let Some(mut order) = contract.orders.get(&order_id) else {
        env::panic_str(errors::ORDER_NOT_FOUND);
    };
    require!(
        order.transfer_state == TransferState::Registered,
        errors::INVALID_STATE
    );
    require!(amount == order.amount, errors::AMOUNT_MISMATCH);
    require!(
        deposit_address == order.deposit_address,
        errors::DESTINATION_MISMATCH
    );
    require!(
        !is_expired(order.expiry, crate::types::now()),
        errors::ORDER_EXPIRED
    );

    let caller = PayoutCaller {
        account_id: env::predecessor_account_id(),
    };
    if let Err(reason) = integration::evaluate_payout(
        &caller,
        &order.payer,
        &order.order_id,
        order.amount.0,
        &order.corridor,
    ) {
        env::panic_str(&reason);
    }
    integration::reserve_for_order(
        &mut contract.vault,
        &order.order_id,
        &order.payer,
        order.amount.0,
    );
    if let Err(error) = transition(&mut order, TransferState::Executing) {
        env::panic_str(&error);
    }
    order.executing_since = Some(now().into());
    contract.orders.insert(&order_id, &order);
    if let Some(mut receipt) = contract.receipts.get(&order_id) {
        receipt.order = order.clone();
        receipt.transfer_state = TransferState::Executing;
        receipt.last_updated = now().into();
        contract.receipts.insert(&order_id, &receipt);
    }

    let transfer_gas = Gas::from_tgas(30);
    let callback_gas = Gas::from_tgas(20);
    require!(
        env::prepaid_gas() >= Gas::from_tgas(50),
        errors::INSUFFICIENT_GAS
    );
    let transfer_args = near_sdk::serde_json::json!({
        "receiver_id": order.deposit_address,
        "amount": order.amount,
        "memo": order.order_id,
    });
    let callback_args = near_sdk::serde_json::json!({ "order_id": order_id });
    Promise::new(contract.config.approved_usdc_token_contract.clone())
        .function_call(
            "ft_transfer".to_string(),
            near_sdk::serde_json::to_vec(&transfer_args)
                .unwrap_or_else(|_| env::panic_str(errors::TRANSFER_ENCODING)),
            NearToken::from_yoctonear(1),
            transfer_gas,
        )
        .then(
            Promise::new(env::current_account_id()).function_call(
                "on_payout_complete".to_string(),
                near_sdk::serde_json::to_vec(&callback_args)
                    .unwrap_or_else(|_| env::panic_str(errors::CALLBACK_ENCODING)),
                NearToken::from_yoctonear(0),
                callback_gas,
            ),
        )
}

pub fn recredit(
    contract: &mut Contract,
    order_id: String,
    amount: U128,
    actual_token_balance: U128,
) {
    require!(
        env::predecessor_account_id() == contract.config.registration_account,
        errors::REGISTRATION_ONLY
    );
    require!(order_exists(contract, &order_id), errors::ORDER_NOT_FOUND);
    require!(
        order_transfer_state(contract, &order_id) == Some(TransferState::Dispatched),
        errors::REFUND_NOT_ALLOWED
    );
    let status = contract
        .receipts
        .get(&order_id)
        .map(|receipt| receipt.backend_status)
        .unwrap_or_else(|| env::panic_str(errors::RECEIPT_NOT_FOUND));
    require!(
        matches!(status.as_str(), "refunding" | "refunded"),
        errors::INVALID_REFUND_STATUS
    );
    require!(
        order_payer(contract, &order_id).is_some() && order_amount(contract, &order_id).is_some(),
        errors::ORDER_DETAILS_MISSING
    );
    integration::recredit_refund(&mut contract.vault, &order_id, amount, actual_token_balance);
    if status == "refunding" {
        set_status(contract, order_id, "refunded".to_owned(), String::new());
    }
}

fn finalize_payout(contract: &mut Contract, order_id: String, successful: bool) -> bool {
    let Some(mut order) = contract.orders.get(&order_id) else {
        return false;
    };
    if order.transfer_state != TransferState::Executing {
        return false;
    }
    if successful {
        integration::commit_outflow(&mut contract.vault, &order_id);
        integration::settle_pending(&order_id);
        order.transfer_state = TransferState::Dispatched;
    } else {
        integration::release_reservation(&mut contract.vault, &order_id);
        integration::release_pending(&order_id);
        order.transfer_state = TransferState::TransferFailed;
    }
    order.executing_since = None;
    contract.orders.insert(&order_id, &order);
    if let Some(mut receipt) = contract.receipts.get(&order_id) {
        receipt.order = order.clone();
        receipt.transfer_state = order.transfer_state.clone();
        receipt.last_updated = crate::types::now().into();
        contract.receipts.insert(&order_id, &receipt);
    }
    FliqEvent::PayoutExecuted {
        order_id,
        transfer_state: order.transfer_state,
    }
    .emit();
    true
}

pub fn on_payout_complete(contract: &mut Contract, order_id: String) {
    let successful = env::promise_result_checked(0, 1024 * 1024).is_ok();
    finalize_payout(contract, order_id, successful);
}

pub fn resolve_stuck_payout(contract: &mut Contract, order_id: String, transferred: bool) {
    let Some(order) = contract.orders.get(&order_id) else {
        env::panic_str(errors::ORDER_NOT_FOUND);
    };
    require!(
        order.transfer_state == TransferState::Executing,
        errors::PAYOUT_NOT_EXECUTING
    );
    let Some(executing_since) = order.executing_since else {
        env::panic_str(errors::EXECUTING_SINCE_MISSING);
    };
    require!(
        now()
            >= executing_since
                .0
                .saturating_add(contract.config.payout_timeout.0),
        errors::TIMEOUT_NOT_REACHED
    );
    require!(
        finalize_payout(contract, order_id, transferred),
        errors::STUCK_PAYOUT_UNRESOLVED
    );
}
