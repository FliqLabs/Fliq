mod vault;

use near_sdk::json_types::U128;
use near_sdk::{AccountId, NearToken, PanicOnDefault, PromiseOrValue, near};
use vault::{BalanceView, StorageBalance, StorageBalanceBounds, Vault};

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    approved_usdc: AccountId,
    vault: Vault,
}

#[near]
impl Contract {
    #[init]
    #[private]
    pub fn new(approved_usdc: AccountId) -> Self {
        near_sdk::require!(
            near_sdk::env::predecessor_account_id() == near_sdk::env::current_account_id(),
            "initialization may only be called by the vault account"
        );
        Self {
            approved_usdc,
            vault: Vault::new(),
        }
    }

    pub fn get_balance(&self, account_id: AccountId) -> BalanceView {
        self.vault.balance_of(&account_id).into()
    }

    pub fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.vault.storage_balance_bounds()
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.vault.storage_balance_of(&account_id)
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.vault.storage_deposit(account_id, registration_only)
    }

    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.vault.storage_withdraw(amount)
    }

    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.vault.storage_unregister(force)
    }

    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        msg: String,
    ) -> PromiseOrValue<U128> {
        if near_sdk::env::predecessor_account_id() != self.approved_usdc || !msg.is_empty() {
            return PromiseOrValue::Value(amount);
        }

        PromiseOrValue::Value(self.vault.deposit(&sender_id, amount))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{VMContext, testing_env};

    fn account(value: &str) -> AccountId {
        match value.parse() {
            Ok(account_id) => account_id,
            Err(error) => panic!("invalid test account {value}: {error}"),
        }
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
        Contract::new(account("usdc.testnet"))
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

    #[test]
    #[should_panic(expected = "initialization may only be called by the vault account")]
    fn outsider_cannot_initialize_contract() {
        let attacker = account("attacker.testnet");
        testing_env!(context(&attacker, NearToken::from_yoctonear(0)));

        Contract::new(account("fake-token.testnet"));
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
                total: U128(100_000_000),
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

        let unused = contract.ft_on_transfer(
            user.clone(),
            U128(50_000_000),
            r#"{"account_id":"ada.testnet"}"#.to_owned(),
        );

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
        assert_eq!(contract.storage_balance_of(user), Some(registered));
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

        let unused = contract.ft_on_transfer(user.clone(), U128(1), String::new());

        assert_eq!(returned_amount(unused), U128(1));
        assert_eq!(contract.get_balance(user).available, U128(u128::MAX));
    }
}
