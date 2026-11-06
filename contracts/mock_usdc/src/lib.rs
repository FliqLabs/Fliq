use near_sdk::collections::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken};

#[near(contract_state)]
pub struct MockUsdc {
    balances: LookupMap<AccountId, u128>,
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

    pub fn balance_of(&self, account: AccountId) -> u128 {
        self.balances.get(&account).unwrap_or(0)
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
