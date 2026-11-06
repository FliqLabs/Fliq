pub mod orders;
pub mod types;

mod integration;
mod receipts;
mod temp_policies;
mod vault;

use near_contract_standards::fungible_token::receiver::FungibleTokenReceiver;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, near, require};

use crate::orders::{set_status as apply_status, validate_deposit_address, validate_order};
use crate::receipts::FliqEvent;
#[cfg(all(feature = "testing", debug_assertions))]
use crate::types::Amount;
use crate::types::{
    Config, DEFAULT_MAX_EXPIRY, DEFAULT_PAYOUT_TIMEOUT, PayoutOrder, Receipt, StorageKey,
    TransferState, now,
};
use crate::vault::{BalanceView, Vault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    approved_usdc: AccountId,
    vault: Vault,
    pub(crate) config: Config,
    pub(crate) orders: LookupMap<String, PayoutOrder>,
    pub(crate) receipts: LookupMap<String, Receipt>,
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
            "initialization may only be called by the vault account"
        );
        require!(
            env::state_read::<Self>().is_none(),
            "contract is already initialized"
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
        }
    }

    pub fn get_balance(&self, account_id: AccountId) -> BalanceView {
        integration::get_balance(&self.vault, &account_id)
    }

    pub fn set_registration_account(&mut self, registration_account: AccountId) {
        require!(
            env::predecessor_account_id() == self.config.owner,
            "only the owner may set registration_account"
        );
        self.config.registration_account = registration_account;
    }

    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    pub fn set_payout_timeout(&mut self, payout_timeout: near_sdk::json_types::U64) {
        require!(
            env::predecessor_account_id() == self.config.owner,
            "only the owner may set payout_timeout"
        );
        require!(
            payout_timeout.0 > 0,
            "payout_timeout must be greater than zero"
        );
        self.config.payout_timeout = payout_timeout;
    }

    pub fn register_order(
        &mut self,
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: U128,
        expiry: near_sdk::json_types::U64,
        corridor: String,
    ) {
        require!(
            env::predecessor_account_id() == self.config.registration_account,
            "only registration_account may register orders"
        );
        validate_order(&order_id, amount.0, &corridor);
        require!(
            !self.orders.contains_key(&order_id),
            "order_id is already registered"
        );
        validate_deposit_address(deposit_address.as_ref());
        let current_time = now();
        require!(expiry.0 > current_time, "expiry must be in the future");
        require!(
            expiry.0 - current_time <= self.config.max_expiry.0,
            "expiry is further ahead than the configured maximum"
        );
        let order = PayoutOrder {
            order_id: order_id.clone(),
            payer,
            deposit_address,
            amount,
            expiry,
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
                refs: String::new(),
                last_updated: now().into(),
            },
        );
        FliqEvent::OrderRegistered {
            order_id,
            amount,
            expiry: expiry.0.to_string(),
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
            "payout must not carry NEAR deposit"
        );
        orders::payout(self, order_id, amount, deposit_address)
    }

    pub fn set_status(&mut self, order_id: String, status: String, refs: String) {
        apply_status(self, order_id, status, refs);
    }

    pub fn get_receipt(&self, order_id: String) -> Receipt {
        match self.receipts.get(&order_id) {
            Some(receipt) => receipt,
            None => env::panic_str("receipt not found for order_id"),
        }
    }

    #[cfg(all(feature = "testing", debug_assertions))]
    pub fn credit_for_testing(&mut self, account: AccountId, amount: Amount) {
        require!(
            self.vault.deposit(&account, U128(amount)).0 == 0,
            "test account must be registered"
        );
    }

    #[private]
    pub fn on_payout_complete(&mut self, order_id: String) {
        require!(
            env::predecessor_account_id() == env::current_account_id(),
            "callback may only be called by this contract"
        );
        require!(
            env::promise_results_count() == 1,
            "payout callback must have exactly one promise result"
        );
        orders::on_payout_complete(self, order_id);
    }

    /// Resolve an execution only after checking on chain whether the USDC transfer happened.
    /// Releasing funds after a real transfer would double pay the order.
    pub fn resolve_stuck_payout(&mut self, order_id: String, transferred: bool) {
        require!(
            env::predecessor_account_id() == self.config.owner,
            "only the owner may resolve a stuck payout"
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
        if env::predecessor_account_id() != self.approved_usdc || !msg.is_empty() {
            return PromiseOrValue::Value(amount);
        }
        PromiseOrValue::Value(self.vault.deposit(&sender_id, amount))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::mock::MockAction;
    use near_sdk::test_utils::{VMContextBuilder, get_created_receipts};
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
    #[should_panic(expected = "initialization may only be called by the vault account")]
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
    fn attributed_message_is_rejected_until_protocol_is_approved() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(
            &account("usdc.testnet"),
            NearToken::from_yoctonear(0)
        ));
        let unused =
            contract.ft_on_transfer(user.clone(), U128(50_000_000), "attributed".to_owned());
        assert_eq!(returned_amount(unused), U128(50_000_000));
        assert_eq!(contract.get_balance(user), BalanceView::default());
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
    #[should_panic(expected = "requires storage deposit of at least")]
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
    #[should_panic(expected = "registered storage has no withdrawable balance")]
    fn positive_storage_withdraw_is_rejected() {
        let mut contract = contract();
        let user = account("ada.testnet");
        register(&mut contract, &user);
        testing_env!(context(&user, NearToken::from_yoctonear(1)));
        contract.storage_withdraw(Some(NearToken::from_yoctonear(1)));
    }

    #[test]
    #[should_panic(expected = "cannot unregister an account with a vault balance")]
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
    #[should_panic(expected = "cannot unregister an account with a vault balance")]
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
