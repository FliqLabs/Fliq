mod events;
mod models;
mod vault;

use events::FliqVaultEvent;
use models::{
    Config, MAX_ORDER_TTL_NS, OrderState, PayoutOrder, ReceiptRecord, ReceiptRefs, ReceiptView,
    StorageKey,
};
use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::{LookupMap, LookupSet};
use near_sdk::json_types::U128;
use near_sdk::serde::Deserialize;
use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseError, PromiseOrValue, env,
    ext_contract, near,
};
use vault::{BalanceView, RefundError, ReservationError, TransferError, Vault};

const FT_TRANSFER_GAS: Gas = Gas::from_tgas(30);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);
const FT_BALANCE_GAS: Gas = Gas::from_tgas(10);
const MAX_ORDER_ID_LENGTH: usize = 64;
const MAX_CORRIDOR_LENGTH: usize = 64;
const MAX_REF_LENGTH: usize = 256;

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

#[ext_contract(ext_ft)]
#[allow(dead_code)]
trait ExtFungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>);
    fn ft_balance_of(&self, account_id: AccountId) -> U128;
}

#[ext_contract(ext_self)]
#[allow(dead_code)]
trait ExtSelf {
    fn on_payout_complete(&mut self, order_id: String, public_key: String);
    fn on_recredit_balance(&mut self, order_id: String, amount: U128);
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    config: Config,
    vault: Vault,
    orders: LookupMap<String, PayoutOrder>,
    receipts: LookupMap<String, ReceiptRecord>,
    payouts_pending: LookupSet<String>,
    used_refund_transactions: LookupSet<String>,
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
        Self {
            config: Config {
                owner,
                registration_account,
                approved_usdc_token_contract,
                max_order_ttl_ns: MAX_ORDER_TTL_NS,
            },
            vault: Vault::new(),
            orders: LookupMap::new(StorageKey::Orders),
            receipts: LookupMap::new(StorageKey::Receipts),
            payouts_pending: LookupSet::new(StorageKey::PayoutsPending),
            used_refund_transactions: LookupSet::new(StorageKey::UsedRefundTransactions),
        }
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn get_balance(&self, account_id: AccountId) -> BalanceView {
        self.vault.balance_of(&account_id).into()
    }

    pub fn get_receipt(&self, order_id: String) -> Option<ReceiptView> {
        let order = self.orders.get(&order_id)?;
        Some(ReceiptView::from_records(
            order,
            self.receipts.get(&order_id).unwrap_or_default(),
        ))
    }

    pub fn get_policy(&self, _public_key: String) -> Option<String> {
        None
    }

    pub fn register_order(
        &mut self,
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: U128,
        expires_at_ns: String,
        corridor: String,
    ) {
        self.require_registration_account();
        self.validate_order(&order_id, amount.0, &corridor);
        if self.orders.contains_key(&order_id) {
            fail("ORDER_EXISTS");
        }
        let expires_at_ns = match expires_at_ns.parse::<u64>() {
            Ok(value) => value,
            Err(_) => fail("INVALID_EXPIRY"),
        };
        let now = env::block_timestamp();
        let Some(max_expiry) = now.checked_add(self.config.max_order_ttl_ns) else {
            fail("INVALID_EXPIRY")
        };
        if expires_at_ns <= now || expires_at_ns > max_expiry {
            fail("INVALID_EXPIRY");
        }
        self.reserve(&order_id, &payer, amount.0);
        let order = PayoutOrder {
            order_id: order_id.clone(),
            payer: payer.clone(),
            deposit_address: deposit_address.clone(),
            amount: amount.0,
            expires_at_ns,
            corridor: corridor.clone(),
            state: OrderState::Registered,
        };
        self.orders.insert(&order_id, &order);
        self.receipts.insert(&order_id, &ReceiptRecord::default());
        FliqVaultEvent::OrderRegistered {
            order_id,
            payer,
            deposit_address,
            amount: amount.0.to_string(),
            expires_at_ns: expires_at_ns.to_string(),
            corridor,
        }
        .emit();
    }

    pub fn payout(&mut self, order_id: String) -> Promise {
        let Some(order) = self.orders.get(&order_id) else {
            fail("ORDER_NOT_FOUND");
        };
        if order.state != OrderState::Registered || self.payouts_pending.contains(&order_id) {
            fail("ORDER_NOT_REGISTERED");
        }
        if env::block_timestamp() >= order.expires_at_ns {
            fail("ORDER_EXPIRED");
        }
        if env::predecessor_account_id() != order.payer {
            fail("UNAUTHORIZED");
        }
        self.payouts_pending.insert(&order_id);
        let public_key = env::signer_account_pk().to_string();
        ext_ft::ext(self.config.approved_usdc_token_contract.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(FT_TRANSFER_GAS)
            .ft_transfer(
                order.deposit_address,
                U128(order.amount),
                Some(order.order_id.clone()),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_payout_complete(order_id, public_key),
            )
    }

    pub fn release_order(&mut self, order_id: String) {
        let Some(mut order) = self.orders.get(&order_id) else {
            fail("ORDER_NOT_FOUND")
        };
        if order.state != OrderState::Registered || self.payouts_pending.contains(&order_id) {
            fail("ORDER_NOT_REGISTERED");
        }
        let caller = env::predecessor_account_id();
        if caller != self.config.registration_account {
            if caller != order.payer {
                fail("UNAUTHORIZED");
            }
            if env::block_timestamp() < order.expires_at_ns {
                fail("ORDER_NOT_EXPIRED");
            }
        }
        self.release(&order_id);
        order.state = OrderState::Released;
        self.orders.insert(&order_id, &order);
        FliqVaultEvent::OrderReleased {
            order_id,
            payer: order.payer,
            amount: order.amount.to_string(),
        }
        .emit();
    }

    pub fn set_status(&mut self, order_id: String, status: String, refs: ReceiptRefs) {
        self.require_registration_account();
        let Some(order) = self.orders.get(&order_id) else {
            fail("ORDER_NOT_FOUND")
        };
        if order.state != OrderState::Executed {
            fail("INVALID_TRANSITION");
        }
        self.validate_refs(&refs);
        let mut receipt = self.receipts.get(&order_id).unwrap_or_default();
        let same_status = receipt.status.as_deref() == Some(status.as_str());
        let refs_changed = match receipt.refs.merge_once(refs) {
            Ok(changed) => changed,
            Err(()) => fail("INVALID_TRANSITION"),
        };
        if same_status {
            if refs_changed {
                fail("INVALID_TRANSITION");
            }
            return;
        }
        if !valid_status_transition(receipt.status.as_deref(), &status) {
            fail("INVALID_TRANSITION");
        }
        receipt.status = Some(status.clone());
        let event_refs = receipt.refs.clone();
        self.receipts.insert(&order_id, &receipt);
        FliqVaultEvent::StatusSet {
            order_id,
            status,
            refs: event_refs,
        }
        .emit();
    }

    pub fn recredit(&mut self, order_id: String, amount: U128) -> Promise {
        self.require_registration_account();
        let Some(order) = self.orders.get(&order_id) else {
            fail("ORDER_NOT_FOUND");
        };
        let receipt = self.receipts.get(&order_id).unwrap_or_default();
        if order.state != OrderState::Executed || receipt.status.as_deref() != Some("refunding") {
            fail("NOT_REFUNDABLE");
        }
        let Some(refund_tx) = receipt.refs.refund_tx.as_ref() else {
            fail("NOT_REFUNDABLE");
        };
        if self.used_refund_transactions.contains(refund_tx) {
            fail("ALREADY_RECREDITED");
        }
        if receipt.recredited_amount != 0 {
            fail("ALREADY_RECREDITED");
        }
        if amount.0 == 0 {
            fail("INVALID_AMOUNT");
        }
        if amount.0 > order.amount {
            fail("RECREDIT_EXCEEDS_ORDER");
        }
        ext_ft::ext(self.config.approved_usdc_token_contract.clone())
            .with_static_gas(FT_BALANCE_GAS)
            .ft_balance_of(env::current_account_id())
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(CALLBACK_GAS)
                    .on_recredit_balance(order_id, amount),
            )
    }

    pub fn transfer(&mut self, to_account: AccountId, amount: U128) {
        let from = env::predecessor_account_id();
        match self.vault.transfer_available(&from, &to_account, amount.0) {
            Ok(()) => {}
            Err(TransferError::AmountMustBePositive | TransferError::ArithmeticOverflow) => {
                fail("INVALID_AMOUNT")
            }
            Err(TransferError::InsufficientBalance) => fail("INSUFFICIENT_BALANCE"),
            Err(
                TransferError::SameAccount
                | TransferError::SenderNotRegistered
                | TransferError::RecipientNotRegistered,
            ) => fail("UNAUTHORIZED"),
        }
        FliqVaultEvent::Transferred {
            from,
            to: to_account,
            amount: amount.0.to_string(),
        }
        .emit();
    }

    #[private]
    pub fn on_payout_complete(
        &mut self,
        order_id: String,
        public_key: String,
        #[callback_result] result: Result<(), PromiseError>,
    ) {
        if !self.payouts_pending.remove(&order_id) || result.is_err() {
            return;
        }
        let Some(mut order) = self.orders.get(&order_id) else {
            return;
        };
        if order.state != OrderState::Registered {
            return;
        }
        self.commit(&order_id);
        order.state = OrderState::Executed;
        self.orders.insert(&order_id, &order);
        FliqVaultEvent::PayoutExecuted {
            order_id,
            payer: order.payer,
            deposit_address: order.deposit_address,
            amount: order.amount.to_string(),
            public_key,
        }
        .emit();
    }

    #[private]
    pub fn on_recredit_balance(
        &mut self,
        order_id: String,
        amount: U128,
        #[callback_result] result: Result<U128, PromiseError>,
    ) -> bool {
        let Ok(actual_balance) = result else {
            return false;
        };
        let Some(order) = self.orders.get(&order_id) else {
            return false;
        };
        let mut receipt = self.receipts.get(&order_id).unwrap_or_default();
        if order.state != OrderState::Executed
            || receipt.status.as_deref() != Some("refunding")
            || receipt.recredited_amount != 0
        {
            return false;
        }
        let Some(refund_tx) = receipt.refs.refund_tx.clone() else {
            return false;
        };
        if self.used_refund_transactions.contains(&refund_tx) {
            fail("ALREADY_RECREDITED");
        }
        match self
            .vault
            .recredit_refund(&order_id, amount.0, actual_balance.0)
        {
            Ok(()) => {}
            Err(RefundError::AlreadyRecredited) => fail("ALREADY_RECREDITED"),
            Err(RefundError::ExceedsOutflow) => fail("RECREDIT_EXCEEDS_ORDER"),
            Err(RefundError::ExceedsUnallocatedBalance | RefundError::Underbacked) => {
                fail("RECREDIT_EXCEEDS_UNATTRIBUTED")
            }
            Err(
                RefundError::AmountMustBePositive
                | RefundError::ArithmeticOverflow
                | RefundError::PayerNotRegistered,
            ) => fail("INVALID_AMOUNT"),
            Err(RefundError::NotFound) => fail("NOT_REFUNDABLE"),
        }
        self.used_refund_transactions.insert(&refund_tx);
        receipt.recredited_amount = amount.0;
        receipt.status = Some("refunded".to_owned());
        let event_refs = receipt.refs.clone();
        self.receipts.insert(&order_id, &receipt);
        FliqVaultEvent::StatusSet {
            order_id,
            status: "refunded".to_owned(),
            refs: event_refs,
        }
        .emit();
        true
    }

    #[cfg(feature = "testing")]
    pub fn credit_for_testing(&mut self, account_id: AccountId, amount: U128) {
        if self.vault.deposit(&account_id, amount).0 != 0 {
            fail("INSUFFICIENT_BALANCE");
        }
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
        if env::predecessor_account_id() != self.config.approved_usdc_token_contract
            || amount.0 == 0
        {
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
    fn require_registration_account(&self) {
        if env::predecessor_account_id() != self.config.registration_account {
            fail("UNAUTHORIZED");
        }
    }

    fn validate_order(&self, order_id: &str, amount: u128, corridor: &str) {
        if amount == 0 {
            fail("INVALID_AMOUNT");
        }
        if order_id.is_empty()
            || order_id.len() > MAX_ORDER_ID_LENGTH
            || !order_id.is_ascii()
            || corridor.is_empty()
            || corridor.len() > MAX_CORRIDOR_LENGTH
            || !corridor.is_ascii()
        {
            fail("INVALID_AMOUNT");
        }
    }

    fn validate_refs(&self, refs: &ReceiptRefs) {
        if refs
            .values()
            .any(|value| value.is_empty() || value.len() > MAX_REF_LENGTH || !value.is_ascii())
        {
            fail("INVALID_TRANSITION");
        }
    }

    fn reserve(&mut self, order_id: &str, payer: &AccountId, amount: u128) {
        match self.vault.reserve_for_order(order_id, payer, amount) {
            Ok(()) => {}
            Err(ReservationError::AlreadyExists) => fail("ORDER_EXISTS"),
            Err(ReservationError::InsufficientBalance) => fail("INSUFFICIENT_BALANCE"),
            Err(ReservationError::AmountMustBePositive | ReservationError::ArithmeticOverflow) => {
                fail("INVALID_AMOUNT")
            }
            Err(ReservationError::NotFound) => fail("ORDER_NOT_FOUND"),
        }
    }

    fn commit(&mut self, order_id: &str) {
        if self.vault.commit_outflow(order_id).is_err() {
            fail("ORDER_NOT_REGISTERED");
        }
    }
    fn release(&mut self, order_id: &str) {
        if self.vault.release_reservation(order_id).is_err() {
            fail("ORDER_NOT_REGISTERED");
        }
    }

    fn deposit_beneficiary(sender_id: &AccountId, msg: &str) -> Option<AccountId> {
        if msg.is_empty() {
            return Some(sender_id.clone());
        }
        near_sdk::serde_json::from_str::<TransferMessage>(msg)
            .ok()
            .map(|message| message.top_up.account_id)
    }

    fn log_deposit(account_id: &AccountId, sender_id: &AccountId, amount: U128) {
        let event = near_sdk::serde_json::json!({"standard":"fliq_vault","version":"1.0.0","event":"deposited","data":[{"account_id":account_id,"sender_id":sender_id,"amount":amount}]});
        env::log_str(&format!("EVENT_JSON:{event}"));
    }
}

fn valid_status_transition(current: Option<&str>, next: &str) -> bool {
    match current {
        None => matches!(
            next,
            "routing" | "with_provider" | "paying_out" | "settled" | "refunding" | "failed"
        ),
        Some("routing") => matches!(
            next,
            "with_provider" | "paying_out" | "settled" | "refunding" | "failed"
        ),
        Some("with_provider") => matches!(next, "paying_out" | "settled" | "refunding" | "failed"),
        Some("paying_out") => matches!(next, "settled" | "refunding" | "failed"),
        Some("refunding") => next == "failed",
        Some("settled" | "refunded" | "failed") | Some(_) => false,
    }
}

fn fail(code: &str) -> ! {
    env::panic_str(&format!("fliq_vault: {code}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{VMContext, testing_env};

    const NOW: u64 = 10_000_000_000;

    fn account(value: &str) -> AccountId {
        value
            .parse()
            .unwrap_or_else(|error| panic!("invalid test account: {error}"))
    }

    fn context(predecessor: &AccountId, timestamp: u64, deposit: NearToken) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("vault.testnet"))
            .predecessor_account_id(predecessor.clone())
            .signer_account_id(predecessor.clone())
            .block_timestamp(timestamp)
            .attached_deposit(deposit)
            .build()
    }

    fn contract() -> Contract {
        let vault = account("vault.testnet");
        testing_env!(context(&vault, NOW, NearToken::from_yoctonear(0)));
        Contract::new(
            account("owner.testnet"),
            account("registrar.testnet"),
            account("usdc.testnet"),
        )
    }

    fn register_account(contract: &mut Contract, account_id: &AccountId) {
        let minimum = contract.storage_balance_bounds().min;
        testing_env!(context(account_id, NOW, minimum));
        contract.storage_deposit(None, Some(true));
    }

    fn credit(contract: &mut Contract, account_id: &AccountId, amount: u128) {
        assert_eq!(contract.vault.deposit(account_id, U128(amount)), U128(0));
    }

    fn register_order(contract: &mut Contract, payer: &AccountId, order_id: &str) {
        let registrar = account("registrar.testnet");
        testing_env!(context(&registrar, NOW, NearToken::from_yoctonear(0)));
        contract.register_order(
            order_id.to_owned(),
            payer.clone(),
            account("deposit.testnet"),
            U128(50_000_000),
            (NOW + 1_000_000_000).to_string(),
            "NG-NGN-bank".to_owned(),
        );
    }

    fn execute_order(contract: &mut Contract, payer: &AccountId, order_id: &str) {
        register_order(contract, payer, order_id);
        testing_env!(context(payer, NOW, NearToken::from_yoctonear(0)));
        let _promise = contract.payout(order_id.to_owned());
        let vault = account("vault.testnet");
        testing_env!(context(&vault, NOW, NearToken::from_yoctonear(0)));
        contract.on_payout_complete(order_id.to_owned(), "ed25519:test".to_owned(), Ok(()));
    }

    #[test]
    fn registration_reserves_balance_and_returns_backend_receipt_shape() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 75_000_000);

        register_order(&mut contract, &payer, "order-1");

        assert_eq!(
            contract.get_balance(payer.clone()).available,
            U128(25_000_000)
        );
        assert_eq!(contract.get_balance(payer).reserved, U128(50_000_000));
        let receipt = contract.get_receipt("order-1".to_owned()).expect("receipt");
        assert_eq!(receipt.state, OrderState::Registered);
        assert_eq!(receipt.expires_at_ns, (NOW + 1_000_000_000).to_string());
        assert_eq!(receipt.status, None);
    }

    #[test]
    fn failed_payout_callback_keeps_reservation_retryable() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 50_000_000);
        register_order(&mut contract, &payer, "order-2");
        testing_env!(context(&payer, NOW, NearToken::from_yoctonear(0)));
        let _promise = contract.payout("order-2".to_owned());
        let vault = account("vault.testnet");
        testing_env!(context(&vault, NOW, NearToken::from_yoctonear(0)));

        contract.on_payout_complete(
            "order-2".to_owned(),
            "ed25519:test".to_owned(),
            Err(PromiseError::Failed),
        );

        assert_eq!(contract.get_balance(payer).reserved, U128(50_000_000));
        assert_eq!(
            contract
                .get_receipt("order-2".to_owned())
                .expect("receipt")
                .state,
            OrderState::Registered
        );
    }

    #[test]
    fn successful_payout_commits_reserved_balance() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 50_000_000);
        register_order(&mut contract, &payer, "order-3");
        testing_env!(context(&payer, NOW, NearToken::from_yoctonear(0)));
        let _promise = contract.payout("order-3".to_owned());
        let vault = account("vault.testnet");
        testing_env!(context(&vault, NOW, NearToken::from_yoctonear(0)));

        contract.on_payout_complete("order-3".to_owned(), "ed25519:test".to_owned(), Ok(()));

        assert_eq!(contract.get_balance(payer).total, U128(0));
        assert_eq!(
            contract
                .get_receipt("order-3".to_owned())
                .expect("receipt")
                .state,
            OrderState::Executed
        );
    }

    #[test]
    fn registrar_release_restores_available_balance() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 50_000_000);
        register_order(&mut contract, &payer, "order-4");
        let registrar = account("registrar.testnet");
        testing_env!(context(&registrar, NOW, NearToken::from_yoctonear(0)));

        contract.release_order("order-4".to_owned());

        assert_eq!(contract.get_balance(payer).available, U128(50_000_000));
        assert_eq!(
            contract
                .get_receipt("order-4".to_owned())
                .expect("receipt")
                .state,
            OrderState::Released
        );
    }

    #[test]
    fn vault_transfer_moves_only_available_balance() {
        let mut contract = contract();
        let sender = account("sender.testnet");
        let recipient = account("recipient.testnet");
        register_account(&mut contract, &sender);
        register_account(&mut contract, &recipient);
        credit(&mut contract, &sender, 90_000_000);
        testing_env!(context(&sender, NOW, NearToken::from_yoctonear(0)));

        contract.transfer(recipient.clone(), U128(40_000_000));

        assert_eq!(contract.get_balance(sender).available, U128(50_000_000));
        assert_eq!(contract.get_balance(recipient).available, U128(40_000_000));
        assert_eq!(contract.vault.total_liabilities(), 90_000_000);
    }

    #[test]
    fn refund_recredit_requires_evidence_status_and_backing() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 50_000_000);
        register_order(&mut contract, &payer, "order-5");
        testing_env!(context(&payer, NOW, NearToken::from_yoctonear(0)));
        let _promise = contract.payout("order-5".to_owned());
        let vault = account("vault.testnet");
        testing_env!(context(&vault, NOW, NearToken::from_yoctonear(0)));
        contract.on_payout_complete("order-5".to_owned(), "ed25519:test".to_owned(), Ok(()));
        let registrar = account("registrar.testnet");
        testing_env!(context(&registrar, NOW, NearToken::from_yoctonear(0)));
        contract.set_status(
            "order-5".to_owned(),
            "refunding".to_owned(),
            ReceiptRefs {
                refund_tx: Some("refund-1".to_owned()),
                ..ReceiptRefs::default()
            },
        );
        testing_env!(context(&vault, NOW, NearToken::from_yoctonear(0)));

        assert!(contract.on_recredit_balance(
            "order-5".to_owned(),
            U128(50_000_000),
            Ok(U128(50_000_000))
        ));

        let receipt = contract.get_receipt("order-5".to_owned()).expect("receipt");
        assert_eq!(receipt.status.as_deref(), Some("refunded"));
        assert_eq!(receipt.recredited_amount, U128(50_000_000));
        assert_eq!(contract.get_balance(payer).available, U128(50_000_000));
    }

    #[test]
    fn shared_event_fixture_covers_every_contract_event() {
        let fixture = include_str!("../tests/fixtures/events.jsonl");
        let mut names = std::collections::BTreeSet::new();
        for line in fixture.lines() {
            let value: near_sdk::serde_json::Value = near_sdk::serde_json::from_str(line)
                .unwrap_or_else(|error| panic!("invalid event fixture: {error}"));
            assert_eq!(value["standard"], "fliq_vault");
            assert_eq!(value["version"], "1.0.0");
            let Some(name) = value["event"].as_str() else {
                panic!("event fixture is missing its name");
            };
            names.insert(name.to_owned());
        }
        assert_eq!(
            names,
            std::collections::BTreeSet::from([
                "deposited",
                "order_registered",
                "order_released",
                "payout_executed",
                "recredited",
                "status_set",
                "transferred",
            ])
            .into_iter()
            .map(str::to_owned)
            .collect()
        );
    }

    #[test]
    #[should_panic(expected = "fliq_vault: INVALID_TRANSITION")]
    fn registrar_cannot_mark_an_order_refunded() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 50_000_000);
        execute_order(&mut contract, &payer, "order-refunded");
        let registrar = account("registrar.testnet");
        testing_env!(context(&registrar, NOW, NearToken::from_yoctonear(0)));
        contract.set_status(
            "order-refunded".to_owned(),
            "refunding".to_owned(),
            ReceiptRefs {
                refund_tx: Some("refund-evidence".to_owned()),
                ..ReceiptRefs::default()
            },
        );

        contract.set_status(
            "order-refunded".to_owned(),
            "refunded".to_owned(),
            ReceiptRefs::default(),
        );
    }

    #[test]
    #[should_panic(expected = "fliq_vault: INVALID_TRANSITION")]
    fn receipt_reference_cannot_be_changed() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 50_000_000);
        execute_order(&mut contract, &payer, "order-refs");
        let registrar = account("registrar.testnet");
        testing_env!(context(&registrar, NOW, NearToken::from_yoctonear(0)));
        contract.set_status(
            "order-refs".to_owned(),
            "routing".to_owned(),
            ReceiptRefs {
                provider: Some("provider-a".to_owned()),
                ..ReceiptRefs::default()
            },
        );

        contract.set_status(
            "order-refs".to_owned(),
            "with_provider".to_owned(),
            ReceiptRefs {
                provider: Some("provider-b".to_owned()),
                ..ReceiptRefs::default()
            },
        );
    }

    #[test]
    #[should_panic(expected = "fliq_vault: ALREADY_RECREDITED")]
    fn refund_transaction_cannot_back_two_orders() {
        let mut contract = contract();
        let payer = account("payer.testnet");
        register_account(&mut contract, &payer);
        credit(&mut contract, &payer, 100_000_000);
        execute_order(&mut contract, &payer, "order-refund-a");
        execute_order(&mut contract, &payer, "order-refund-b");
        let registrar = account("registrar.testnet");
        testing_env!(context(&registrar, NOW, NearToken::from_yoctonear(0)));
        let evidence = ReceiptRefs {
            refund_tx: Some("shared-refund-tx".to_owned()),
            ..ReceiptRefs::default()
        };
        contract.set_status(
            "order-refund-a".to_owned(),
            "refunding".to_owned(),
            evidence.clone(),
        );
        contract.set_status(
            "order-refund-b".to_owned(),
            "refunding".to_owned(),
            evidence,
        );
        let vault = account("vault.testnet");
        testing_env!(context(&vault, NOW, NearToken::from_yoctonear(0)));
        assert!(contract.on_recredit_balance(
            "order-refund-a".to_owned(),
            U128(25_000_000),
            Ok(U128(25_000_000)),
        ));
        testing_env!(context(&registrar, NOW, NearToken::from_yoctonear(0)));

        let _promise = contract.recredit("order-refund-b".to_owned(), U128(25_000_000));
    }
}
