use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::{Deserialize, Serialize};
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise, PromiseError};

const STORAGE_MINIMUM: NearToken = NearToken::from_millinear(1);
const TRANSFER_GAS: Gas = Gas::from_tgas(30);
const CALLBACK_GAS: Gas = Gas::from_tgas(20);

#[derive(Serialize, Deserialize, Clone, Copy)]
#[serde(crate = "near_sdk::serde")]
pub struct MockStorageBalance {
    pub total: U128,
    pub available: U128,
}

#[near(contract_state)]
pub struct MockUsdc {
    balances: LookupMap<AccountId, u128>,
    storage: LookupMap<AccountId, NearToken>,
    owner: Option<AccountId>,
    total_supply: u128,
    failing: bool,
}

impl Default for MockUsdc {
    fn default() -> Self {
        Self {
            balances: LookupMap::new(b"balances".as_slice()),
            storage: LookupMap::new(b"storage".as_slice()),
            owner: None,
            total_supply: 0,
            failing: false,
        }
    }
}

#[near]
impl MockUsdc {
    #[init]
    pub fn new() -> Self {
        Self::default()
    }

    pub fn ft_total_supply(&self) -> U128 {
        U128(self.total_supply)
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        U128(self.balances.get(&account_id).unwrap_or(0))
    }

    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        self.require_owner_or_claim();
        require!(amount.0 > 0, "mock mint amount must be positive");
        self.add_balance(&account_id, amount.0);
        self.total_supply = self
            .total_supply
            .checked_add(amount.0)
            .unwrap_or_else(|| env::panic_str("mock total supply overflow"));
    }

    pub fn set_failing(&mut self, failing: bool) {
        self.require_owner();
        self.failing = failing;
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        _registration_only: Option<bool>,
    ) -> MockStorageBalance {
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        if self.storage.get(&account_id).is_none() {
            require!(
                env::attached_deposit() >= STORAGE_MINIMUM,
                "storage deposit is too small"
            );
            self.storage.insert(&account_id, &STORAGE_MINIMUM);
            self.refund_excess(STORAGE_MINIMUM);
        } else {
            self.refund_excess(NearToken::from_yoctonear(0));
        }
        self.storage_balance(&account_id)
    }

    #[payable]
    pub fn storage_withdraw(&mut self, amount: Option<U128>) -> MockStorageBalance {
        self.require_one_yocto();
        require!(
            amount.unwrap_or(U128(0)).0 == 0,
            "storage withdrawal unavailable"
        );
        self.storage_balance(&env::predecessor_account_id())
    }

    #[payable]
    pub fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.require_one_yocto();
        let account_id = env::predecessor_account_id();
        require!(
            self.ft_balance_of(account_id.clone()).0 == 0 || force.unwrap_or(false),
            "account has a non-zero balance"
        );
        self.storage.remove(&account_id).is_some()
    }

    pub fn storage_balance_bounds(&self) -> (U128, U128) {
        let minimum = U128(STORAGE_MINIMUM.as_yoctonear());
        (minimum, minimum)
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<MockStorageBalance> {
        self.storage
            .get(&account_id)
            .map(|_| self.storage_balance(&account_id))
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, _memo: Option<String>) {
        self.require_one_yocto();
        self.require_not_failing();
        let sender_id = env::predecessor_account_id();
        self.move_balance(&sender_id, &receiver_id, amount.0);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> Promise {
        self.require_one_yocto();
        self.require_not_failing();
        let _ = memo;
        let sender_id = env::predecessor_account_id();
        self.move_balance(&sender_id, &receiver_id, amount.0);
        let receiver_args = near_sdk::serde_json::json!({
            "sender_id": sender_id,
            "amount": amount,
            "msg": msg,
        });
        let callback_args = near_sdk::serde_json::json!({
            "sender_id": sender_id,
            "receiver_id": receiver_id,
            "amount": amount,
        });
        Promise::new(receiver_id)
            .function_call(
                "ft_on_transfer".to_string(),
                near_sdk::serde_json::to_vec(&receiver_args).unwrap_or_else(|_| {
                    env::panic_str("mock transfer arguments could not be encoded")
                }),
                NearToken::from_yoctonear(0),
                TRANSFER_GAS,
            )
            .then(Promise::new(env::current_account_id()).function_call(
                "resolve_transfer".to_string(),
                near_sdk::serde_json::to_vec(&callback_args).unwrap_or_else(|_| {
                    env::panic_str("mock callback arguments could not be encoded")
                }),
                NearToken::from_yoctonear(0),
                CALLBACK_GAS,
            ))
    }

    #[private]
    pub fn resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
        #[callback_result] result: Result<U128, PromiseError>,
    ) -> U128 {
        let refund = result
            .map(|value| value.0)
            .unwrap_or(amount.0)
            .min(amount.0);
        if refund > 0 {
            self.move_balance(&receiver_id, &sender_id, refund);
        }
        U128(refund)
    }
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId, NearToken, VMContext};

    fn account(value: &str) -> AccountId {
        value
            .parse()
            .unwrap_or_else(|_| panic!("invalid account {value}"))
    }

    fn context(predecessor: &AccountId, deposit: NearToken) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("usdc.testnet"))
            .predecessor_account_id(predecessor.clone())
            .attached_deposit(deposit)
            .build()
    }

    #[test]
    fn default_state_can_mint_without_initialization() {
        let owner = account("owner.testnet");
        let recipient = account("alice.testnet");
        testing_env!(context(&owner, NearToken::from_yoctonear(0)));
        let mut token = MockUsdc::default();

        token.mint(recipient.clone(), U128(50));

        assert_eq!(token.ft_total_supply(), U128(50));
        assert_eq!(token.ft_balance_of(recipient), U128(50));
    }

    #[test]
    fn storage_deposit_registers_account() {
        let owner = account("owner.testnet");
        testing_env!(context(&owner, STORAGE_MINIMUM));
        let mut token = MockUsdc::default();

        let balance = token.storage_deposit(None, Some(true));

        assert_eq!(balance.total, U128(STORAGE_MINIMUM.as_yoctonear()));
        assert_eq!(
            token.storage_balance_of(owner).map(|value| value.total),
            Some(balance.total)
        );
    }

    #[test]
    fn ft_transfer_moves_tokens_with_nep141_arguments() {
        let owner = account("owner.testnet");
        let sender = account("sender.testnet");
        let receiver = account("receiver.testnet");
        testing_env!(context(&owner, NearToken::from_yoctonear(0)));
        let mut token = MockUsdc::default();
        token.mint(sender.clone(), U128(50));

        testing_env!(context(&sender, NearToken::from_yoctonear(1)));
        token.ft_transfer(receiver.clone(), U128(12), Some("memo".to_owned()));

        assert_eq!(token.ft_balance_of(sender), U128(38));
        assert_eq!(token.ft_balance_of(receiver), U128(12));
    }

    #[test]
    fn ft_transfer_call_refunds_receiver_return() {
        let owner = account("owner.testnet");
        let sender = account("sender.testnet");
        let receiver = account("receiver.testnet");
        testing_env!(context(&owner, NearToken::from_yoctonear(0)));
        let mut token = MockUsdc::default();
        token.mint(sender.clone(), U128(50));

        testing_env!(context(&sender, NearToken::from_yoctonear(1)));
        let _promise = token.ft_transfer_call(
            receiver.clone(),
            U128(12),
            None,
            "{\"top_up\":{}}".to_owned(),
        );
        token.resolve_transfer(sender.clone(), receiver.clone(), U128(12), Ok(U128(5)));

        assert_eq!(token.ft_balance_of(sender), U128(43));
        assert_eq!(token.ft_balance_of(receiver), U128(7));
    }

    #[test]
    fn failing_mode_blocks_transfers() {
        let owner = account("owner.testnet");
        let sender = account("sender.testnet");
        let receiver = account("receiver.testnet");
        testing_env!(context(&owner, NearToken::from_yoctonear(0)));
        let mut token = MockUsdc::default();
        token.mint(sender.clone(), U128(50));
        token.set_failing(true);

        testing_env!(context(&sender, NearToken::from_yoctonear(1)));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            token.ft_transfer(receiver, U128(1), None);
        }));

        assert!(result.is_err());
        assert_eq!(token.ft_balance_of(sender), U128(50));
    }
}

impl MockUsdc {
    fn require_owner_or_claim(&mut self) {
        let predecessor = env::predecessor_account_id();
        match &self.owner {
            Some(owner) => require!(*owner == predecessor, "mock owner only"),
            None => self.owner = Some(predecessor),
        }
    }

    fn require_owner(&self) {
        require!(
            self.owner.as_ref() == Some(&env::predecessor_account_id()),
            "mock owner only"
        );
    }

    fn require_one_yocto(&self) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "exactly 1 yoctoNEAR is required"
        );
    }

    fn require_not_failing(&self) {
        require!(!self.failing, "mock USDC transfer failed");
    }

    fn add_balance(&mut self, account_id: &AccountId, amount: u128) {
        let balance = self.balances.get(account_id).unwrap_or(0);
        let updated = balance
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("mock balance overflow"));
        self.balances.insert(account_id, &updated);
    }

    fn move_balance(&mut self, sender_id: &AccountId, receiver_id: &AccountId, amount: u128) {
        require!(amount > 0, "mock transfer amount must be positive");
        require!(
            sender_id != receiver_id,
            "mock transfer to self is not allowed"
        );
        let sender_balance = self.balances.get(sender_id).unwrap_or(0);
        require!(
            sender_balance >= amount,
            "mock USDC balance is insufficient"
        );
        self.balances.insert(sender_id, &(sender_balance - amount));
        self.add_balance(receiver_id, amount);
    }

    fn storage_balance(&self, account_id: &AccountId) -> MockStorageBalance {
        MockStorageBalance {
            total: U128(
                self.storage
                    .get(account_id)
                    .unwrap_or_else(|| NearToken::from_yoctonear(0))
                    .as_yoctonear(),
            ),
            available: U128(0),
        }
    }

    fn refund_excess(&self, retained: NearToken) {
        let attached = env::attached_deposit();
        if attached > retained {
            Promise::new(env::predecessor_account_id())
                .transfer(attached.saturating_sub(retained))
                .detach();
        }
    }
}
