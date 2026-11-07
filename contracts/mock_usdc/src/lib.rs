use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{env, near, require, AccountId, Gas, NearToken, Promise};

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct MockStorageBalance {
    total: U128,
    available: U128,
}

#[near(contract_state)]
pub struct MockUsdc {
    balances: LookupMap<AccountId, u128>,
    storage: LookupMap<AccountId, NearToken>,
    failing: bool,
}

impl Default for MockUsdc {
    fn default() -> Self {
        env::panic_str("mock USDC state is not initialized")
    }
}

#[near]
impl MockUsdc {
    #[init]
    pub fn new() -> Self {
        Self {
            balances: LookupMap::new(b"balances".as_slice()),
            storage: LookupMap::new(b"storage".as_slice()),
            failing: false,
        }
    }

    pub fn set_failing(&mut self, failing: bool) {
        self.failing = failing;
    }

    pub fn credit(&mut self, account: AccountId, amount: u128) {
        let balance = self.balances.get(&account).unwrap_or(0);
        let updated = balance
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("mock balance overflow"));
        self.balances.insert(&account, &updated);
    }

    pub fn mint(&mut self, account: AccountId, amount: U128) {
        self.credit(account, amount.0);
    }

    pub fn balance_of(&self, account: AccountId) -> u128 {
        self.balances.get(&account).unwrap_or(0)
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: String,
        msg: String,
    ) -> Promise {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "exactly 1 yoctoNEAR is required"
        );
        require!(!self.failing, "mock USDC transfer failed");
        let amount = amount
            .parse::<u128>()
            .unwrap_or_else(|_| env::panic_str("mock transfer amount must be an integer"));
        let sender = env::predecessor_account_id();
        let sender_balance = self.balances.get(&sender).unwrap_or(0);
        require!(
            sender_balance >= amount,
            "mock USDC balance is insufficient"
        );
        let receiver_balance = self.balances.get(&receiver_id).unwrap_or(0);
        let receiver_balance = receiver_balance
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("mock balance overflow"));
        self.balances.insert(&sender, &(sender_balance - amount));
        self.balances.insert(&receiver_id, &receiver_balance);
        Promise::new(receiver_id).function_call(
            "ft_on_transfer".to_string(),
            near_sdk::serde_json::to_vec(&near_sdk::serde_json::json!({
                "sender_id": sender,
                "amount": amount.to_string(),
                "msg": msg,
            }))
            .unwrap_or_else(|_| env::panic_str("mock transfer arguments could not be encoded")),
            NearToken::from_yoctonear(0),
            Gas::from_tgas(30),
        )
    }

    #[payable]
    pub fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        _registration_only: Option<bool>,
    ) -> MockStorageBalance {
        let account = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit();
        let minimum = NearToken::from_millinear(1);
        require!(attached >= minimum, "storage deposit is too small");
        self.storage.insert(&account, &minimum);
        if attached > minimum {
            Promise::new(env::predecessor_account_id())
                .transfer(attached.saturating_sub(minimum))
                .detach();
        }
        MockStorageBalance {
            total: U128(minimum.as_yoctonear()),
            available: U128(0),
        }
    }

    #[payable]
    pub fn storage_withdraw(&mut self, _amount: Option<U128>) -> MockStorageBalance {
        env::panic_str("mock storage withdrawal is unavailable")
    }

    #[payable]
    pub fn storage_unregister(&mut self, _force: Option<bool>) -> bool {
        self.storage
            .remove(&env::predecessor_account_id())
            .is_some()
    }

    pub fn storage_balance_bounds(&self) -> (U128, U128) {
        let minimum = NearToken::from_millinear(1);
        (U128(minimum.as_yoctonear()), U128(minimum.as_yoctonear()))
    }

    pub fn storage_balance_of(&self, account_id: AccountId) -> Option<MockStorageBalance> {
        self.storage
            .get(&account_id)
            .map(|total| MockStorageBalance {
                total: U128(total.as_yoctonear()),
                available: U128(0),
            })
    }

    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: String, memo: Option<String>) {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "exactly 1 yoctoNEAR is required"
        );
        require!(!self.failing, "mock USDC transfer failed");
        let amount = amount
            .parse::<u128>()
            .unwrap_or_else(|_| env::panic_str("mock transfer amount must be an integer"));
        let sender = env::predecessor_account_id();
        let sender_balance = self.balances.get(&sender).unwrap_or(0);
        require!(
            sender_balance >= amount,
            "mock USDC balance is insufficient"
        );
        let receiver_balance = self.balances.get(&receiver_id).unwrap_or(0);
        let receiver_balance = receiver_balance
            .checked_add(amount)
            .unwrap_or_else(|| env::panic_str("mock balance overflow"));
        self.balances.insert(&sender, &(sender_balance - amount));
        self.balances.insert(&receiver_id, &receiver_balance);
        let _ = memo;
    }
}
