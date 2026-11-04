use fliq_vault::orders::{transition, validate_order};
use fliq_vault::types::{PayoutOrder, TransferState};
use near_sdk::test_utils::accounts;

fn order(state: TransferState) -> PayoutOrder {
    PayoutOrder {
        order_id: "order".to_string(),
        payer: accounts(0),
        deposit_address: accounts(1),
        amount: 1,
        expiry: 1,
        corridor: "USDC-NGN".to_string(),
        transfer_state: state,
        created_at: 1,
    }
}

#[test]
fn every_valid_transition_passes() {
    let valid = [
        (TransferState::Registered, TransferState::Executing),
        (TransferState::Executing, TransferState::Dispatched),
        (TransferState::Executing, TransferState::TransferFailed),
    ];
    for (from, to) in valid {
        assert!(transition(&mut order(from), to).is_ok());
    }
}

#[test]
fn every_other_transition_fails() {
    let states = [
        TransferState::Registered,
        TransferState::Executing,
        TransferState::Dispatched,
        TransferState::TransferFailed,
    ];
    for from in states.iter().cloned() {
        for to in states.iter().cloned() {
            let valid = matches!(
                (&from, &to),
                (TransferState::Registered, TransferState::Executing)
                    | (TransferState::Executing, TransferState::Dispatched)
                    | (TransferState::Executing, TransferState::TransferFailed)
            );
            assert_eq!(transition(&mut order(from.clone()), to).is_ok(), valid);
        }
    }
}

#[test]
fn validation_rejects_empty_id() {
    assert!(std::panic::catch_unwind(|| validate_order("", 1, "corridor")).is_err());
}

#[test]
fn validation_rejects_long_id() {
    assert!(std::panic::catch_unwind(|| validate_order(&"x".repeat(65), 1, "corridor")).is_err());
}

#[test]
fn validation_rejects_zero_amount() {
    assert!(std::panic::catch_unwind(|| validate_order("order", 0, "corridor")).is_err());
}

#[test]
fn validation_rejects_empty_corridor() {
    assert!(std::panic::catch_unwind(|| validate_order("order", 1, "")).is_err());
}
