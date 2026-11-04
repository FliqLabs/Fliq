pub mod orders;
pub mod types;

mod integration;
mod receipts;
mod temp_policies;
mod temp_vault;

use near_sdk::borsh::{BorshDeserialize, BorshSerialize};
use near_sdk::{env, near_bindgen, require, AccountId, LookupMap, Promise};

use crate::orders::{transition, validate_order};
use crate::types::{now, Amount, PayoutOrder, Receipt, StorageKey, TransferState};

#[near_bindgen]
#[derive(BorshDeserialize, BorshSerialize)]
pub struct Contract {
    orders: LookupMap<String, PayoutOrder>,
    receipts: LookupMap<String, Receipt>,
}

#[near_bindgen]
impl Contract {
    #[init]
    pub fn new() -> Self {
        Self {
            orders: LookupMap::new(StorageKey::Orders),
            receipts: LookupMap::new(StorageKey::Receipts),
        }
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
        validate_order(&order_id, amount, &corridor);
        require!(
            !self.orders.contains_key(&order_id),
            "order_id is already registered"
        );
        let order = PayoutOrder {
            order_id: order_id.clone(),
            payer,
            deposit_address,
            amount,
            expiry,
            corridor,
            transfer_state: TransferState::Registered,
            created_at: now(),
        };
        self.orders.insert(&order_id, &order);
        self.receipts.insert(
            &order_id,
            &Receipt {
                order_id,
                transfer_state: TransferState::Registered,
                backend_status: "created".to_string(),
                refs: String::new(),
                last_updated: now(),
            },
        );
    }

    /// May be called by the approved payout executor or an authorized agent.
    #[payable]
    pub fn payout(&mut self, order_id: String) -> Promise {
        require!(
            env::attached_deposit().is_zero(),
            "payout must not carry NEAR deposit"
        );
        let Some(mut order) = self.orders.get(&order_id) else {
            env::panic_str("order_id is not registered")
        };
        if let Err(error) = transition(&mut order, TransferState::Executing) {
            env::panic_str(&error);
        }
        integration::authorize_payout(&env::predecessor_account_id(), order.amount);
        self.orders.insert(&order_id, &order);
        integration::create_transfer(&order.deposit_address, order.amount)
    }

    /// May be called by the approved backend reporting account; it cannot move value.
    pub fn set_status(&mut self, order_id: String, status: String, refs: String) {
        require!(
            types::BACKEND_STATUSES.contains(&status.as_str()),
            "unknown backend status"
        );
        let Some(mut receipt) = self.receipts.get(&order_id) else {
            env::panic_str("order_id is not registered")
        };
        receipt.backend_status = status;
        receipt.refs = refs;
        receipt.last_updated = now();
        self.receipts.insert(&order_id, &receipt);
    }

    /// May be called only after the approved refund design is implemented.
    pub fn recredit(&mut self, _order_id: String, _amount: Amount) {
        env::panic_str("recredit is disabled until the refund design is approved");
    }

    /// May be called by anyone; this is a read-only view.
    pub fn get_receipt(&self, order_id: String) -> Option<Receipt> {
        self.receipts.get(&order_id)
    }

    /// May be called by anyone; this temporary view reports no vault balance.
    pub fn get_balance(&self, _account: AccountId) -> Amount {
        0
    }

    /// May be called by anyone; this temporary view reports the policy stand-in.
    pub fn get_policy(&self, public_key: String) -> String {
        integration::get_policy(&public_key)
    }
}
