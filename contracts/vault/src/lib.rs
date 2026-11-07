pub mod orders;
pub mod types;

mod errors;
mod integration;
mod policies;
mod receipts;
mod vault;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::{LookupMap, LookupSet};
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, PublicKey,
    env, ext_contract, near, require,
};

use crate::orders::{set_status as apply_status, validate_deposit_address, validate_order};
use crate::receipts::FliqEvent;
#[cfg(all(feature = "testing", debug_assertions))]
use crate::types::Amount;
use crate::types::{
    AgentPolicy, AgentPolicyView, Config, DEFAULT_MAX_EXPIRY, DEFAULT_PAYOUT_TIMEOUT, PayoutOrder,
    PendingPolicySpend, Receipt, ReceiptRefs, ReceiptView, StorageKey, TransferState, now,
};
use crate::vault::{BalanceView, TransferError, Vault};

const FT_BALANCE_GAS: Gas = Gas::from_tgas(10);
const RECREDIT_CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait ExtFungibleToken {
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtContract {
    fn on_recredit_balance(&mut self, order_id: String, amount: U128) -> bool;
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct TransferMessage {
    top_up: TopUpMessage,
}

#[derive(Deserialize)]
#[serde(crate = "near_sdk::serde", deny_unknown_fields)]
struct TopUpMessage {
    account_id: AccountId,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    approved_usdc: AccountId,
    vault: Vault,
    pub(crate) config: Config,
    pub(crate) orders: LookupMap<String, PayoutOrder>,
    pub(crate) receipts: LookupMap<String, Receipt>,
    pub(crate) used_refund_transactions: LookupSet<String>,
    pub(crate) payout_keys: LookupMap<String, String>,
    pub(crate) agent_policies: LookupMap<(AccountId, AccountId), AgentPolicy>,
    pub(crate) pending_policy_spends: LookupMap<String, PendingPolicySpend>,
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(
        owner: AccountId,
        registration_account: AccountId,
        approved_usdc_token_contract: AccountId,
    ) -> Self {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            errors::INITIALIZER_ONLY
        );
        require!(
            env::state_read::<Self>().is_none(),
            errors::ALREADY_INITIALIZED
        );
        Self {
            approved_usdc: approved_usdc_token_contract.clone(),
            vault: Vault::new(),
            config: Config {
                owner,
                registration_account,
                approved_usdc_token_contract,
                max_expiry: DEFAULT_MAX_EXPIRY.into(),
                payout_timeout: DEFAULT_PAYOUT_TIMEOUT.into(),
            },
            orders: LookupMap::new(StorageKey::Orders),
            receipts: LookupMap::new(StorageKey::Receipts),
            used_refund_transactions: LookupSet::new(StorageKey::UsedRefundTransactions),
            payout_keys: LookupMap::new(StorageKey::PayoutKeys),
            agent_policies: LookupMap::new(StorageKey::AgentPolicies),
            pending_policy_spends: LookupMap::new(StorageKey::PendingPolicySpends),
        }
    }

    pub fn get_balance(&self, account_id: AccountId) -> BalanceView {
        integration::get_balance(&self.vault, &account_id)
    }

    pub fn get_storage_usage(&self) -> u64 {
        env::storage_usage()
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    #[payable]
    #[allow(clippy::too_many_arguments)]
    pub fn set_agent(
        &mut self,
        public_key: PublicKey,
        agent_id: AccountId,
        per_payout_cap: U128,
        daily_cap: U128,
        corridors: Option<Vec<String>>,
        cooldown_ns: near_sdk::json_types::U64,
        expiry_ns: near_sdk::json_types::U64,
    ) {
        policies::set_agent(
            self,
            public_key,
            agent_id,
            per_payout_cap,
            daily_cap,
            corridors,
            cooldown_ns,
            expiry_ns,
        );
    }

    #[payable]
    pub fn remove_agent(&mut self, agent_id: AccountId) {
        policies::remove_agent(self, &agent_id);
    }

    pub fn get_policy(&self, owner: AccountId, agent_id: AccountId) -> Option<AgentPolicyView> {
        policies::get_policy(self, owner, agent_id)
    }

    pub fn set_payout_timeout(&mut self, payout_timeout: near_sdk::json_types::U64) {
        require!(
            env::predecessor_account_id() == self.config.owner,
            errors::OWNER_ONLY
        );
        require!(payout_timeout.0 > 0, errors::INVALID_EXPIRY);
        self.config.payout_timeout = payout_timeout;
    }

    pub fn register_order(
        &mut self,
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: U128,
        expires_at_ns: near_sdk::json_types::U64,
        corridor: String,
    ) {
        require!(
            env::predecessor_account_id() == self.config.registration_account,
            errors::REGISTRATION_ONLY
        );
        validate_order(&order_id, amount.0, &corridor);
        require!(!self.orders.contains_key(&order_id), errors::ORDER_EXISTS);
        validate_deposit_address(deposit_address.as_ref());
        let current_time = now();
        require!(expires_at_ns.0 > current_time, errors::INVALID_EXPIRY);
        require!(
            expires_at_ns.0 - current_time <= self.config.max_expiry.0,
            errors::INVALID_EXPIRY
        );
        integration::reserve_for_order(&mut self.vault, &order_id, &payer, amount.0);
        let order = PayoutOrder {
            order_id: order_id.clone(),
            payer: payer.clone(),
            deposit_address: deposit_address.clone(),
            amount,
            expiry: expires_at_ns,
            corridor: corridor.clone(),
            transfer_state: TransferState::Registered,
            created_at: now().into(),
            executing_since: None,
        };
        self.orders.insert(&order_id, &order);
        self.receipts.insert(
            &order_id,
            &Receipt {
                order_id: order_id.clone(),
                order: order.clone(),
                transfer_state: TransferState::Registered,
                backend_status: "created".to_string(),
                refs: ReceiptRefs::default(),
                last_updated: now().into(),
            },
        );
        FliqEvent::OrderRegistered {
            order_id,
            payer,
            deposit_address,
            amount,
            expires_at_ns: expires_at_ns.0.to_string(),
            corridor,
        }
        .emit();
    }

    #[payable]
    pub fn payout(
        &mut self,
        order_id: String,
        amount: U128,
        deposit_address: AccountId,
    ) -> Promise {
        require!(
            env::attached_deposit().is_zero(),
            errors::NO_ATTACHED_DEPOSIT
        );
        orders::payout(self, order_id, amount, deposit_address)
    }

    pub fn set_status(&mut self, order_id: String, status: String, refs: ReceiptRefs) {
        apply_status(self, order_id, status, refs);
    }

    /// Releases a registered order. An executing order must use resolve_stuck_payout.
    pub fn release_order(&mut self, order_id: String) {
        require!(
            matches!(
                env::predecessor_account_id(),
                caller if caller == self.config.registration_account || caller == self.config.owner
            ),
            errors::REGISTRATION_ONLY
        );
        let Some(mut order) = self.orders.get(&order_id) else {
            env::panic_str(errors::ORDER_NOT_FOUND);
        };
        require!(
            order.transfer_state == TransferState::Registered,
            errors::INVALID_STATE
        );
        integration::release_reservation(&mut self.vault, &order_id);
        order.transfer_state = TransferState::Released;
        self.orders.insert(&order_id, &order);
        let Some(mut receipt) = self.receipts.get(&order_id) else {
            env::panic_str(errors::RECEIPT_NOT_FOUND);
        };
        receipt.order = order.clone();
        receipt.transfer_state = TransferState::Released;
        receipt.last_updated = now().into();
        self.receipts.insert(&order_id, &receipt);
        FliqEvent::OrderReleased {
            order_id,
            payer: order.payer,
            amount: order.amount,
        }
        .emit();
    }

    pub fn recredit(&mut self, order_id: String, amount: U128) -> Promise {
        orders::validate_recredit(self, &order_id, amount);
        ext_ft::ext(self.config.approved_usdc_token_contract.clone())
            .with_static_gas(FT_BALANCE_GAS)
            .ft_balance_of(env::current_account_id())
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(RECREDIT_CALLBACK_GAS)
                    .on_recredit_balance(order_id, amount),
            )
    }

    #[payable]
    pub fn transfer(&mut self, to_account: AccountId, amount: U128) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            errors::ONE_YOCTO_REQUIRED
        );
        let from = env::predecessor_account_id();
        match self.vault.transfer_available(&from, &to_account, amount.0) {
            Ok(()) => {}
            Err(TransferError::AmountMustBePositive | TransferError::ArithmeticOverflow) => {
                env::panic_str(errors::INVALID_AMOUNT)
            }
            Err(TransferError::InsufficientBalance) => env::panic_str(errors::INSUFFICIENT_BALANCE),
            Err(
                TransferError::SameAccount
                | TransferError::SenderNotRegistered
                | TransferError::RecipientNotRegistered,
            ) => env::panic_str(errors::UNAUTHORIZED),
        }
        FliqEvent::Transferred {
            from,
            to: to_account,
            amount,
        }
        .emit();
    }

    pub fn get_receipt(&self, order_id: String) -> Option<ReceiptView> {
        self.receipts.get(&order_id).map(|receipt| ReceiptView {
            order_id: receipt.order_id,
            payer: receipt.order.payer.clone(),
            deposit_address: receipt.order.deposit_address.clone(),
            amount: receipt.order.amount,
            expires_at_ns: receipt.order.expiry,
            corridor: receipt.order.corridor.clone(),
            state: match &receipt.transfer_state {
                TransferState::Registered => "registered",
                TransferState::Executing | TransferState::Dispatched => "executed",
                // A failed transfer returned the reservation to the payer, so nothing left.
                TransferState::TransferFailed | TransferState::Released => "released",
            }
            .to_owned(),
            status: match receipt.backend_status.as_str() {
                "routing" | "with_provider" | "paying_out" | "settled" | "refunding"
                | "refunded" | "failed" => Some(receipt.backend_status.clone()),
                _ => None,
            },
            recredited_amount: U128(self.vault.recredited_amount(&order_id)),
            order: receipt.order.clone(),
            transfer_state: receipt.transfer_state.clone(),
            expired: receipt.transfer_state == TransferState::Registered
                && orders::is_expired(receipt.order.expiry, now()),
            executing_since: receipt.order.executing_since,
            backend_status: receipt.backend_status,
            refs: receipt.refs,
            last_updated: receipt.last_updated,
        })
    }

    #[cfg(all(feature = "testing", debug_assertions))]
    pub fn credit_for_testing(&mut self, account: AccountId, amount: Amount) {
        require!(
            self.vault.deposit(&account, U128(amount)).0 == 0,
            errors::TEST_ACCOUNT_UNREGISTERED
        );
    }

    #[private]
    pub fn on_payout_complete(&mut self, order_id: String) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            errors::CALLBACK_UNAUTHORIZED
        );
        require!(
            env::promise_results_count() == 1,
            errors::CALLBACK_PROMISE_COUNT
        );
        orders::on_payout_complete(self, order_id);
    }

    #[private]
    pub fn on_recredit_balance(
        &mut self,
        order_id: String,
        amount: U128,
        #[callback_result] result: Result<U128, PromiseError>,
    ) -> bool {
        let Ok(actual_token_balance) = result else {
            return false;
        };
        orders::on_recredit_balance(self, order_id, amount, actual_token_balance)
    }

    /// Resolve an execution only after checking on chain whether the USDC transfer happened.
    /// Releasing funds after a real transfer would double pay the order.
    pub fn resolve_stuck_payout(&mut self, order_id: String, transferred: bool) {
        require!(
            env::predecessor_account_id() == self.config.owner,
            errors::OWNER_ONLY
        );
        orders::resolve_stuck_payout(self, order_id, transferred);
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.vault.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.vault.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.vault.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.vault.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.vault.storage_balance_of(&account_id)
    }
}

#[near]
impl FungibleTokenReceiver for Contract {
    fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if env::predecessor_account_id() != self.approved_usdc || amount.0 == 0 {
            return PromiseOrValue::Value(amount);
        }

        let Some(beneficiary) = Self::deposit_beneficiary(&sender_id, &msg) else {
            return PromiseOrValue::Value(amount);
        };

        let unused = self.vault.deposit(&beneficiary, amount);
        if unused.0 == 0 {
            Self::log_deposit(&beneficiary, &sender_id, amount);
        }

        PromiseOrValue::Value(unused)
    }
}

impl Contract {
    fn deposit_beneficiary(sender_id: &AccountId, msg: &str) -> Option<AccountId> {
        if msg.is_empty() {
            return Some(sender_id.clone());
        }

        near_sdk::serde_json::from_str::<TransferMessage>(msg)
            .ok()
            .map(|message| message.top_up.account_id)
    }

    fn log_deposit(account_id: &AccountId, sender_id: &AccountId, amount: U128) {
        let event = near_sdk::serde_json::json!({
            "standard": "fliq_vault",
            "version": "1.0.0",
            "event": "deposited",
            "data": [{
                "account_id": account_id,
                "sender_id": sender_id,
                "amount": amount,
            }],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{VMContextBuilder, get_created_receipts, get_logs};
    use near_sdk::{VMContext, testing_env};

    fn account(value: &str) -> AccountId {
        value
            .parse()
            .unwrap_or_else(|_| panic!("invalid test account {value}"))
    }

    fn context(predecessor: &AccountId, attached_deposit: NearToken) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("vault.testnet"))
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor.clone())
            .attached_deposit(attached_deposit)
            .build()
    }

    fn contract() -> Contract {
        let vault = account("vault.testnet");
        testing_env!(context(&vault, NearToken::from_yoctonear(0)));
        Contract::new(
            account("owner.testnet"),
            account("registration.testnet"),
            account("usdc.testnet"),
        )
    }

    fn register(contract: &mut Contract, account_id: &AccountId) {
        let minimum = contract.storage_balance_bounds().min;
        testing_env!(context(account_id, minimum));
        contract.storage_deposit(None, Some(true));
    }

    fn returned_amount(result: PromiseOrValue<U128>) -> U128 {
        match result {
            PromiseOrValue::Value(amount) => amount,
            PromiseOrValue::Promise(_) => panic!("deposit unexpectedly returned a promise"),
        }
    }

    fn transferred_to(account_id: &AccountId) -> NearToken {
        for receipt in get_created_receipts() {
            if &receipt.receiver_id != account_id {
                continue;
            }
            for action in receipt.actions {
                if let MockAction::Transfer { deposit, .. } = action {
                    return deposit;
                }
            }
        }
        panic!("no transfer receipt created for {account_id}");
    }

    #[test]
    #[should_panic(expected = "fliq_vault: INITIALIZER_ONLY")]
    fn outsider_cannot_initialize_contract() {
        let attacker = account("attacker.testnet");
        testing_env!(context(&attacker, NearToken::from_yoctonear(0)));
        Contract::new(
            attacker,
            account("registration.testnet"),
            account("fake-token.testnet"),
        );
    }

    #[test]
    fn approved_usdc_deposit_credits_sender() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let unused = contract.ft_on_transfer(user.clone(), U128(100_000_000), String::new());
        assert_eq!(returned_amount(unused), U128(0));
        assert_eq!(
            contract.get_balance(user),
            BalanceView {
                available: U128(100_000_000),
                reserved: U128(0),
                total: U128(100_000_000)
            }
        );
    }

    #[test]
    fn wrong_token_returns_everything_without_credit() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(
            &account("fake-token.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let unused = contract.ft_on_transfer(user.clone(), U128(50_000_000), String::new());
        assert_eq!(returned_amount(unused), U128(50_000_000));
        assert_eq!(contract.get_balance(user), BalanceView::default());
    }

    #[test]
    fn wrong_token_cannot_attribute_a_top_up() {
        let mut contract = contract();
        let beneficiary = account("ada.testnet");
        register(&mut contract, &beneficiary);
        testing_env!(context(
            &account("fake-token.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let unused = contract.ft_on_transfer(
            account("intents.testnet"),
            U128(50_000_000),
            r#"{"top_up":{"account_id":"ada.testnet"}}"#.to_owned(),
        );
        assert_eq!(returned_amount(unused), U128(50_000_000));
        assert_eq!(contract.get_balance(beneficiary), BalanceView::default());
        assert!(get_logs().is_empty());
    }

    #[test]
    fn strict_top_up_message_credits_beneficiary_not_sender() {
        let mut contract = contract();
        let sender = account("intents.testnet");
        let beneficiary = account("ada.testnet");
        register(&mut contract, &beneficiary);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let unused = contract.ft_on_transfer(
            sender.clone(),
            U128(50_000_000),
            r#"{"top_up":{"account_id":"ada.testnet"}}"#.to_owned(),
        );
        assert_eq!(returned_amount(unused), U128(0));
        assert_eq!(contract.get_balance(sender), BalanceView::default());
        assert_eq!(
            contract.get_balance(beneficiary).available,
            U128(50_000_000)
        );
    }

    #[test]
    fn repeated_top_up_requires_and_credits_each_real_transfer() {
        let mut contract = contract();
        let sender = account("intents.testnet");
        let beneficiary = account("ada.testnet");
        register(&mut contract, &beneficiary);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let msg = r#"{"top_up":{"account_id":"ada.testnet"}}"#.to_owned();
        assert_eq!(
            returned_amount(contract.ft_on_transfer(sender.clone(), U128(25_000_000), msg.clone())),
            U128(0)
        );
        assert_eq!(
            returned_amount(contract.ft_on_transfer(sender, U128(25_000_000), msg)),
            U128(0)
        );
        assert_eq!(
            contract.get_balance(beneficiary).available,
            U128(50_000_000)
        );
        assert_eq!(get_logs().len(), 2);
    }

    #[test]
    fn malformed_or_extended_top_up_messages_are_returned() {
        for msg in [
            r#"{"account_id":"ada.testnet"}"#,
            r#"{"top_up":{"account_id":"not valid"}}"#,
            r#"{"top_up":{"account_id":"ada.testnet","extra":1}}"#,
            r#"{"top_up":{"account_id":"ada.testnet"},"extra":1}"#,
            "not-json",
        ] {
            let mut contract = contract();
            let beneficiary = account("ada.testnet");
            register(&mut contract, &beneficiary);
            testing_env!(context(
                &account("usdc.testnet"),
                NearToken::from_yoctonear(0)
            ));
            let unused = contract.ft_on_transfer(
                account("intents.testnet"),
                U128(50_000_000),
                msg.to_owned(),
            );
            assert_eq!(returned_amount(unused), U128(50_000_000));
            assert_eq!(contract.get_balance(beneficiary), BalanceView::default());
        }
    }

    #[test]
    fn unregistered_top_up_beneficiary_receives_full_refund() {
        let mut contract = contract();
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let unused = contract.ft_on_transfer(
            account("intents.testnet"),
            U128(50_000_000),
            r#"{"top_up":{"account_id":"ada.testnet"}}"#.to_owned(),
        );
        assert_eq!(returned_amount(unused), U128(50_000_000));
        assert_eq!(
            contract.get_balance(account("ada.testnet")),
            BalanceView::default()
        );
    }

    #[test]
    fn accepted_deposit_emits_backend_compatible_event() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        returned_amount(contract.ft_on_transfer(user, U128(50_000_000), String::new()));
        assert!(
            get_logs()
                .iter()
                .any(|log| log.contains("\"event\":\"deposited\"")
                    && log.contains("\"amount\":\"50000000\""))
        );
    }

    #[test]
    fn unregistered_sender_receives_full_refund() {
        let mut contract = contract();
        let user = account("ada.testnet");
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let unused = contract.ft_on_transfer(user.clone(), U128(50_000_000), String::new());
        assert_eq!(returned_amount(unused), U128(50_000_000));
        assert_eq!(contract.get_balance(user), BalanceView::default());
    }

    #[test]
    fn storage_registration_reports_a_fixed_nonzero_cost() {
        let mut contract = contract();
        let user = account("ada.testnet");
        let bounds = contract.storage_balance_bounds();
        assert!(!bounds.min.is_zero());
        assert_eq!(bounds.max, Some(bounds.min));
        testing_env!(context(&user, bounds.min));
        let registered = contract.storage_deposit(None, Some(true));
        assert_eq!(registered.total, bounds.min);
        assert!(registered.available.is_zero());
        assert_eq!(
            contract.storage_balance_of(user).unwrap().total,
            registered.total
        );
    }

    #[test]
    fn third_party_registration_refunds_excess_to_payer() {
        let mut contract = contract();
        let payer = account("sponsor.testnet");
        let user = account("ada.testnet");
        let minimum = contract.storage_balance_bounds().min;
        let excess = NearToken::from_yoctonear(17);
        testing_env!(context(
            &payer,
            NearToken::from_yoctonear(minimum.as_yoctonear() + excess.as_yoctonear())
        ));
        contract.storage_deposit(Some(user.clone()), Some(true));
        assert_eq!(transferred_to(&payer), excess);
    }

    #[test]
    fn repeated_registration_refunds_the_full_deposit() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        let deposit = NearToken::from_yoctonear(23);
        testing_env!(context(&user, deposit));
        contract.storage_deposit(None, Some(true));
        assert_eq!(transferred_to(&user), deposit);
    }

    #[test]
    #[should_panic(expected = "fliq_vault: STORAGE_DEPOSIT_REQUIRED")]
    fn storage_registration_rejects_underpayment() {
        let mut contract = contract();
        let user = account("ada.testnet");
        let minimum = contract.storage_balance_bounds().min.as_yoctonear();
        testing_env!(context(
            &user,
            NearToken::from_yoctonear(minimum.saturating_sub(1))
        ));
        contract.storage_deposit(None, Some(true));
    }

    #[test]
    fn empty_account_can_unregister_and_register_again() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        let minimum = contract.storage_balance_bounds().min;
        testing_env!(context(&user, NearToken::from_yoctonear(1)));
        assert!(contract.storage_unregister(None));
        assert!(contract.storage_balance_of(user.clone()).is_none());
        assert_eq!(transferred_to(&user), minimum);
        testing_env!(context(&user, minimum));
        contract.storage_deposit(None, Some(true));
        assert!(contract.storage_balance_of(user).is_some());
    }

    #[test]
    fn unregistering_an_unknown_account_returns_false() {
        let mut contract = contract();
        let user = account("ada.testnet");
        testing_env!(context(&user, NearToken::from_yoctonear(1)));
        assert!(!contract.storage_unregister(None));
        assert!(get_created_receipts().is_empty());
    }

    #[test]
    fn zero_storage_withdraw_reports_the_unchanged_balance() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        let minimum = contract.storage_balance_bounds().min;
        testing_env!(context(&user, NearToken::from_yoctonear(1)));
        let balance = contract.storage_withdraw(Some(NearToken::from_yoctonear(0)));
        assert_eq!(balance.total, minimum);
        assert!(get_created_receipts().is_empty());
    }

    #[test]
    #[should_panic(expected = "fliq_vault: STORAGE_WITHDRAWAL_UNAVAILABLE")]
    fn positive_storage_withdraw_is_rejected() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(&user, NearToken::from_yoctonear(1)));
        contract.storage_withdraw(Some(NearToken::from_yoctonear(1)));
    }

    #[test]
    #[should_panic(expected = "fliq_vault: ACCOUNT_BALANCE_NONZERO")]
    fn funded_account_cannot_unregister_storage() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        returned_amount(contract.ft_on_transfer(user.clone(), U128(1), String::new()));
        testing_env!(context(&user, NearToken::from_yoctonear(1)));
        contract.storage_unregister(None);
    }

    #[test]
    #[should_panic(expected = "fliq_vault: ACCOUNT_BALANCE_NONZERO")]
    fn force_cannot_burn_a_funded_vault_account() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        returned_amount(contract.ft_on_transfer(user.clone(), U128(1), String::new()));
        testing_env!(context(&user, NearToken::from_yoctonear(1)));
        contract.storage_unregister(Some(true));
    }

    #[test]
    fn users_have_isolated_balances() {
        let mut contract = contract();
        let ada = account("ada.testnet");
        let ben = account("ben.testnet");
        register(&mut contract, &ada);
        register(&mut contract, &ben);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        assert_eq!(
            returned_amount(contract.ft_on_transfer(ada.clone(), U128(100_000_000), String::new())),
            U128(0)
        );
        assert_eq!(
            returned_amount(contract.ft_on_transfer(ben.clone(), U128(50_000_000), String::new())),
            U128(0)
        );
        assert_eq!(contract.get_balance(ada).available, U128(100_000_000));
        assert_eq!(contract.get_balance(ben).available, U128(50_000_000));
    }

    #[test]
    fn balance_overflow_returns_deposit() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        assert_eq!(
            returned_amount(contract.ft_on_transfer(user.clone(), U128(u128::MAX), String::new())),
            U128(0)
        );
        assert_eq!(
            returned_amount(contract.ft_on_transfer(user.clone(), U128(1), String::new())),
            U128(1)
        );
        assert_eq!(contract.get_balance(user).available, U128(u128::MAX));
    }
}
