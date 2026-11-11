use fliq_vault::Contract;
use fliq_vault::orders::{
    order_amount, order_exists, order_payer, order_transfer_state, transition,
    validate_deposit_address, validate_order,
};
use fliq_vault::types::{PayoutOrder, ReceiptRefs, TransferState};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::StorageManagement;
use near_sdk::env;
use near_sdk::json_types::{U64, U128};
use near_sdk::test_utils::{VMContextBuilder, accounts};
use near_sdk::{AccountId, PublicKey, testing_env};
#[cfg(feature = "testing")]
use near_sdk::{PromiseResult, RuntimeFeesConfig, test_vm_config};

const NOW: u64 = 1_000_000_000;
#[cfg(feature = "testing")]
/// The default payout timeout, which is also the lowest the owner may set.
const TIMEOUT: u64 = 600_000_000_000;

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

fn agent_key() -> PublicKey {
    "ed25519:6E8sCci9badyRkXb3JoRpBj5p8C6Tw41ELDZoiihKEtp"
        .parse()
        .unwrap_or_else(|_| panic!("invalid test public key"))
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
fn payout_resolved_event(order_id: &str, transferred: bool, resolved_by: &str) -> String {
    format!(
        "EVENT_JSON:{{\"standard\":\"fliq_vault\",\"version\":\"1.0.0\",\"event\":\"payout_resolved\",\"data\":[{{\"order_id\":\"{order_id}\",\"transferred\":{transferred},\"resolved_by\":\"{resolved_by}\"}}]}}"
    )
}

#[cfg(feature = "testing")]
fn emitted(expected: &str) -> bool {
    near_sdk::test_utils::get_logs()
        .iter()
        .any(|log| log == expected)
}

#[cfg(feature = "testing")]
fn payout(contract: &mut Contract, order_id: &str) -> near_sdk::Promise {
    let order = contract
        .get_receipt(order_id.to_owned())
        .expect("receipt")
        .order;
    contract.payout(order_id.to_owned(), order.amount, order.deposit_address)
}

/// Enough NEAR to pay for one policy's storage. The contract refunds the rest.
const POLICY_DEPOSIT: u128 = 100_000_000_000_000_000_000_000;

/// The agent calls from its own account, accounts(5).
fn set_agent_caller(timestamp: u64, deposit: u128) {
    set_caller_with_deposit(accounts(5), timestamp, deposit);
}

fn policy(contract: &Contract, owner: AccountId) -> fliq_vault::types::AgentPolicyView {
    contract
        .get_policy(owner, accounts(5))
        .unwrap_or_else(|| panic!("agent policy was not stored"))
}

fn set_agent(
    contract: &mut Contract,
    owner: AccountId,
    max_per_payout: u128,
    daily_limit: u128,
    corridors: &[&str],
    cooldown_ns: u64,
    expiry_ns: u64,
) {
    set_caller_with_deposit(owner, NOW, POLICY_DEPOSIT);
    contract.set_agent(
        agent_key(),
        accounts(5),
        U128(max_per_payout),
        U128(daily_limit),
        Some(corridors.iter().map(|value| (*value).to_string()).collect()),
        U64(cooldown_ns),
        U64(expiry_ns),
    );
}

#[cfg(feature = "testing")]
fn register_agent_order(
    contract: &mut Contract,
    order_id: &str,
    payer: AccountId,
    amount: u128,
    corridor: &str,
    timestamp: u64,
) {
    set_caller(accounts(1), timestamp);
    contract.register_order(
        order_id.to_string(),
        payer,
        accounts(4),
        U128(amount),
        U64(timestamp + 3_600_000_000_000),
        corridor.to_string(),
        Some(accounts(5)),
    );
}

#[cfg(feature = "testing")]
fn complete_payout(contract: &mut Contract, order_id: &str, result: PromiseResult) {
    set_promise_result(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(0))
            .block_timestamp(NOW)
            .build(),
        result,
    );
    contract.on_payout_complete(order_id.to_string());
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
    set_agent(
        &mut contract,
        accounts(3),
        50,
        200,
        &["USDC-NGN"],
        60_000_000_000,
        NOW + 3_600_000_000_000,
    );

    let stored = policy(&contract, accounts(3));
    assert_eq!(stored.owner, accounts(3));
    assert_eq!(stored.agent_id, accounts(5));
    assert_eq!(stored.public_key, String::from(&agent_key()));
    assert_eq!(stored.per_payout_cap, U128(50));
    assert_eq!(stored.daily_cap, U128(200));
    assert_eq!(stored.spent_today, U128(0));
    assert_eq!(stored.corridors, Some(vec!["USDC-NGN".to_string()]));
    assert_eq!(stored.cooldown_ns, U64(60_000_000_000));
    assert!(!stored.revoked);
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|log| log.contains("\"event\":\"agent_set\""))
    );

    set_agent(
        &mut contract,
        accounts(3),
        25,
        100,
        &["USDC-NGN", "USDC-KES"],
        0,
        NOW + 7_200_000_000_000,
    );
    let updated = policy(&contract, accounts(3));
    assert_eq!(updated.per_payout_cap, U128(25));
    assert_eq!(
        updated.corridors,
        Some(vec!["USDC-KES".to_string(), "USDC-NGN".to_string()])
    );
}

#[test]
fn policies_are_per_owner_and_only_the_owner_can_revoke() {
    let mut contract = contract();
    set_agent(
        &mut contract,
        accounts(3),
        50,
        200,
        &["USDC-NGN"],
        0,
        NOW + 3_600_000_000_000,
    );

    set_caller_with_deposit(accounts(4), NOW, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.remove_agent(accounts(5));
        }))
        .is_err()
    );
    set_agent(
        &mut contract,
        accounts(4),
        1,
        1,
        &["USDC-KES"],
        0,
        NOW + 3_600_000_000_000,
    );
    assert_eq!(policy(&contract, accounts(3)).per_payout_cap, U128(50));

    set_caller_with_deposit(accounts(3), NOW, 1);
    contract.remove_agent(accounts(5));
    assert!(policy(&contract, accounts(3)).revoked);
    assert!(!policy(&contract, accounts(4)).revoked);
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|log| log.contains("\"event\":\"agent_revoked\""))
    );
}

#[test]
fn invalid_agent_policy_is_rejected() {
    let mut contract = contract();
    for (per_payout, daily, corridors, expiry) in [
        (0, 20, vec!["USDC-NGN".to_string()], NOW + 1),
        (30, 20, vec!["USDC-NGN".to_string()], NOW + 1),
        (10, 20, Vec::new(), NOW + 1),
        (10, 20, vec!["USDC-NGN".to_string()], NOW),
    ] {
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                set_caller_with_deposit(accounts(3), NOW, POLICY_DEPOSIT);
                contract.set_agent(
                    agent_key(),
                    accounts(5),
                    U128(per_payout),
                    U128(daily),
                    Some(corridors),
                    U64(0),
                    U64(expiry),
                );
            }))
            .is_err()
        );
    }

    set_caller_with_deposit(accounts(3), NOW, POLICY_DEPOSIT);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_agent(
                agent_key(),
                accounts(3),
                U128(10),
                U128(20),
                None,
                U64(0),
                U64(NOW + 1),
            );
        }))
        .is_err()
    );
}

#[test]
fn setting_an_agent_pays_for_its_storage_and_revoking_needs_one_yocto() {
    for deposit in [0, 1] {
        let mut contract = contract();
        set_caller_with_deposit(accounts(3), NOW, deposit);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.set_agent(
                    agent_key(),
                    accounts(5),
                    U128(10),
                    U128(20),
                    None,
                    U64(0),
                    U64(NOW + 1),
                );
            }))
            .is_err()
        );
    }

    for deposit in [0, 2] {
        let mut contract = contract();
        set_agent(
            &mut contract,
            accounts(3),
            10,
            20,
            &["USDC-NGN"],
            0,
            NOW + 1,
        );
        set_caller_with_deposit(accounts(3), NOW, deposit);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.remove_agent(accounts(5));
            }))
            .is_err()
        );
    }
}

#[test]
fn maximum_agent_policy_fits_inside_point_zero_one_near() {
    let mut contract = contract();
    let corridors = (0..16)
        .map(|index| format!("C{index:02}{}", "X".repeat(29)))
        .collect();
    set_caller_with_deposit(accounts(3), NOW, 10_000_000_000_000_000_000_000);
    contract.set_agent(
        agent_key(),
        accounts(5),
        U128(10),
        U128(20),
        Some(corridors),
        U64(0),
        U64(NOW + 1),
    );

    assert!(contract.get_policy(accounts(3), accounts(5)).is_some());
}

#[cfg(feature = "testing")]
#[test]
fn authorized_agent_payout_counts_pending_and_completed_spend() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_agent_order(
        &mut contract,
        "agent-order",
        accounts(3),
        30,
        "USDC-NGN",
        NOW,
    );
    set_agent(
        &mut contract,
        accounts(3),
        50,
        80,
        &["USDC-NGN"],
        0,
        NOW + 2 * 24 * 60 * 60 * 1_000_000_000,
    );

    set_agent_caller(NOW, 0);
    let _promise = payout(&mut contract, "agent-order");
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(30));
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|log| log.contains("\"event\":\"agent_spend\""))
    );

    complete_payout(
        &mut contract,
        "agent-order",
        PromiseResult::Successful(vec![]),
    );
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(30));
}

#[cfg(feature = "testing")]
#[test]
fn naming_someone_as_your_agent_never_limits_their_own_funds() {
    let mut contract = contract();
    register_storage(&mut contract, accounts(4));
    register_storage(&mut contract, accounts(5));
    contract.credit_for_testing(accounts(5), 100);
    register_named_order(&mut contract, "own-order", accounts(5), 60);
    set_caller_with_deposit(accounts(3), NOW, POLICY_DEPOSIT);
    contract.set_agent(
        agent_key(),
        accounts(5),
        U128(1),
        U128(1),
        Some(vec!["USDC-KES".to_string()]),
        U64(0),
        U64(NOW + 3_600_000_000_000),
    );

    set_caller(accounts(5), NOW);
    let _promise = payout(&mut contract, "own-order");
    set_caller_with_deposit(accounts(5), NOW, 1);
    contract.transfer(accounts(4), U128(40), None);
    assert_eq!(contract.get_balance(accounts(4)).available, U128(40));
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(0));
}

#[cfg(feature = "testing")]
#[test]
fn caller_without_a_policy_cannot_pay_out_for_the_payer() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_agent_order(&mut contract, "order-1", accounts(3), 10, "USDC-NGN", NOW);

    set_agent_caller(NOW, 0);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "order-1");
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(10));
}

#[cfg(feature = "testing")]
#[test]
fn pending_agent_spend_blocks_parallel_daily_limit_bypass() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_agent_order(&mut contract, "order-1", accounts(3), 30, "USDC-NGN", NOW);
    register_agent_order(&mut contract, "order-2", accounts(3), 30, "USDC-NGN", NOW);
    set_agent(
        &mut contract,
        accounts(3),
        40,
        50,
        &["USDC-NGN"],
        0,
        NOW + 3_600_000_000_000,
    );

    set_agent_caller(NOW, 0);
    let _first = payout(&mut contract, "order-1");
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "order-2");
        }))
        .is_err()
    );

    complete_payout(&mut contract, "order-1", PromiseResult::Failed);
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(0));
    set_agent_caller(NOW, 0);
    let _second = payout(&mut contract, "order-2");
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(30));
}

#[cfg(feature = "testing")]
#[test]
fn agent_policy_enforces_payer_amount_corridor_expiry_and_revocation() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_agent_order(&mut contract, "order-1", accounts(3), 30, "USDC-NGN", NOW);
    let attempt = |contract: &mut Contract, timestamp: u64| {
        set_agent_caller(timestamp, 0);
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(contract, "order-1");
        }))
        .is_err()
    };

    set_agent(
        &mut contract,
        accounts(3),
        20,
        100,
        &["USDC-NGN"],
        0,
        NOW + 3_600_000_000_000,
    );
    assert!(attempt(&mut contract, NOW));

    set_agent(
        &mut contract,
        accounts(3),
        50,
        100,
        &["USDC-KES"],
        0,
        NOW + 3_600_000_000_000,
    );
    assert!(attempt(&mut contract, NOW));

    set_agent(
        &mut contract,
        accounts(3),
        50,
        100,
        &["USDC-NGN"],
        0,
        NOW + 1,
    );
    assert!(attempt(&mut contract, NOW + 1));

    set_agent(
        &mut contract,
        accounts(3),
        50,
        100,
        &["USDC-NGN"],
        0,
        NOW + 3_600_000_000_000,
    );
    set_caller_with_deposit(accounts(3), NOW, 1);
    contract.remove_agent(accounts(5));
    assert!(attempt(&mut contract, NOW));

    let mut other_payer_contract = crate::contract();
    register_storage(&mut other_payer_contract, accounts(4));
    other_payer_contract.credit_for_testing(accounts(4), 50);
    register_agent_order(
        &mut other_payer_contract,
        "other-payer",
        accounts(4),
        10,
        "USDC-NGN",
        NOW,
    );
    set_agent(
        &mut other_payer_contract,
        accounts(3),
        50,
        100,
        &["USDC-NGN"],
        0,
        NOW + 3_600_000_000_000,
    );
    set_agent_caller(NOW, 0);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut other_payer_contract, "other-payer");
        }))
        .is_err()
    );
}

#[cfg(feature = "testing")]
#[test]
fn cooldown_survives_failed_transfer_and_daily_spend_resets() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_agent_order(&mut contract, "order-1", accounts(3), 20, "USDC-NGN", NOW);
    register_agent_order(&mut contract, "order-2", accounts(3), 20, "USDC-NGN", NOW);
    let cooldown = 100;
    let next_day = NOW + 24 * 60 * 60 * 1_000_000_000;
    set_agent(
        &mut contract,
        accounts(3),
        30,
        30,
        &["USDC-NGN"],
        cooldown,
        next_day + 3_600_000_000_000,
    );
    set_agent_caller(NOW, 0);
    let _first = payout(&mut contract, "order-1");
    complete_payout(&mut contract, "order-1", PromiseResult::Failed);

    set_agent_caller(NOW + cooldown - 1, 0);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "order-2");
        }))
        .is_err()
    );
    set_agent_caller(NOW + cooldown, 0);
    let _second = payout(&mut contract, "order-2");
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(20));

    set_caller(accounts(4), next_day);
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(0));
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
        None,
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
        None,
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
    for from in states.iter() {
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
    fund(&mut contract, accounts(3), 10);
    set_caller(accounts(1), NOW);
    contract.register_order(
        "order-1".to_string(),
        accounts(3),
        accounts(4),
        U128(10),
        U64(NOW + 3_600_000_000_000),
        "USDC-NGN".to_string(),
        None,
    );
    let receipt = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
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
        contract
            .get_receipt("release-1".to_owned())
            .expect("receipt")
            .transfer_state,
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
            let receipt = contract
                .get_receipt("release-2".to_owned())
                .expect("receipt");
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
                None,
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
            None,
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
            None,
        );
        contract.register_order(
            "order-1".to_string(),
            accounts(3),
            accounts(4),
            U128(10),
            U64(expiry),
            "USDC-NGN".to_string(),
            None,
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
                None,
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
        None,
    );
    let receipt_before = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
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
                None,
            );
        }))
        .is_err()
    );
    let receipt_after = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
    assert_eq!(receipt_after, receipt_before);
}

#[test]
fn unknown_receipt_returns_null() {
    let contract = contract();
    assert!(contract.get_receipt("missing".to_string()).is_none());
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
        None,
    );
    let receipt = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
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
        refused
            .get_receipt("order-1".to_string())
            .expect("receipt")
            .backend_status,
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
            .expect("receipt")
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
    let before = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    assert_eq!(
        contract
            .get_receipt("order-1".to_string())
            .expect("receipt"),
        before
    );
}

#[cfg(feature = "testing")]
#[test]
fn backend_status_sequence_is_accepted_after_payout() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 10);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    complete_payout(&mut contract, "order-1", PromiseResult::Successful(vec![]));

    set_caller(accounts(1), NOW);
    for status in ["routing", "with_provider", "paying_out", "settled"] {
        contract.set_status(
            "order-1".to_string(),
            status.to_string(),
            ReceiptRefs::default(),
        );
    }
    assert_eq!(
        contract
            .get_receipt("order-1".to_string())
            .and_then(|receipt| receipt.status),
        Some("settled".to_string())
    );
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
    let receipt = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
    assert_eq!(receipt.order.amount, U128(10));
    assert_eq!(receipt.order.deposit_address, accounts(4));
    assert_eq!(receipt.state, "registered");
    assert_eq!(receipt.transfer_state, TransferState::Registered);
    assert_eq!(receipt.order.transfer_state, TransferState::Registered);
    assert_eq!(receipt.backend_status, "routing");
    assert_eq!(receipt.status.as_deref(), Some("routing"));
    assert_eq!(receipt.refs, refs("ref-1"));
}

#[test]
fn status_does_not_change_transfer_state_or_balance() {
    let mut contract = contract();
    register_status_order(&mut contract);
    let before_balance = contract.get_balance(accounts(3));
    set_caller(accounts(1), NOW);
    contract.set_status("order-1".to_string(), "routing".to_string(), refs("ref-1"));
    let receipt = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
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
    assert_eq!(contract.get_balance(accounts(3)).available, U128(10));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
    set_caller(accounts(1), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.release_order("order-1".to_string());
        }))
        .is_err()
    );
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
    let before = contract
        .get_receipt("order-1".to_string())
        .expect("receipt")
        .order;
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    let during = contract
        .get_receipt("order-1".to_string())
        .expect("receipt")
        .order;
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
        "settled".to_string(),
        ReceiptRefs::default(),
    );
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
        contract
            .get_receipt("order-1".to_string())
            .expect("receipt")
            .backend_status,
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
        None,
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
            contract.transfer(accounts(4), U128(25), None);
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(4)).available, U128(0));

    set_caller_with_deposit(accounts(3), NOW, 1);
    contract.transfer(
        accounts(4),
        U128(25),
        Some("request_01J_DAPPER".to_string()),
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(75));
    assert_eq!(contract.get_balance(accounts(4)).available, U128(25));
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|log| log.contains("\"event\":\"transferred\"") && log.contains("\"data\":[{"))
    );
}

#[test]
fn transfer_rejects_invalid_request_ids_without_moving_funds() {
    let mut contract = contract();
    register_storage(&mut contract, accounts(4));
    fund(&mut contract, accounts(3), 100);

    let too_long = "x".repeat(65);
    for request_id in ["", "contains spaces", too_long.as_str()] {
        set_caller_with_deposit(accounts(3), NOW, 1);
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.transfer(accounts(4), U128(25), Some(request_id.to_string()));
            }))
            .is_err()
        );
    }
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(4)).available, U128(0));
}

#[test]
fn agent_cannot_move_the_owners_funds_with_transfer() {
    let mut contract = contract();
    register_storage(&mut contract, accounts(4));
    register_storage(&mut contract, accounts(5));
    fund(&mut contract, accounts(3), 100);
    set_agent(
        &mut contract,
        accounts(3),
        30,
        40,
        &["USDC-NGN"],
        0,
        NOW + 3_600_000_000_000,
    );

    set_agent_caller(NOW, 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.transfer(accounts(4), U128(25), None);
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(4)).available, U128(0));
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(0));
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
fn only_the_owner_can_resolve_a_stuck_payout_as_not_transferred() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_caller(accounts(1), NOW + TIMEOUT);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.resolve_stuck_payout("order-1".to_string(), false);
        }))
        .is_err()
    );
    set_caller(accounts(0), NOW + TIMEOUT);
    contract.resolve_stuck_payout("order-1".to_string(), false);
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::TransferFailed)
    );
    assert_eq!(
        contract
            .get_receipt("order-1".to_string())
            .map(|receipt| receipt.state),
        Some("released".to_string())
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
    set_caller(accounts(1), NOW + TIMEOUT);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = contract.recredit("order-1".to_string(), U128(10));
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
}

#[test]
fn canonical_event_fixture_covers_every_documented_event() {
    let fixture = include_str!("fixtures/events.jsonl");
    let actual: std::collections::BTreeSet<String> = fixture
        .lines()
        .map(|line| {
            near_sdk::serde_json::from_str::<near_sdk::serde_json::Value>(line)
                .unwrap_or_else(|_| panic!("invalid event fixture"))["event"]
                .as_str()
                .unwrap_or_else(|| panic!("fixture event is missing"))
                .to_string()
        })
        .collect();
    let expected = std::collections::BTreeSet::from([
        "agent_revoked".to_string(),
        "agent_set".to_string(),
        "agent_spend".to_string(),
        "agent_spend_reversed".to_string(),
        "deposited".to_string(),
        "order_registered".to_string(),
        "order_released".to_string(),
        "payout_executed".to_string(),
        "payout_failed".to_string(),
        "payout_resolved".to_string(),
        "payout_timeout_set".to_string(),
        "recredited".to_string(),
        "status_set".to_string(),
        "transferred".to_string(),
        "withdraw_failed".to_string(),
        "withdrawn".to_string(),
    ]);
    assert_eq!(actual, expected);
}

#[cfg(feature = "testing")]
#[test]
fn payout_timeout_is_owner_configurable_within_bounds() {
    let mut contract = contract();
    assert_eq!(contract.get_config().payout_timeout, U64(TIMEOUT));
    set_caller(accounts(3), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_payout_timeout(U64(2 * TIMEOUT));
        }))
        .is_err()
    );
    set_caller(accounts(0), NOW);
    for out_of_range in [1, TIMEOUT - 1, 7 * 24 * 3_600_000_000_000 + 1] {
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.set_payout_timeout(U64(out_of_range));
            }))
            .is_err()
        );
    }
    contract.set_payout_timeout(U64(2 * TIMEOUT));
    assert_eq!(contract.get_config().payout_timeout, U64(2 * TIMEOUT));
    assert!(
        near_sdk::test_utils::get_logs()
            .iter()
            .any(|log| log.contains("\"event\":\"payout_timeout_set\""))
    );
}

#[cfg(feature = "testing")]
#[test]
fn stuck_payout_requires_owner_timeout_and_executing_state() {
    let mut contract = contract();
    set_caller(accounts(0), NOW);
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
    set_caller(accounts(0), NOW + TIMEOUT - 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.resolve_stuck_payout("order-1".to_string(), false);
        }))
        .is_err()
    );
    set_caller(accounts(0), NOW + TIMEOUT);
    contract.resolve_stuck_payout("order-1".to_string(), false);
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::TransferFailed)
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
}

#[cfg(feature = "testing")]
#[test]
fn stuck_payout_transferred_commits_and_is_single_use() {
    let mut contract = contract();
    set_caller(accounts(0), NOW);
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_caller(accounts(0), NOW + TIMEOUT);
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
            .block_timestamp(NOW + TIMEOUT)
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
                let receipt = contract.get_receipt(order_id.clone()).expect("receipt");
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
    let receipt = contract
        .get_receipt("order-1".to_string())
        .expect("receipt");
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
        contract
            .get_receipt("order-1".to_string())
            .expect("receipt")
            .transfer_state,
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
        contract
            .get_receipt("order-1".to_string())
            .expect("receipt")
            .transfer_state,
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
    assert_eq!(balance.available, U128(100));
    assert_eq!(balance.reserved, U128(0));
    assert_eq!(
        contract
            .get_receipt("order-1".to_string())
            .expect("receipt")
            .transfer_state,
        TransferState::TransferFailed
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
        contract
            .get_receipt("order-1".to_string())
            .expect("receipt")
            .transfer_state,
        TransferState::Dispatched
    );
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
}

#[cfg(feature = "testing")]
fn agent_ready(contract: &mut Contract) {
    contract.credit_for_testing(accounts(3), 100);
    set_agent(
        contract,
        accounts(3),
        50,
        80,
        &["USDC-NGN"],
        0,
        NOW + 2 * 24 * 60 * 60 * 1_000_000_000,
    );
}

#[cfg(feature = "testing")]
#[test]
fn an_agent_cannot_pay_an_order_that_was_not_registered_for_it() {
    let mut contract = contract();
    agent_ready(&mut contract);
    register_named_order(&mut contract, "user-order", accounts(3), 30);
    set_agent_caller(NOW, 0);
    let refused = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _ = payout(&mut contract, "user-order");
    }));
    assert!(refused.is_err());
    assert_eq!(
        order_transfer_state(&contract, "user-order"),
        Some(TransferState::Registered)
    );
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(0));

    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "user-order");
    assert_eq!(
        order_transfer_state(&contract, "user-order"),
        Some(TransferState::Executing)
    );
}

#[cfg(feature = "testing")]
#[test]
fn an_order_bound_to_one_agent_cannot_be_paid_by_another() {
    let mut contract = contract();
    agent_ready(&mut contract);
    set_caller(accounts(1), NOW);
    contract.register_order(
        "other-agent".to_string(),
        accounts(3),
        accounts(4),
        U128(30),
        U64(NOW + 3_600_000_000_000),
        "USDC-NGN".to_string(),
        Some(accounts(2)),
    );
    set_agent_caller(NOW, 0);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "other-agent");
        }))
        .is_err()
    );
}

#[cfg(feature = "testing")]
#[test]
fn an_order_cannot_be_bound_to_its_own_payer_or_use_the_withdraw_prefix() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    set_caller(accounts(1), NOW);
    for (order_id, agent) in [("self-bound", Some(accounts(3))), ("withdraw:x", None)] {
        assert!(
            std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                contract.register_order(
                    order_id.to_string(),
                    accounts(3),
                    accounts(4),
                    U128(10),
                    U64(NOW + 3_600_000_000_000),
                    "USDC-NGN".to_string(),
                    agent.clone(),
                );
            }))
            .is_err()
        );
    }
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
}

#[cfg(feature = "testing")]
#[test]
fn a_failed_agent_payout_reverses_the_spend_with_events() {
    let mut contract = contract();
    agent_ready(&mut contract);
    register_agent_order(
        &mut contract,
        "agent-order",
        accounts(3),
        30,
        "USDC-NGN",
        NOW,
    );
    set_agent_caller(NOW, 0);
    let _promise = payout(&mut contract, "agent-order");
    complete_payout(&mut contract, "agent-order", PromiseResult::Failed);
    let logs = near_sdk::test_utils::get_logs();
    assert!(
        logs.iter()
            .any(|log| log.contains("\"event\":\"payout_failed\""))
    );
    assert!(
        logs.iter()
            .any(|log| log.contains("\"event\":\"agent_spend_reversed\""))
    );
    assert_eq!(policy(&contract, accounts(3)).spent_today, U128(0));
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
}

#[cfg(feature = "testing")]
#[test]
fn a_payout_cannot_be_resolved_before_the_real_callback_can_run() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");

    set_caller(accounts(0), NOW);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.set_payout_timeout(U64(1));
        }))
        .is_err()
    );
    set_caller(accounts(0), NOW + 1);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.resolve_stuck_payout("order-1".to_string(), false);
        }))
        .is_err()
    );

    complete_payout(&mut contract, "order-1", PromiseResult::Successful(vec![]));
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Dispatched)
    );
    assert_eq!(contract.get_balance(accounts(3)).total, U128(90));
}

#[cfg(feature = "testing")]
#[test]
fn resolving_a_stuck_payout_emits_who_resolved_it() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    set_caller(accounts(1), NOW + TIMEOUT);
    contract.resolve_stuck_payout("order-1".to_string(), true);
    assert!(emitted(&payout_resolved_event("order-1", true, "bob")));
    assert_eq!(contract.get_balance(accounts(3)).total, U128(90));
}

#[cfg(feature = "testing")]
#[test]
fn the_owner_resolving_a_stuck_payout_as_not_transferred_emits_the_same_shape() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    set_caller(accounts(3), NOW);
    let _promise = payout(&mut contract, "order-1");
    assert_eq!(contract.get_balance(accounts(3)).available, U128(90));
    set_caller(accounts(0), NOW + TIMEOUT);
    contract.resolve_stuck_payout("order-1".to_string(), false);
    assert!(emitted(&payout_resolved_event("order-1", false, "alice")));
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_liabilities(), U128(100));
}

#[cfg(feature = "testing")]
#[test]
fn the_payer_or_anyone_can_release_an_expired_order() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 40, NOW + 1_000);

    set_caller(accounts(3), NOW + 999);
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            contract.release_order("order-1".to_string());
        }))
        .is_err()
    );
    assert_eq!(contract.get_balance(accounts(3)).available, U128(60));

    set_caller(accounts(5), NOW + 1_000);
    contract.release_order("order-1".to_string());
    assert_eq!(contract.get_balance(accounts(3)).available, U128(100));
    assert_eq!(contract.get_balance(accounts(3)).reserved, U128(0));
    assert_eq!(
        order_transfer_state(&contract, "order-1"),
        Some(TransferState::Released)
    );
}

#[cfg(feature = "testing")]
#[test]
fn payout_needs_the_raised_gas_floor() {
    let mut contract = contract();
    contract.credit_for_testing(accounts(3), 100);
    register_payout_order(&mut contract, 10, NOW + 3_600_000_000_000);
    testing_env!(
        VMContextBuilder::new()
            .current_account_id(accounts(0))
            .predecessor_account_id(accounts(3))
            .block_timestamp(NOW)
            .prepaid_gas(near_sdk::Gas::from_tgas(55))
            .build()
    );
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = payout(&mut contract, "order-1");
        }))
        .is_err()
    );
}
