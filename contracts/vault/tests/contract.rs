use fliq_vault::orders::{transition, validate_deposit_address, validate_order};
use fliq_vault::types::{PayoutOrder, TransferState};
use fliq_vault::Contract;
use near_sdk::test_utils::{accounts, VMContextBuilder};
use near_sdk::{testing_env, AccountId};

const NOW: u64 = 1_000_000_000;

fn set_caller(account: AccountId, timestamp: u64) {
    testing_env!(VMContextBuilder::new()
        .predecessor_account_id(account)
        .block_timestamp(timestamp)
        .build());
}

fn contract() -> Contract {
    Contract::new(accounts(0), accounts(1), accounts(2))
}

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

#[test]
fn validation_rejects_long_corridor() {
    assert!(std::panic::catch_unwind(|| validate_order("order", 1, &"x".repeat(33))).is_err());
}

#[test]
fn validation_rejects_bad_deposit_address() {
    assert!(std::panic::catch_unwind(|| validate_deposit_address("not an account")).is_err());
}

#[test]
fn registration_account_can_register() {
    let mut contract = contract();
    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        10,
        NOW + 3_600_000_000_000,
        "USDC-NGN".to_string(),
    );
    let receipt = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt.order_id, "order-1");
    assert_eq!(receipt.transfer_state, TransferState::Registered);
}

#[test]
fn owner_can_change_registration_account() {
    let mut contract = contract();
    set_caller(accounts(0), NOW);
    contract.set_registration_account(accounts(5));
    assert_eq!(contract.get_config().registration_account, accounts(5));
}

#[test]
fn non_owner_cannot_change_registration_account() {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut contract = contract();
        set_caller(accounts(3), NOW);
        contract.set_registration_account(accounts(5));
    }));
    assert!(result.is_err());
}

#[test]
fn another_account_cannot_register() {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut contract = contract();
        set_caller(accounts(3), NOW);
        contract.register_order(
            "order-1".to_string(),
            accounts(3),
            accounts(4),
            10,
            NOW + 3_600_000_000_000,
            "USDC-NGN".to_string(),
        );
    }));
    assert!(result.is_err());
}

#[test]
fn duplicate_order_id_fails() {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut contract = contract();
        set_caller(accounts(1), NOW);
        let expiry = NOW + 3_600_000_000_000;
        contract.register_order(
            "order-1".to_string(),
            accounts(3),
            accounts(4),
            10,
            expiry,
            "USDC-NGN".to_string(),
        );
        contract.register_order(
            "order-1".to_string(),
            accounts(3),
            accounts(4),
            10,
            expiry,
            "USDC-NGN".to_string(),
        );
    }));
    assert!(result.is_err());
}

#[test]
fn invalid_registration_fields_fail() {
    let cases = [
        ("", 10, "USDC-NGN", NOW + 3_600_000_000_000),
        ("order-1", 0, "USDC-NGN", NOW + 3_600_000_000_000),
        ("order-1", 10, "", NOW + 3_600_000_000_000),
        ("order-1", 10, "USDC-NGN", NOW - 1),
        ("order-1", 10, "USDC-NGN", NOW + 86_400_000_000_001),
    ];
    for (order_id, amount, corridor, expiry) in cases {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let mut contract = contract();
            set_caller(accounts(1), NOW);
            contract.register_order(
                order_id.to_string(),
                accounts(3),
                accounts(4),
                amount,
                expiry,
                corridor.to_string(),
            );
        }));
        assert!(
            result.is_err(),
            "case should fail: {order_id}, {amount}, {corridor}, {expiry}"
        );
    }
}

#[test]
fn registered_order_fields_cannot_be_changed() {
    let mut contract = contract();
    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        10,
        NOW + 3_600_000_000_000,
        "USDC-NGN".to_string(),
    );
    let receipt_before = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt_before.transfer_state, TransferState::Registered);
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.register_order(
            "order-1".to_string(),
            accounts(5),
            accounts(6),
            20,
            NOW + 7_200_000_000_000,
            "USDC-KES".to_string(),
        );
    }))
    .is_err());
    let receipt_after = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt_after, receipt_before);
}

#[test]
fn unknown_receipt_fails_clearly() {
    let contract = contract();
    assert!(std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        contract.get_receipt("missing".to_string());
    }))
    .is_err());
}

#[test]
fn registration_event_contains_order_fields() {
    let mut contract = contract();
    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        10,
        NOW + 3_600_000_000_000,
        "USDC-NGN".to_string(),
    );
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs
        .iter()
        .any(|log| log.contains("order-1") && log.contains("USDC-NGN") && log.contains("10")));
}
