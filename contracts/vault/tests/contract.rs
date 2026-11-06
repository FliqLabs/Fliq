use fliq_vault::Contract;
use fliq_vault::orders::{
    order_amount, order_exists, order_payer, order_transfer_state, transition,
    validate_deposit_address, validate_order,
};
use fliq_vault::types::{PayoutOrder, PolicyAction, ReceiptRefs, TransferState};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::env;
use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::{VMContextBuilder, accounts};
use near_sdk::{AccountId, testing_env};
#[cfg(feature = "testing")]
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config};

const NOW: u64 = 1_000_000_000;

fn set_caller(account: AccountId, timestamp: u64) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(account)
            .block_timestamp(timestamp)
            .build()
    );
}

fn set_caller_with_deposit(account: AccountId, timestamp: u64, deposit: u128) {
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(account)
            .attached_deposit(near_sdk::NearToken::from_yoctonear(deposit))
            .block_timestamp(timestamp)
            .build()
    );
}

fn refs(value: &str) -> ReceiptRefs {
    ReceiptRefs {
        provider_order: Some(value.to_owned()),
        ..ReceiptRefs::default()
    }
}

#[cfg(feature = "testing")]
fn refund_refs(value: &str) -> ReceiptRefs {
    ReceiptRefs {
        refund_tx: Some(value.to_owned()),
        ..ReceiptRefs::default()
    }
}

#[cfg(feature = "testing")]
fn set_promise_result(context: near_sdk::VMContext, result: PromiseResult) {
    testing_env!(
        context,
        test_vm_config(),
        RuntimeFeesConfig::test(),
        Default::default(),
        vec![result]
    );
}

fn contract() -> Contract {
    set_caller(accounts(0), NOW);
    let mut contract = Contract::new(accounts(0), accounts(1), accounts(2));
    let minimum = contract.storage_balance_bounds().min;
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3))
            .attached_deposit(minimum)
            .block_timestamp(NOW)
            .build()
    );
    contract.storage_deposit(None, Some(true));
    assert_eq!(minimum, contract.storage_balance_bounds().min);
    contract
}

fn fund(contract: &mut Contract, account: AccountId, amount: u128) {
    set_caller(accounts(2), NOW);
    let result = contract.ft_on_transfer(account, U128(amount), String::new());
    assert!(matches!(result, near_sdk::PromiseOrValue::Value(U128(0))));
}

fn register_storage(contract: &mut Contract, account: AccountId) {
    let minimum = contract.storage_balance_bounds().min;
    set_caller_with_deposit(account, NOW, minimum.as_yoctonear());
    contract.storage_deposit(None, Some(true));
}

#[cfg(feature = "testing")]
fn payout(contract: &mut Contract, order_id: &str) -> near_sdk::Promise {
    let order = contract.get_receipt(order_id.to_owned()).order;
    contract.payout(order_id.to_owned(), order.amount, order.deposit_address)
}

#[test]
fn contract_account_can_initialize_contract() {
    set_caller(accounts(0), NOW);
    let contract = Contract::new(accounts(0), accounts(1), accounts(2));

    assert_eq!(contract.get_config().owner, accounts(0));
}

#[test]
fn owner_can_create_update_and_read_agent_policy() {
    let mut contract = contract();
    set_caller(accounts(3), NOW);
    contract.set_agent_policy(
        accounts(5),
        U128(50),
        U128(200),
        vec!["USDC-NGN".to_string()],
        U64(60_000_000_000),
        U64(NOW + 3_600_000_000_000),
    );

    let policy = contract
        .get_policy(accounts(5))
        .unwrap_or_else(|| panic!("agent policy was not stored"));
    assert_eq!(policy.owner, accounts(3));
    assert_eq!(policy.allowed_action, PolicyAction::Payout);
    assert_eq!(policy.max_per_payout, U128(50));
    assert_eq!(policy.daily_limit, U128(200));
    assert_eq!(policy.spent_today, U128(0));
    assert_eq!(policy.allowed_corridors, vec!["USDC-NGN"]);
    assert!(!policy.revoked);

    contract.set_agent_policy(
        accounts(5),
        U128(25),
        U128(100),
        vec!["USDC-KES".to_string(), "USDC-NGN".to_string()],
        U64(0),
        U64(NOW + 7_200_000_000_000),
    );
    let updated = contract
        .get_policy(accounts(5))
        .unwrap_or_else(|| panic!("updated policy was not stored"));
    assert_eq!(updated.max_per_payout, U128(25));
    assert_eq!(updated.allowed_corridors, vec!["USDC-KES", "USDC-NGN"]);
}

#[test]
fn only_policy_owner_can_change_or_revoke_agent() {
    let mut contract = contract();
    set_caller(accounts(3), NOW);
    contract.set_agent_policy(
        accounts(5),
        U128(50),
        U128(200),
        vec!["USDC-NGN".to_string()],
        U64(0),
        U64(NOW + 3_600_000_000_000),
    );

    set_caller(accounts(4), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.revoke_agent(accounts(5));
        }))
        .is_err()
    );
    set_caller(accounts(3), NOW);
    contract.revoke_agent(accounts(5));
    assert!(
        contract
            .get_policy(accounts(5))
            .unwrap_or_else(|| panic!("agent policy was not stored"))
            .revoked
    );
}

#[test]
fn invalid_agent_policy_is_rejected() {
    let mut contract = contract();
    set_caller(accounts(3), NOW);
    for (agent, per_payout, daily, corridors, expiry) in [
        (accounts(3), 10, 20, vec!["USDC-NGN".to_string()], NOW + 1),
        (accounts(5), 0, 20, vec!["USDC-NGN".to_string()], NOW + 1),
        (accounts(5), 30, 20, vec!["USDC-NGN".to_string()], NOW + 1),
        (accounts(5), 10, 20, Vec::new(), NOW + 1),
        (accounts(5), 10, 20, vec!["USDC-NGN".to_string()], NOW),
    ] {
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.set_agent_policy(
                    agent,
                    U128(per_payout),
                    U128(daily),
                    corridors,
                    U64(0),
                    U64(expiry),
                );
            }))
            .is_err()
        );
    }
}

#[test]
fn initialization_cannot_run_twice() {
    set_caller(accounts(0), NOW);
    let contract = Contract::new(accounts(0), accounts(1), accounts(2));
    env::state_write(&contract);

    let result = std::panic::catch_unwind(|| {
        Contract::new(accounts(0), accounts(1), accounts(2));
    });

    assert!(result.is_err());
}

#[test]
fn different_predecessor_cannot_initialize_contract() {
    set_caller(accounts(3), NOW);

    let result = std::panic::catch_unwind(|| {
        Contract::new(accounts(0), accounts(1), accounts(2));
    });

    assert!(result.is_err());
}

fn register_status_order(contract: &mut Contract) {
    fund(contract, accounts(3), 10);
    register_named_order(contract, "order-1", accounts(3), 10);
}

fn register_named_order(contract: &mut Contract, order_id: &str, payer: AccountId, amount: u128) {
    set_caller(accounts(1), NOW);
    contract.register_order(
        order_id.to_string(),
        payer,
        accounts(4),
        U128(amount),
        U64(NOW + 3_600_000_000_000),
        "USDC-NGN".to_string(),
    );
}

#[cfg(feature = "testing")]
fn register_payout_order(contract: &mut Contract, amount: u128, expiry: u64) {
    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        U128(amount),
        U64(expiry),
        "USDC-NGN".to_string(),
    );
}

fn order(state: TransferState) -> PayoutOrder {
    PayoutOrder {
        order_id: "order".to_string(),
        payer: accounts(0),
        deposit_address: accounts(1),
        amount: U128(1),
        expiry: U64(1),
        corridor: "USDC-NGN".to_string(),
        transfer_state: state,
        created_at: U64(1),
        executing_since: None,
    }
}

#[test]
fn every_valid_transition_passes() {
    let valid = [
        (TransferState::Registered, TransferState::Executing),
        (TransferState::Executing, TransferState::Dispatched),
        (TransferState::Executing, TransferState::Registered),
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
    for from in states.iter() {
        for to in states.iter().cloned() {
            let valid = matches!(
                (&from, &to),
                (TransferState::Registered, TransferState::Executing)
                    | (TransferState::Executing, TransferState::Dispatched)
                    | (TransferState::Executing, TransferState::Registered)
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
    fund(&mut contract, accounts(3), 10);
    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        U128(10),
        U64(NOW + 3_600_000_000_000),
        "USDC-NGN".to_string(),
    );
    let receipt = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt.order_id, "order-1");
    assert_eq!(receipt.transfer_state, TransferState::Registered);
}

#[test]
fn registration_account_can_release_registered_order_and_restore_balance() {
    let mut contract = contract();
    fund(&mut contract, accounts(3), 10);
    register_named_order(&mut contract, "release-1", accounts(3), 10);
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
    set_caller(accounts(1), NOW);
    contract.release_order("release-1".to_owned());
    assert_eq!(contract.get_balance(accounts(3)).available, U128(10));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
    assert_eq!(
        contract.get_receipt("release-1".to_owned()).transfer_state,
        TransferState::Released
    );
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|log| log.contains("order_released") && log.contains("release-1"))
    );
}

#[test]
fn storage_usage_reports_order_and_receipt_delta() {
    let mut contract = contract();
    fund(&mut contract, accounts(3), 10);
    let before = contract.get_storage_usage();
    register_named_order(&mut contract, "storage-1", accounts(3), 10);
    let after = contract.get_storage_usage();
    let delta = after - before;
    println!(
        "ORDER_RECEIPT_BYTES={delta} STORAGE_BYTE_COST_YOCTONEAR={}",
        env::storage_byte_cost().as_yoctonear()
    );
    assert!(delta > 0);
}

#[test]
fn unauthorized_release_fails_and_released_order_cannot_be_reused() {
    let mut contract = contract();
    fund(&mut contract, accounts(3), 10);
    register_named_order(&mut contract, "release-2", accounts(3), 10);
    set_caller(accounts(5), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.release_order("release-2".to_owned());
        }))
        .is_err()
    );
    set_caller(accounts(0), NOW);
    contract.release_order("release-2".to_owned());
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.release_order("release-2".to_owned());
        }))
        .is_err()
    );
    set_caller(accounts(3), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let receipt = contract.get_receipt("release-2".to_owned());
            let _ = contract.payout(
                "release-2".to_owned(),
                receipt.order.amount,
                receipt.order.deposit_address,
            );
        }))
        .is_err()
    );
    set_caller(accounts(1), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.register_order(
                "release-2".to_owned(),
                accounts(3),
                accounts(4),
                U128(10),
                U64(NOW + 3_600_000_000_000),
                "USDC-NGN".to_owned(),
            );
        }))
        .is_err()
    );
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
            U128(10),
            U64(NOW + 3_600_000_000_000),
            "USDC-NGN".to_string(),
        );
    }));
    assert!(result.is_err());
}

#[test]
fn duplicate_order_id_fails() {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut contract = contract();
        fund(&mut contract, accounts(3), 20);
        set_caller(accounts(1), NOW);
        let expiry = NOW + 3_600_000_000_000;
        contract.register_order(
            "order-1".to_string(),
            accounts(3),
            accounts(4),
            U128(10),
            U64(expiry),
            "USDC-NGN".to_string(),
        );
        contract.register_order(
            "order-1".to_string(),
            accounts(3),
            accounts(4),
            U128(10),
            U64(expiry),
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
                U128(amount),
                U64(expiry),
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
    fund(&mut contract, accounts(3), 10);
    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        U128(10),
        U64(NOW + 3_600_000_000_000),
        "USDC-NGN".to_string(),
    );
    let receipt_before = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt_before.transfer_state, TransferState::Registered);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.register_order(
                "order-1".to_string(),
                accounts(5),
                accounts(6),
                U128(20),
                U64(NOW + 7_200_000_000_000),
                "USDC-KES".to_string(),
            );
        }))
        .is_err()
    );
    let receipt_after = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt_after, receipt_before);
}

#[test]
fn unknown_receipt_fails_clearly() {
    let contract = contract();
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.get_receipt("missing".to_string());
        }))
        .is_err()
    );
}

#[test]
fn registration_event_contains_order_fields() {
    let mut contract = contract();
    fund(&mut contract, accounts(3), 10);
    set_caller(accounts(1), NOW);
    let json_amount: U128 = near_sdk::serde_json::from_str("\"10\"").unwrap();
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        json_amount,
        U64(NOW + 3_600_000_000_000),
        "USDC-NGN".to_string(),
    );
    let receipt = contract.get_receipt("order-1".to_string());
    assert_eq!(
        near_sdk::serde_json::to_string(&receipt.order.amount).unwrap(),
        "\"10\""
    );
    let logs = near_sdk::test_utils::get_logs();
    assert!(logs.iter().any(|log| log.contains("order-1")
        && log.contains("USDC-NGN")
        && log.contains("\"amount\":\"10\"")));
}

#[test]
fn status_rejects_non_registration_caller() {
    let mut contract = contract();
    register_status_order(&mut contract);
    set_caller(accounts(5), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
        }))
        .is_err()
    );
}

#[test]
fn status_rejects_unknown_order_and_status() {
    let mut contract = contract();
    set_caller(accounts(1), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_status("missing".to_string(), "routing".to_string(), refs("ref-1"));
        }))
        .is_err()
    );
    register_status_order(&mut contract);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_status(
                "order-1".to_string(),
                "not_a_status".to_string(),
                refs("ref-1"),
            );
        }))
        .is_err()
    );
}

#[test]
fn status_follows_branching_edges_for_refused_and_not_received() {
    let mut refused = contract();
    register_status_order(&mut refused);
    set_caller(accounts(1), NOW);
    refused.set_status("order-1".to_string(), "refused".to_string(), refs("ref-1"));
    assert_eq!(
        refused.get_receipt("order-1".to_string()).backend_status,
        "refused"
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            refused.set_status("order-1".to_string(), "failed".to_string(), refs("ref-2"));
        }))
        .is_err()
    );

    let mut not_received = contract();
    fund(&mut not_received, accounts(3), 10);
    register_named_order(&mut not_received, "order-2", accounts(3), 10);
    set_caller(accounts(1), NOW);
    not_received.set_status(
        "order-2".to_string(),
        "awaiting_deposit".to_string(),
        refs("ref-1"),
    );
    not_received.set_status(
        "order-2".to_string(),
        "not_received".to_string(),
        refs("ref-1"),
    );
    assert_eq!(
        not_received
            .get_receipt("order-2".to_string())
            .backend_status,
        "not_received"
    );
}

#[test]
fn status_rejects_illegal_branch_transition() {
    let mut contract = contract();
    register_status_order(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status(
        "order-1".to_string(),
        "awaiting_deposit".to_string(),
        refs("ref-1"),
    );
    contract.set_status("order-1".to_string(), "expired".to_string(), refs("ref-1"));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-3"));
        }))
        .is_err()
    );
}

#[test]
fn status_replay_is_a_no_op() {
    let mut contract = contract();
    register_status_order(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    let before = contract.get_receipt("order-1".to_string());
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    assert_eq!(contract.get_receipt("order-1".to_string()), before);
}

#[test]
fn earlier_status_is_rejected() {
    let mut contract = contract();
    register_status_order(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_status(
                "order-1".to_string(),
                "deposit_seen".to_string(),
                refs("ref-1"),
            );
        }))
        .is_err()
    );
}

#[test]
fn paying_out_and_settled_require_dispatched_transfer_state() {
    let mut contract = contract();
    register_status_order(&mut contract);
    set_caller(accounts(1), NOW);
    for status in ["paying_out", "settled"] {
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.set_status("order-1".to_string(), status.to_string(), refs("ref-1"));
            }))
            .is_err()
        );
    }
}

#[test]
fn receipt_shows_order_and_both_status_tracks() {
    let mut contract = contract();
    register_status_order(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    let receipt = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt.order.amount, U128(10));
    assert_eq!(receipt.order.deposit_address, accounts(4));
    assert_eq!(receipt.transfer_state, TransferState::Registered);
    assert_eq!(receipt.order.transfer_state, TransferState::Registered);
    assert_eq!(receipt.backend_status, "routing");
    assert_eq!(receipt.refs, refs("ref-1"));
}

#[test]
fn status_does_not_change_transfer_state_or_balance() {
    let mut contract = contract();
    register_status_order(&mut contract);
    let before_balance = contract.get_balance(accounts(3));
    set_caller(accounts(1), NOW);
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    let receipt = contract.get_receipt("order-1".to_string());
    let after_balance = contract.get_balance(accounts(3));
    assert_eq!(receipt.transfer_state, TransferState::Registered);
    assert_eq!(before_balance, after_balance);
}

#[test]
fn status_event_has_reporting_fields_without_personal_data() {
    let mut contract = contract();
    register_status_order(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    let logs = near_sdk::test_utils::get_logs();
    let event = logs
        .iter()
        .find(|log| log.contains("\"event\":\"status_set\""));
    assert!(event.is_some());
    let event = match event {
        Some(value) => value.clone(),
        None => panic!("status_set event was not emitted"),
    };
    assert!(event.contains("order-1"));
    assert!(event.contains("routing"));
    assert!(event.contains("ref-1"));
    assert!(event.contains("\"data\":[{"));
    assert!(!event.contains("null"));
    assert!(!event.contains(&accounts(3).to_string()));
    assert!(!event.contains(&accounts(4).to_string()));
}

#[test]
fn order_helpers_are_read_only_views() {
    let mut contract = contract();
    register_status_order(&mut contract);
    assert!(order_exists(&contract, "order-1"));
    assert_eq!(order_payer(&contract, "order-1"), Some(accounts(3)));
    assert_eq!(order_amount(&contract, "order-1"), Some(10));
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Registered)
    );
    assert!(!order_exists(&contract, "missing"));
}

#[cfg(feature = "testing")]
#[test]
fn two_orders_cannot_reserve_more_than_the_balance() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 10);
    register_named_order(&mut contract, "order-1", accounts(3), 6);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            register_named_order(&mut contract, "order-2", accounts(3), 6);
        }))
        .is_err()
    );
    set_caller(accounts(3), NOW);
    let _first = payout(&mut contract, "order-1");
    let balance = contract.get_balance(accounts(3));
    assert_eq!(balance.available, U128(4));
    assert_eq!(balance.reserved, U128(6));
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        near_sdk::PromiseResult::Failed,
    );
    contract.on_payout_complete("order-1".to_string());
    assert_eq!(contract.get_balance(accounts(3)).available, U128(4));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(6));
    set_caller(accounts(1), NOW);
    contract.release_order("order-1".to_string());
    assert_eq!(contract.get_balance(accounts(3)).available, U128(10));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
}

#[cfg(feature = "testing")]
#[test]
fn amount_edges_and_overflow_are_safe() {
    let mut one_contract = contract();
    one_contract.credit_for_testing(accounts(3), 1);
    register_named_order(&mut one_contract, "one-unit", accounts(3), 1);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut one_contract, "one-unit");
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        near_sdk::PromiseResult::Successful(vec![]),
    );
    one_contract.on_payout_complete("one-unit".to_string());
    assert_eq!(one_contract.get_balance(accounts(3)).total, U128(0));

    let mut max_contract = contract();
    max_contract.credit_for_testing(accounts(3), u128::MAX);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            max_contract.credit_for_testing(accounts(3), 1);
        }))
        .is_err()
    );
    register_named_order(&mut max_contract, "max-unit", accounts(3), u128::MAX);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut max_contract, "max-unit");
    assert_eq!(
        max_contract.get_balance(accounts(3)).reserved,
        U128(u128::MAX)
    );
}

#[cfg(feature = "testing")]
#[test]
fn payout_keeps_stored_destination_and_amount() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 10);
    register_named_order(&mut contract, "order-1", accounts(3), 10);
    let before = contract.get_receipt("order-1".to_string()).order;
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    let during = contract.get_receipt("order-1".to_string()).order;
    assert_eq!(during.amount, before.amount);
    assert_eq!(during.deposit_address, before.deposit_address);
    assert_eq!(during.order_id, before.order_id);
}

#[cfg(feature = "testing")]
#[test]
fn payout_rejects_wrong_amount_without_changing_reservation() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = contract.payout("order-1".to_string(), U128(11), accounts(4));
    }));

    assert!(result.is_err());
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Registered)
    );
}

#[cfg(feature = "testing")]
#[test]
fn payout_rejects_wrong_address_without_changing_reservation() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);

    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = contract.payout("order-1".to_string(), U128(10), accounts(5));
    }));

    assert!(result.is_err());
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Registered)
    );
}

#[cfg(feature = "testing")]
#[test]
fn matching_payout_arguments_pass() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);

    let json_amount: U128 = near_sdk::serde_json::from_str("\"10\"").unwrap();
    let _promise = contract.payout("order-1".to_string(), json_amount, accounts(4));

    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Executing)
    );
}

#[cfg(feature = "testing")]
fn complete_successful_payout(contract: &mut Contract) {
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(contract, "order-1");
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        PromiseResult::Successful(vec![]),
    );
    contract.on_payout_complete("order-1".to_string());
}

#[cfg(feature = "testing")]
fn complete_recredit(
    contract: &mut Contract,
    order_id: &str,
    amount: u128,
    actual_token_balance: u128,
) {
    set_caller(accounts(1), NOW);
    let _promise = contract.recredit(order_id.to_owned(), U128(amount));
    set_caller(accounts(0), NOW);
    assert!(contract.on_recredit_balance(
        order_id.to_owned(),
        U128(amount),
        Ok(U128(actual_token_balance)),
    ));
}

#[cfg(feature = "testing")]
#[test]
fn real_payout_then_refund_recredits_once_and_marks_refunded() {
    let mut contract = contract();
    complete_successful_payout(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status(
        "order-1".to_string(),
        "refunding".to_string(),
        refund_refs("refund-tx"),
    );
    complete_recredit(&mut contract, "order-1", 10, 100);

    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(3)).total, U128(100));
    assert_eq!(
        contract.get_receipt("order-1".to_string()).backend_status,
        "refunded"
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("order-1".to_string(), U128(10));
        }))
        .is_err()
    );
}

#[cfg(feature = "testing")]
#[test]
fn refund_transaction_cannot_back_two_orders() {
    let mut contract = contract();
    complete_successful_payout(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status(
        "order-1".to_string(),
        "refunding".to_string(),
        refund_refs("shared-refund"),
    );
    complete_recredit(&mut contract, "order-1", 10, 100);

    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-2".to_string(),
        accounts(3),
        accounts(4),
        U128(10),
        U64(NOW + 3_600_000_000_000),
        "USDC-NGN".to_string(),
    );
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-2");
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        PromiseResult::Successful(vec![]),
    );
    contract.on_payout_complete("order-2".to_string());
    set_caller(accounts(1), NOW);
    contract.set_status(
        "order-2".to_string(),
        "refunding".to_string(),
        refund_refs("shared-refund"),
    );

    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("order-2".to_string(), U128(10));
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
}

#[test]
fn transfer_requires_one_yocto_and_moves_only_available_balance() {
    let mut contract = contract();
    register_storage(&mut contract, accounts(4));
    fund(&mut contract, accounts(3), 100);

    set_caller(accounts(3), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.transfer(accounts(4), U128(25));
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(4)).available, U128(0));

    set_caller_with_deposit(accounts(3), NOW, 1);
    contract.transfer(accounts(4), U128(25));
    assert_eq!(contract.get_balance(accounts(3)).available, U128(75));
    assert_eq!(contract.get_balance(accounts(4)).available, U128(25));
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|log| log.contains("\"event\":\"transferred\"") && log.contains("\"data\":[{"))
    );
}

#[cfg(feature = "testing")]
#[test]
fn refund_for_unknown_order_fails() {
    let mut contract = contract();
    set_caller(accounts(1), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("missing".to_string(), U128(1));
        }))
        .is_err()
    );
}

#[cfg(feature = "testing")]
#[test]
fn refund_larger_than_order_amount_fails_without_credit() {
    let mut contract = contract();
    complete_successful_payout(&mut contract);
    set_caller(accounts(1), NOW);
    contract.set_status(
        "order-1".to_string(),
        "refunding".to_string(),
        refund_refs("refund-tx"),
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("order-1".to_string(), U128(11));
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
}

#[cfg(feature = "testing")]
#[test]
fn refund_for_non_dispatched_order_fails() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(1), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("order-1".to_string(), U128(10));
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
}

#[cfg(feature = "testing")]
#[test]
fn unrelated_balance_cannot_be_credited_to_an_order() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    set_caller(accounts(1), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("unknown".to_string(), U128(10));
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
}

#[cfg(feature = "testing")]
#[test]
fn failed_transfer_and_stuck_resolution_restore_once_without_refund() {
    let mut contract = contract();
    set_caller(accounts(0), NOW);
    contract.set_payout_timeout(U64(10));
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_caller(accounts(0), NOW + 10);
    contract.resolve_stuck_payout("order-1".to_string(), false);
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
    set_caller(accounts(1), NOW + 10);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("order-1".to_string(), U128(10));
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
}

#[cfg(feature = "testing")]
#[test]
fn payout_timeout_is_owner_configurable() {
    let mut contract = contract();
    assert_eq!(contract.get_config().payout_timeout, U64(600_000_000_000));
    set_caller(accounts(3), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_payout_timeout(U64(1));
        }))
        .is_err()
    );
    set_caller(accounts(0), NOW);
    contract.set_payout_timeout(U64(1));
    assert_eq!(contract.get_config().payout_timeout, U64(1));
}

#[cfg(feature = "testing")]
#[test]
fn stuck_payout_requires_owner_timeout_and_executing_state() {
    let mut contract = contract();
    set_caller(accounts(0), NOW);
    contract.set_payout_timeout(U64(10));
    set_caller(accounts(1), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.resolve_stuck_payout("missing".to_string(), false);
        }))
        .is_err()
    );

    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_caller(accounts(0), NOW + 9);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.resolve_stuck_payout("order-1".to_string(), false);
        }))
        .is_err()
    );
    set_caller(accounts(0), NOW + 10);
    contract.resolve_stuck_payout("order-1".to_string(), false);
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Registered)
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
}

#[cfg(feature = "testing")]
#[test]
fn stuck_payout_transferred_commits_and_is_single_use() {
    let mut contract = contract();
    set_caller(accounts(0), NOW);
    contract.set_payout_timeout(U64(10));
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_caller(accounts(0), NOW + 10);
    contract.resolve_stuck_payout("order-1".to_string(), true);
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Dispatched)
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));

    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.resolve_stuck_payout("order-1".to_string(), true);
        }))
        .is_err()
    );

    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW + 10)
            .build(),
        PromiseResult::Successful(vec![]),
    );
    contract.on_payout_complete("order-1".to_string());
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Dispatched)
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
}

#[cfg(feature = "testing")]
#[test]
fn random_sequence_preserves_balance_and_single_send_invariants() {
    use std::collections::HashSet;

    let mut contract = contract();
    let payer = accounts(3);
    let mut credited = 500_u128;
    let mut seed = 0x5eed_u64;
    let mut next_order = 0_u64;
    let mut order_ids = Vec::new();
    let mut sent = HashSet::new();
    contract.credit_for_testing(payer.clone(), credited);

    for _step in 0..120 {
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
        match seed % 5 {
            0 => {
                let amount = u128::from((seed % 30) + 1);
                contract.credit_for_testing(payer.clone(), amount);
                credited += amount;
            }
            1 => {
                let order_id = format!("random-{next_order}");
                next_order += 1;
                let amount = u128::from((seed % 40) + 1);
                register_named_order(&mut contract, &order_id, payer.clone(), amount);
                order_ids.push(order_id);
            }
            2 if !order_ids.is_empty() => {
                let index = (seed as usize) % order_ids.len();
                let order_id = order_ids[index].clone();
                let receipt = contract.get_receipt(order_id.clone());
                if order_transfer_state(&contract, &order_id) == Some(TransferState::Registered) {
                    let amount = receipt.order.amount.0;
                    let available = contract.get_balance(payer.clone()).available.0;
                    set_caller(payer.clone(), NOW);
                    let payout_result =
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                            payout(&mut contract, &order_id)
                        }));
                    if available >= amount {
                        assert!(payout_result.is_ok());
                        let succeeded = seed.is_multiple_of(2);
                        set_promise_result(
                            VMContextBuilder::new()
                                .current_account_id(accounts(0))
                                .predecessor_account_id(accounts(0))
                                .block_timestamp(NOW)
                                .build(),
                            if succeeded {
                                near_sdk::PromiseResult::Successful(vec![])
                            } else {
                                near_sdk::PromiseResult::Failed
                            },
                        );
                        contract.on_payout_complete(order_id.clone());
                        if succeeded {
                            credited -= amount;
                            assert!(sent.insert(order_id));
                        }
                    } else {
                        assert!(payout_result.is_err());
                    }
                }
            }
            3 if !order_ids.is_empty() => {
                let index = (seed as usize) % order_ids.len();
                let order_id = order_ids[index].clone();
                set_caller(accounts(1), NOW);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    contract.set_status(order_id, "routing".to_string(), refs("random-ref"));
                }));
            }
            4 if !order_ids.is_empty() => {
                let index = (seed as usize) % order_ids.len();
                let order_id = order_ids[index].clone();
                set_caller(payer.clone(), NOW);
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    let _ = payout(&mut contract, &order_id);
                }));
            }
            _ => {}
        }

        let balance = contract.get_balance(payer.clone());
        let available = balance.available.0;
        let reserved = balance.reserved.0;
        let total = balance.total.0;
        assert_eq!(available.checked_add(reserved), Some(total));
        assert_eq!(total, credited);
    }
    assert!(sent.iter().all(|order_id| order_ids.contains(order_id)));
}

#[cfg(feature = "testing")]
#[test]
fn paying_out_and_settled_are_accepted_after_dispatched() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_status_order(&mut contract);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        near_sdk::PromiseResult::Successful(vec![]),
    );
    contract.on_payout_complete("order-1".to_string());
    set_caller(accounts(1), NOW);
    contract.set_status(
        "order-1".to_string(),
        "paying_out".to_string(),
        refs("ref-1"),
    );
    contract.set_status("order-1".to_string(), "settled".to_string(), refs("ref-1"));
    let receipt = contract.get_receipt("order-1".to_string());
    assert_eq!(receipt.transfer_state, TransferState::Dispatched);
    assert_eq!(receipt.backend_status, "settled");
}

#[cfg(feature = "testing")]
#[test]
fn happy_path_reserves_and_commits_once() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    let pending = contract.get_balance(accounts(3));
    assert_eq!(pending.available, U128(90));
    assert_eq!(pending.reserved, U128(10));

    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        PromiseResult::Successful(vec![]),
    );
    contract.on_payout_complete("order-1".to_string());
    let settled = contract.get_balance(accounts(3));
    assert_eq!(settled.available, U128(90));
    assert_eq!(settled.reserved, U128(0));
    assert_eq!(
        contract.get_receipt("order-1".to_string()).transfer_state,
        TransferState::Dispatched
    );
}

#[cfg(feature = "testing")]
#[test]
fn second_payout_and_same_block_duplicate_fail() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "order-1");
        }))
        .is_err()
    );
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        PromiseResult::Successful(vec![]),
    );
    contract.on_payout_complete("order-1".to_string());
    assert_eq!(
        contract.get_receipt("order-1".to_string()).transfer_state,
        TransferState::Dispatched
    );
}

#[cfg(feature = "testing")]
#[test]
fn expired_order_and_wrong_caller_leave_balance_unchanged() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 1);
    set_caller(accounts(5), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "order-1");
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    set_caller(accounts(3), NOW + 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "order-1");
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
}

#[cfg(feature = "testing")]
#[test]
fn insufficient_balance_leaves_available_funds_unchanged() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 9);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
        }))
        .is_err()
    );
    let balance = contract.get_balance(accounts(3));
    assert_eq!(balance.available, U128(9));
    assert_eq!(balance.reserved, U128(0));
}

#[cfg(feature = "testing")]
#[test]
fn failed_transfer_keeps_reservation_and_allows_retry() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        PromiseResult::Failed,
    );
    contract.on_payout_complete("order-1".to_string());
    let balance = contract.get_balance(accounts(3));
    assert_eq!(balance.available, U128(90));
    assert_eq!(balance.reserved, U128(10));
    assert_eq!(
        contract.get_receipt("order-1".to_string()).transfer_state,
        TransferState::Registered
    );
}

#[cfg(feature = "testing")]
#[test]
fn outsider_callback_and_stale_callback_change_nothing() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(5))
            .block_timestamp(NOW)
            .build(),
        PromiseResult::Successful(vec![]),
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.on_payout_complete("order-1".to_string());
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        PromiseResult::Successful(vec![]),
    );
    contract.on_payout_complete("order-1".to_string());
    contract.on_payout_complete("order-1".to_string());
    assert_eq!(
        contract.get_receipt("order-1".to_string()).transfer_state,
        TransferState::Dispatched
    );
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
}
