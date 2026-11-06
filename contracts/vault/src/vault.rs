use near_contract_standards::storage_management::{StorageBalance, StorageBalanceBounds};
use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, NearToken, Promise, env, near, require};

const BALANCE_PREFIX: &[u8] = b"b";
const RESERVATION_PREFIX: &[u8] = b"r";
const REFUND_PREFIX: &[u8] = b"f";
const MAX_ACCOUNT_ID_LENGTH: usize = 64;

#[near(serializers = [borsh])]
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Balance {
    available: u128,
    reserved: u128,
}

#[near(serializers = [json])]
#[derive(Debug, Default, PartialEq, Eq)]
pub struct BalanceView {
    pub available: U128,
    pub reserved: U128,
    pub total: U128,
}

impl From<Balance> for BalanceView {
    fn from(balance: Balance) -> Self {
        let total = match balance.available.checked_add(balance.reserved) {
            Some(total) => total,
            None => env::panic_str("vault balance invariant violated"),
        };
        Self {
            available: U128(balance.available),
            reserved: U128(balance.reserved),
            total: U128(total),
        }
    }
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Reservation {
    payer: AccountId,
    amount: u128,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct RefundRecord {
    payer: AccountId,
    outflow_amount: u128,
    recredited_amount: u128,
}

#[allow(dead_code)]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReservationError {
    AlreadyExists,
    AmountMustBePositive,
    ArithmeticOverflow,
    InsufficientBalance,
    NotFound,
}

#[allow(dead_code)]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum RefundError {
    AlreadyRecredited,
    AmountMustBePositive,
    ArithmeticOverflow,
    ExceedsOutflow,
    ExceedsUnallocatedBalance,
    NotFound,
    PayerNotRegistered,
    Underbacked,
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) enum TransferError {
    AmountMustBePositive,
    SameAccount,
    SenderNotRegistered,
    RecipientNotRegistered,
    InsufficientBalance,
    ArithmeticOverflow,
}

#[near(serializers = [borsh])]
pub(crate) struct Vault {
    balances: LookupMap<AccountId, Balance>,
    reservations: LookupMap<String, Reservation>,
    refunds: LookupMap<String, RefundRecord>,
    total_liabilities: u128,
    account_storage_usage: u64,
}

impl Vault {
    pub(crate) fn new() -> Self {
        let mut balances = LookupMap::new(BALANCE_PREFIX);
        let initial_storage_usage = env::storage_usage();
        let measurement_account = Self::measurement_account();
        balances.insert(&measurement_account, &Balance::default());
        let account_storage_usage = match env::storage_usage().checked_sub(initial_storage_usage) {
            Some(storage_usage) => storage_usage,
            None => env::panic_str("failed to measure account storage"),
        };
        balances.remove(&measurement_account);

        Self {
            balances,
            reservations: LookupMap::new(RESERVATION_PREFIX),
            refunds: LookupMap::new(REFUND_PREFIX),
            total_liabilities: 0,
            account_storage_usage,
        }
    }

    pub(crate) fn balance_of(&self, account_id: &AccountId) -> Balance {
        self.balances.get(account_id).unwrap_or_default()
    }

    pub(crate) fn deposit(&mut self, account_id: &AccountId, amount: U128) -> U128 {
        let Some(balance) = self.balances.get(account_id) else {
            return amount;
        };
        let Some(available) = balance.available.checked_add(amount.0) else {
            return amount;
        };
        if available.checked_add(balance.reserved).is_none() {
            return amount;
        }
        let Some(total_liabilities) = self.total_liabilities.checked_add(amount.0) else {
            return amount;
        };

        let updated = Balance {
            available,
            reserved: balance.reserved,
        };
        self.balances.insert(account_id, &updated);
        self.total_liabilities = total_liabilities;
        U128(0)
    }

    pub(crate) fn transfer_available(
        &mut self,
        sender: &AccountId,
        recipient: &AccountId,
        amount: u128,
    ) -> Result<(), TransferError> {
        if amount == 0 {
            return Err(TransferError::AmountMustBePositive);
        }
        if sender == recipient {
            return Err(TransferError::SameAccount);
        }
        let Some(sender_balance) = self.balances.get(sender) else {
            return Err(TransferError::SenderNotRegistered);
        };
        let Some(recipient_balance) = self.balances.get(recipient) else {
            return Err(TransferError::RecipientNotRegistered);
        };
        let Some(sender_available) = sender_balance.available.checked_sub(amount) else {
            return Err(TransferError::InsufficientBalance);
        };
        let Some(recipient_available) = recipient_balance.available.checked_add(amount) else {
            return Err(TransferError::ArithmeticOverflow);
        };
        if recipient_available
            .checked_add(recipient_balance.reserved)
            .is_none()
        {
            return Err(TransferError::ArithmeticOverflow);
        }

        self.balances.insert(
            sender,
            &Balance {
                available: sender_available,
                reserved: sender_balance.reserved,
            },
        );
        self.balances.insert(
            recipient,
            &Balance {
                available: recipient_available,
                reserved: recipient_balance.reserved,
            },
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn reserve_for_order(
        &mut self,
        order_id: &str,
        payer: &AccountId,
        amount: u128,
    ) -> Result<(), ReservationError> {
        if amount == 0 {
            return Err(ReservationError::AmountMustBePositive);
        }
        if self.reservations.get(&order_id.to_owned()).is_some()
            || self.refunds.get(&order_id.to_owned()).is_some()
        {
            return Err(ReservationError::AlreadyExists);
        }

        let Some(balance) = self.balances.get(payer) else {
            return Err(ReservationError::InsufficientBalance);
        };
        let Some(available) = balance.available.checked_sub(amount) else {
            return Err(ReservationError::InsufficientBalance);
        };
        let Some(reserved) = balance.reserved.checked_add(amount) else {
            return Err(ReservationError::ArithmeticOverflow);
        };

        self.balances.insert(
            payer,
            &Balance {
                available,
                reserved,
            },
        );
        self.reservations.insert(
            &order_id.to_owned(),
            &Reservation {
                payer: payer.clone(),
                amount,
            },
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn commit_outflow(&mut self, order_id: &str) -> Result<(), ReservationError> {
        let reservation = self.reservation(order_id)?;
        if self.refunds.get(&order_id.to_owned()).is_some() {
            return Err(ReservationError::AlreadyExists);
        }
        let Some(balance) = self.balances.get(&reservation.payer) else {
            return Err(ReservationError::NotFound);
        };
        let Some(reserved) = balance.reserved.checked_sub(reservation.amount) else {
            return Err(ReservationError::ArithmeticOverflow);
        };
        let Some(total_liabilities) = self.total_liabilities.checked_sub(reservation.amount) else {
            return Err(ReservationError::ArithmeticOverflow);
        };

        self.balances.insert(
            &reservation.payer,
            &Balance {
                available: balance.available,
                reserved,
            },
        );
        self.refunds.insert(
            &order_id.to_owned(),
            &RefundRecord {
                payer: reservation.payer,
                outflow_amount: reservation.amount,
                recredited_amount: 0,
            },
        );
        self.total_liabilities = total_liabilities;
        self.reservations.remove(&order_id.to_owned());
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn release_reservation(&mut self, order_id: &str) -> Result<(), ReservationError> {
        let reservation = self.reservation(order_id)?;
        let Some(balance) = self.balances.get(&reservation.payer) else {
            return Err(ReservationError::NotFound);
        };
        let Some(reserved) = balance.reserved.checked_sub(reservation.amount) else {
            return Err(ReservationError::ArithmeticOverflow);
        };
        let Some(available) = balance.available.checked_add(reservation.amount) else {
            return Err(ReservationError::ArithmeticOverflow);
        };

        self.balances.insert(
            &reservation.payer,
            &Balance {
                available,
                reserved,
            },
        );
        self.reservations.remove(&order_id.to_owned());
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn recredit_refund(
        &mut self,
        order_id: &str,
        amount: u128,
        actual_token_balance: u128,
    ) -> Result<(), RefundError> {
        if amount == 0 {
            return Err(RefundError::AmountMustBePositive);
        }
        let Some(mut refund) = self.refunds.get(&order_id.to_owned()) else {
            return Err(RefundError::NotFound);
        };
        if refund.recredited_amount != 0 {
            return Err(RefundError::AlreadyRecredited);
        }
        if amount > refund.outflow_amount {
            return Err(RefundError::ExceedsOutflow);
        }
        let Some(unallocated_balance) = actual_token_balance.checked_sub(self.total_liabilities)
        else {
            return Err(RefundError::Underbacked);
        };
        if amount > unallocated_balance {
            return Err(RefundError::ExceedsUnallocatedBalance);
        }
        let Some(balance) = self.balances.get(&refund.payer) else {
            return Err(RefundError::PayerNotRegistered);
        };
        let Some(available) = balance.available.checked_add(amount) else {
            return Err(RefundError::ArithmeticOverflow);
        };
        if available.checked_add(balance.reserved).is_none() {
            return Err(RefundError::ArithmeticOverflow);
        }
        let Some(total_liabilities) = self.total_liabilities.checked_add(amount) else {
            return Err(RefundError::ArithmeticOverflow);
        };

        refund.recredited_amount = amount;
        self.balances.insert(
            &refund.payer,
            &Balance {
                available,
                reserved: balance.reserved,
            },
        );
        self.refunds.insert(&order_id.to_owned(), &refund);
        self.total_liabilities = total_liabilities;
        let event = near_sdk::serde_json::json!({
            "standard": "fliq_vault",
            "version": "1.0.0",
            "event": "recredited",
            "data": [{
                "order_id": order_id,
                "payer": refund.payer,
                "amount": U128(amount),
            }],
        });
        env::log_str(&format!("EVENT_JSON:{event}"));
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn total_liabilities(&self) -> u128 {
        self.total_liabilities
    }

    #[allow(dead_code)]
    pub(crate) fn recredited_amount(&self, order_id: &str) -> u128 {
        self.refunds
            .get(&order_id.to_owned())
            .map_or(0, |refund| refund.recredited_amount)
    }

    pub(crate) fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds {
            min: self.minimum_storage_balance(),
            max: Some(self.minimum_storage_balance()),
        }
    }

    pub(crate) fn storage_balance_of(&self, account_id: &AccountId) -> Option<StorageBalance> {
        self.balances
            .get(account_id)
            .map(|_| self.registered_storage_balance())
    }

    pub(crate) fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        _registration_only: Option<bool>,
    ) -> StorageBalance {
        let account_id = account_id.unwrap_or_else(env::predecessor_account_id);
        let attached = env::attached_deposit();
        let minimum = self.minimum_storage_balance();

        if self.balances.get(&account_id).is_some() {
            Self::refund_storage_deposit(env::predecessor_account_id(), attached);
            return self.registered_storage_balance();
        }

        require!(
            attached >= minimum,
            format!(
                "requires storage deposit of at least {} yoctoNEAR",
                minimum.as_yoctonear()
            )
        );
        self.balances.insert(&account_id, &Balance::default());
        let refund_amount = match attached.as_yoctonear().checked_sub(minimum.as_yoctonear()) {
            Some(refund) => refund,
            None => env::panic_str("storage deposit invariant violated"),
        };
        let refund = NearToken::from_yoctonear(refund_amount);
        Self::refund_storage_deposit(env::predecessor_account_id(), refund);
        self.registered_storage_balance()
    }

    pub(crate) fn storage_withdraw(&self, amount: Option<NearToken>) -> StorageBalance {
        Self::require_one_yocto();
        require!(
            amount.unwrap_or(NearToken::from_yoctonear(0)).is_zero(),
            "registered storage has no withdrawable balance"
        );
        require!(
            self.balances.get(&env::predecessor_account_id()).is_some(),
            "account is not registered"
        );
        self.registered_storage_balance()
    }

    pub(crate) fn storage_unregister(&mut self, _force: Option<bool>) -> bool {
        Self::require_one_yocto();
        let account_id = env::predecessor_account_id();
        let Some(balance) = self.balances.get(&account_id) else {
            return false;
        };
        require!(
            balance.available == 0 && balance.reserved == 0,
            "cannot unregister an account with a vault balance"
        );

        self.balances.remove(&account_id);
        Promise::new(account_id)
            .transfer(self.minimum_storage_balance())
            .detach();
        true
    }

    fn reservation(&self, order_id: &str) -> Result<Reservation, ReservationError> {
        let Some(reservation) = self.reservations.get(&order_id.to_owned()) else {
            return Err(ReservationError::NotFound);
        };
        Ok(reservation)
    }

    fn minimum_storage_balance(&self) -> NearToken {
        let minimum = match env::storage_byte_cost()
            .as_yoctonear()
            .checked_mul(u128::from(self.account_storage_usage))
        {
            Some(minimum) => minimum,
            None => env::panic_str("storage balance calculation overflowed"),
        };
        NearToken::from_yoctonear(minimum)
    }

    fn registered_storage_balance(&self) -> StorageBalance {
        StorageBalance {
            total: self.minimum_storage_balance(),
            available: NearToken::from_yoctonear(0),
        }
    }

    fn refund_storage_deposit(account_id: AccountId, amount: NearToken) {
        if !amount.is_zero() {
            Promise::new(account_id).transfer(amount).detach();
        }
    }

    fn require_one_yocto() {
        require!(
            env::attached_deposit() == NearToken::from_yoctonear(1),
            "requires attached deposit of exactly 1 yoctoNEAR"
        );
    }

    fn measurement_account() -> AccountId {
        let value = "a".repeat(MAX_ACCOUNT_ID_LENGTH);
        match value.parse() {
            Ok(account_id) => account_id,
            Err(_) => env::panic_str("failed to create storage measurement account"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{VMContext, testing_env};

    const CANONICAL_PAYOUT_AMOUNT: u128 = 50_000_000;
    const QUOTE_FIXTURE: &str = include_str!("../../../spec/fixtures/quote.usdc-ngn-50.json");

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

    fn vault() -> Vault {
        let vault_account = account("vault.testnet");
        testing_env!(context(&vault_account, NearToken::from_yoctonear(0)));
        Vault::new()
    }

    fn register(vault: &mut Vault, account_id: &AccountId) {
        let minimum = vault.minimum_storage_balance();
        testing_env!(context(account_id, minimum));
        vault.storage_deposit(None, Some(true));
    }

    fn deposit(vault: &mut Vault, account_id: &AccountId, amount: u128) {
        assert_eq!(vault.deposit(account_id, U128(amount)), U128(0));
    }

    #[test]
    fn canonical_fixture_still_represents_fifty_usdc() {
        let fixture: near_sdk::serde_json::Value =
            match near_sdk::serde_json::from_str(QUOTE_FIXTURE) {
                Ok(value) => value,
                Err(error) => panic!("invalid canonical quote fixture: {error}"),
            };

        assert_eq!(fixture["token"], "usdc");
        assert_eq!(fixture["amount"], "50.00");
        assert_eq!(CANONICAL_PAYOUT_AMOUNT, 50_000_000);
    }

    #[test]
    fn reservation_moves_available_funds_once() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 100_000_000);

        assert_eq!(
            vault.reserve_for_order("po_9c2f71aa", &payer, CANONICAL_PAYOUT_AMOUNT),
            Ok(())
        );
        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 50_000_000,
                reserved: 50_000_000,
            }
        );
        assert_eq!(
            vault.reserve_for_order("po_9c2f71aa", &payer, CANONICAL_PAYOUT_AMOUNT),
            Err(ReservationError::AlreadyExists)
        );
    }

    #[test]
    fn concurrent_reservations_cannot_overdraw() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 75_000_000);

        assert_eq!(
            vault.reserve_for_order("po_first", &payer, CANONICAL_PAYOUT_AMOUNT),
            Ok(())
        );
        assert_eq!(
            vault.reserve_for_order("po_second", &payer, CANONICAL_PAYOUT_AMOUNT),
            Err(ReservationError::InsufficientBalance)
        );
        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 25_000_000,
                reserved: 50_000_000,
            }
        );
    }

    #[test]
    fn rejected_reservation_does_not_mutate_balance_or_storage() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 25_000_000);
        let balance_before = vault.balance_of(&payer);
        let storage_before = env::storage_usage();

        assert_eq!(
            vault.reserve_for_order("po_too_large", &payer, 25_000_001),
            Err(ReservationError::InsufficientBalance)
        );

        assert_eq!(vault.balance_of(&payer), balance_before);
        assert_eq!(env::storage_usage(), storage_before);
        assert_eq!(
            vault.commit_outflow("po_too_large"),
            Err(ReservationError::NotFound)
        );
    }

    #[test]
    fn deposit_during_reservation_only_increases_available_balance() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 100_000_000);
        assert_eq!(
            vault.reserve_for_order("po_pending", &payer, 60_000_000),
            Ok(())
        );

        deposit(&mut vault, &payer, 25_000_000);

        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 65_000_000,
                reserved: 60_000_000,
            }
        );
        assert_eq!(vault.release_reservation("po_pending"), Ok(()));
        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 125_000_000,
                reserved: 0,
            }
        );
    }

    #[test]
    fn deposit_cannot_overflow_total_while_funds_are_reserved() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, u128::MAX);
        assert_eq!(vault.reserve_for_order("po_pending", &payer, 1), Ok(()));
        let balance_before = vault.balance_of(&payer);

        assert_eq!(vault.deposit(&payer, U128(1)), U128(1));
        assert_eq!(vault.balance_of(&payer), balance_before);

        assert_eq!(vault.release_reservation("po_pending"), Ok(()));
        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: u128::MAX,
                reserved: 0,
            }
        );
    }

    #[test]
    fn failed_transfer_releases_funds_exactly_once() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 100_000_000);
        assert_eq!(
            vault.reserve_for_order("po_failed", &payer, 30_000_000),
            Ok(())
        );

        assert_eq!(vault.release_reservation("po_failed"), Ok(()));
        assert_eq!(
            vault.release_reservation("po_failed"),
            Err(ReservationError::NotFound)
        );
        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 100_000_000,
                reserved: 0,
            }
        );
    }

    #[test]
    fn successful_transfer_consumes_reserved_funds_exactly_once() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 100_000_000);
        assert_eq!(
            vault.reserve_for_order("po_paid", &payer, 30_000_000),
            Ok(())
        );

        assert_eq!(vault.commit_outflow("po_paid"), Ok(()));
        assert_eq!(
            vault.commit_outflow("po_paid"),
            Err(ReservationError::NotFound)
        );
        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 70_000_000,
                reserved: 0,
            }
        );
    }

    #[test]
    fn another_user_cannot_reserve_someone_elses_balance() {
        let mut vault = vault();
        let ada = account("ada.testnet");
        let ben = account("ben.testnet");
        register(&mut vault, &ada);
        register(&mut vault, &ben);
        deposit(&mut vault, &ada, 100_000_000);

        assert_eq!(
            vault.reserve_for_order("po_ben", &ben, 1),
            Err(ReservationError::InsufficientBalance)
        );
        assert_eq!(vault.balance_of(&ada).available, 100_000_000);
        assert_eq!(vault.balance_of(&ben).available, 0);
    }

    #[test]
    fn zero_value_reservation_is_rejected() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);

        assert_eq!(
            vault.reserve_for_order("po_zero", &payer, 0),
            Err(ReservationError::AmountMustBePositive)
        );
    }

    #[test]
    fn committed_outflow_keeps_one_refund_record() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 100_000_000);
        let storage_before_reservation = env::storage_usage();

        assert_eq!(
            vault.reserve_for_order("po_storage", &payer, 30_000_000),
            Ok(())
        );
        assert!(env::storage_usage() > storage_before_reservation);

        assert_eq!(vault.commit_outflow("po_storage"), Ok(()));
        assert!(env::storage_usage() > storage_before_reservation);
        assert_eq!(
            vault.reserve_for_order("po_storage", &payer, 1),
            Err(ReservationError::AlreadyExists)
        );
    }

    #[test]
    fn mixed_reservation_outcomes_preserve_accounting() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 100_000_000);
        assert_eq!(
            vault.reserve_for_order("po_paid", &payer, 30_000_000),
            Ok(())
        );
        assert_eq!(
            vault.reserve_for_order("po_failed", &payer, 20_000_000),
            Ok(())
        );
        deposit(&mut vault, &payer, 10_000_000);

        assert_eq!(vault.commit_outflow("po_paid"), Ok(()));
        assert_eq!(vault.release_reservation("po_failed"), Ok(()));

        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 80_000_000,
                reserved: 0,
            }
        );
        assert_eq!(vault.total_liabilities(), 80_000_000);
    }

    #[test]
    fn refund_recredit_requires_backing_and_happens_once() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 100_000_000);
        assert_eq!(
            vault.reserve_for_order("po_refund", &payer, 30_000_000),
            Ok(())
        );
        assert_eq!(vault.commit_outflow("po_refund"), Ok(()));
        assert_eq!(vault.total_liabilities(), 70_000_000);

        assert_eq!(
            vault.recredit_refund("po_refund", 30_000_000, 70_000_000),
            Err(RefundError::ExceedsUnallocatedBalance)
        );
        assert_eq!(
            vault.recredit_refund("po_refund", 30_000_000, 100_000_000),
            Ok(())
        );
        assert_eq!(
            vault.recredit_refund("po_refund", 30_000_000, 100_000_000),
            Err(RefundError::AlreadyRecredited)
        );
        assert_eq!(vault.total_liabilities(), 100_000_000);
        assert_eq!(vault.recredited_amount("po_refund"), 30_000_000);
        assert_eq!(
            near_sdk::test_utils::get_logs(),
            vec![
                r#"EVENT_JSON:{"standard":"fliq_vault","version":"1.0.0","event":"recredited","data":[{"order_id":"po_refund","payer":"ada.testnet","amount":"30000000"}]}"#
                    .to_owned()
            ]
        );
        assert_eq!(
            vault.balance_of(&payer),
            Balance {
                available: 100_000_000,
                reserved: 0,
            }
        );
    }

    #[test]
    fn refund_cannot_exceed_committed_outflow() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 50_000_000);
        assert_eq!(
            vault.reserve_for_order("po_refund", &payer, 20_000_000),
            Ok(())
        );
        assert_eq!(vault.commit_outflow("po_refund"), Ok(()));

        assert_eq!(
            vault.recredit_refund("po_refund", 20_000_001, 50_000_001),
            Err(RefundError::ExceedsOutflow)
        );
        assert_eq!(vault.balance_of(&payer).available, 30_000_000);
    }

    #[test]
    fn invalid_refund_requests_do_not_change_accounting() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 50_000_000);
        assert_eq!(
            vault.reserve_for_order("po_refund", &payer, 20_000_000),
            Ok(())
        );
        assert_eq!(vault.commit_outflow("po_refund"), Ok(()));
        let balance_before = vault.balance_of(&payer);
        let liabilities_before = vault.total_liabilities();

        assert_eq!(
            vault.recredit_refund("po_refund", 0, 50_000_000),
            Err(RefundError::AmountMustBePositive)
        );
        assert_eq!(
            vault.recredit_refund("unknown", 1, 50_000_000),
            Err(RefundError::NotFound)
        );

        assert_eq!(vault.balance_of(&payer), balance_before);
        assert_eq!(vault.total_liabilities(), liabilities_before);
        assert_eq!(vault.recredited_amount("po_refund"), 0);
        assert!(near_sdk::test_utils::get_logs().is_empty());
    }

    #[test]
    fn unrelated_tokens_are_unallocated_not_automatically_credited() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 40_000_000);

        assert_eq!(
            vault.recredit_refund("unknown", 5_000_000, 45_000_000),
            Err(RefundError::NotFound)
        );
        assert_eq!(vault.recredited_amount("unknown"), 0);
        assert_eq!(vault.balance_of(&payer).available, 40_000_000);
    }

    #[test]
    fn recredit_rejects_an_underbacked_vault() {
        let mut vault = vault();
        let payer = account("ada.testnet");
        register(&mut vault, &payer);
        deposit(&mut vault, &payer, 40_000_000);
        assert_eq!(
            vault.reserve_for_order("po_refund", &payer, 10_000_000),
            Ok(())
        );
        assert_eq!(vault.commit_outflow("po_refund"), Ok(()));

        assert_eq!(
            vault.recredit_refund("po_refund", 1, 29_999_999),
            Err(RefundError::Underbacked)
        );
        assert_eq!(vault.recredited_amount("po_refund"), 0);
    }
}
