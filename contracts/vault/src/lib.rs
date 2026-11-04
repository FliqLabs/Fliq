pub mod orders;
pub mod types;

mod integration;
mod receipts;
mod temp_policies;
mod temp_vault;

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::collections::LookupMap;
use near_sdk::{env, near_bindgen, require, AccountId, Promise};

use crate::orders::{set_status, validate_deposit_address, validate_order};
use crate::receipts::FliqEvent;
use crate::types::{
    now, Amount, Config, PayoutOrder, Receipt, StorageKey, TransferState, DEFAULT_MAX_EXPIRY,
};

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct Contract {
    pub(crate) config: Config,
    pub(crate) orders: LookupMap<String, PayoutOrder>,
    pub(crate) receipts: LookupMap<String, Receipt>,
}

#[near_bindgen]
impl Contract {
    #[init]
    /// The deployer supplies the immutable owner and approved USDC token contract.
    /// Only the owner may later change `registration_account`; owner and token contract
    /// cannot be changed after initialization. A provider allowlist is intentionally absent;
    /// OPEN: ask the backend team whether a provider allowlist is needed.
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
                max_expiry: DEFAULT_MAX_EXPIRY,
            },
            orders: LookupMap::new(StorageKey::Orders),
            receipts: LookupMap::new(StorageKey::Receipts),
        }
    }

    /// Only the current owner may change the account allowed to register orders and report status.
    pub fn set_registration_account(&mut self, registration_account: AccountId) {
        require!(
            env::predecessor_account_id() == self.config.owner,
            "only the owner may set registration_account"
        );
        self.config.registration_account = registration_account;
    }

    /// Anyone may read the owner, registration account, approved token contract, and expiry limit.
    pub fn get_config(&self) -> Config {
        self.config.clone()
    }

    /// May be called by the approved backend registration account.
    pub fn register_order(
        &mut self,
        order_id: String,
        payer: AccountId,
        deposit_address: AccountId,
        amount: Amount,
        expiry: u64,
        corridor: String,
    ) {
        require!(
            env::predecessor_account_id() == self.config.registration_account,
            "only registration_account may register orders"
        );
        validate_order(&order_id, amount, &corridor);
        require!(
            !self.orders.contains_key(&order_id),
            "order_id is already registered"
        );
        validate_deposit_address(deposit_address.as_ref());
        let current_time = now();
        require!(expiry > current_time, "expiry must be in the future");
        require!(
            expiry - current_time <= self.config.max_expiry,
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
            created_at: now(),
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
                last_updated: now(),
            },
        );
        FliqEvent::OrderRegistered {
            order_id: order_id.clone(),
            amount: amount.to_string(),
            expiry: expiry.to_string(),
            corridor,
        }
        .emit();
    }

    /// May be called by the approved payout executor or an authorized agent.
    #[payable]
    pub fn payout(&mut self, order_id: String) -> Promise {
        require!(
            env::attached_deposit().is_zero(),
            "payout must not carry NEAR deposit"
        );
        orders::payout(self, order_id)
    }

    /// May be called by the approved backend reporting account; it cannot move value.
    pub fn set_status(&mut self, order_id: String, status: String, refs: String) {
        set_status(self, order_id, status, refs);
    }

    /// May be called only after the approved refund design is implemented.
    pub fn recredit(&mut self, _order_id: String, _amount: Amount) {
        env::panic_str("recredit is disabled until the refund design is approved");
    }

    /// May be called by anyone; this is a read-only view.
    pub fn get_receipt(&self, order_id: String) -> Receipt {
        match self.receipts.get(&order_id) {
            Some(receipt) => receipt,
            None => env::panic_str("receipt not found for order_id"),
        }
    }

    /// May be called by anyone; this temporary view reports no vault balance.
    pub fn get_balance(&self, account: AccountId) -> types::BalanceView {
        integration::get_balance(&account)
    }

    /// May be called by anyone; this temporary view reports the policy stand-in.
    pub fn get_policy(&self, public_key: String) -> String {
        let _ = public_key;
        String::new()
    }

    /// May be called only by tests compiled with the opt-in `testing` feature.
    #[cfg(all(feature = "testing", debug_assertions))]
    pub fn credit_for_testing(&mut self, account: AccountId, amount: Amount) {
        temp_vault::credit_for_testing(&account, amount);
    }

    /// May be called only by this contract's own callback promise.
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
}
