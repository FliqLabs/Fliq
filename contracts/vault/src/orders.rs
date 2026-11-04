use crate::integration;
use crate::receipts::FliqEvent;
use crate::types::{Amount, PayoutCaller, PayoutOrder, Timestamp, TransferState};
use crate::Contract;
use near_sdk::json_types::U128;
use near_sdk::{env, require, AccountId, Gas, NearToken, Promise};

pub const MAX_ORDER_ID_LENGTH: usize = 64;
pub const MAX_CORRIDOR_LENGTH: usize = 32;
pub const ERR_EMPTY_ORDER_ID: &str = "order_id must not be empty";
pub const ERR_LONG_ORDER_ID: &str = "order_id must be at most 64 characters";
pub const ERR_ZERO_AMOUNT: &str = "amount must be greater than zero";
pub const ERR_EMPTY_CORRIDOR: &str = "corridor must not be empty";
pub const ERR_LONG_CORRIDOR: &str = "corridor must be at most 32 characters";
pub const ERR_BAD_DEPOSIT_ADDRESS: &str = "deposit_address must be a well formed NEAR account ID";

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
        Err(format!(
            "invalid transfer state transition from {:?} to {:?}",
            order.transfer_state, next
        ))
    }
}

pub fn is_expired(expiry: Timestamp, current: Timestamp) -> bool {
    current >= expiry
}

pub fn payout(contract: &mut Contract, order_id: String) -> Promise {
    let Some(mut order) = contract.orders.get(&order_id) else {
        env::panic_str("order_id is not registered");
    };
    require!(
        order.transfer_state == TransferState::Registered,
        "order is not in Registered state"
    );
    require!(
        !is_expired(order.expiry, crate::types::now()),
        "order has expired"
    );

    let caller = PayoutCaller {
        account_id: env::predecessor_account_id(),
    };
    if let Err(reason) = integration::evaluate_payout(
        &caller,
        &order.payer,
        &order.order_id,
        order.amount,
        &order.corridor,
    ) {
        env::panic_str(&reason);
    }
    integration::reserve_for_order(&order.order_id, &order.payer, order.amount);
    if let Err(error) = transition(&mut order, TransferState::Executing) {
        env::panic_str(&error);
    }
    contract.orders.insert(&order_id, &order);

    let transfer_gas = Gas::from_tgas(30);
    let callback_gas = Gas::from_tgas(20);
    require!(
        env::prepaid_gas() >= Gas::from_tgas(50),
        "prepaid gas is too low for the USDC transfer and callback"
    );
    let transfer_args = near_sdk::serde_json::json!({
        "receiver_id": order.deposit_address,
        "amount": U128(order.amount),
        "memo": order.order_id,
    });
    let callback_args = near_sdk::serde_json::json!({ "order_id": order_id });
    Promise::new(contract.config.approved_usdc_token_contract.clone())
        .function_call(
            "ft_transfer".to_string(),
            near_sdk::serde_json::to_vec(&transfer_args)
                .unwrap_or_else(|_| env::panic_str("could not encode USDC transfer arguments")),
            NearToken::from_yoctonear(1),
            transfer_gas,
        )
        .then(
            Promise::new(env::current_account_id()).function_call(
                "on_payout_complete".to_string(),
                near_sdk::serde_json::to_vec(&callback_args).unwrap_or_else(|_| {
                    env::panic_str("could not encode payout callback arguments")
                }),
                NearToken::from_yoctonear(0),
                callback_gas,
            ),
        )
}

pub fn on_payout_complete(contract: &mut Contract, order_id: String) {
    let Some(mut order) = contract.orders.get(&order_id) else {
        return;
    };
    if order.transfer_state != TransferState::Executing {
        return;
    }
    let successful = env::promise_result_checked(0, 1024 * 1024).is_ok();
    if successful {
        integration::commit_outflow(&order_id);
        integration::settle_pending(&order_id);
        order.transfer_state = TransferState::Dispatched;
    } else {
        integration::release_reservation(&order_id);
        integration::release_pending(&order_id);
        order.transfer_state = TransferState::TransferFailed;
    }
    contract.orders.insert(&order_id, &order);
    if let Some(mut receipt) = contract.receipts.get(&order_id) {
        receipt.transfer_state = order.transfer_state.clone();
        receipt.last_updated = crate::types::now();
        contract.receipts.insert(&order_id, &receipt);
    }
    FliqEvent::PayoutExecuted {
        order_id,
        transfer_state: order.transfer_state,
    }
    .emit();
}
