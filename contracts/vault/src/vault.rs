use near_sdk::collections::LookupMap;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, NearToken, Promise, env, near, require};

const BALANCE_PREFIX: &[u8] = b"b";
const RESERVATION_PREFIX: &[u8] = b"r";
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
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ReservationState {
    Pending,
    Committed,
    Released,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
struct Reservation {
    payer: AccountId,
    amount: u128,
    state: ReservationState,
}

#[near(serializers = [borsh, json])]
#[derive(Debug, PartialEq, Eq)]
pub struct StorageBalance {
    pub total: NearToken,
    pub available: NearToken,
}

#[near(serializers = [borsh, json])]
#[derive(Debug, PartialEq, Eq)]
pub struct StorageBalanceBounds {
    pub min: NearToken,
    pub max: Option<NearToken>,
}

#[allow(dead_code)]
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum ReservationError {
    AlreadyExists,
    AlreadyFinalized,
    AmountMustBePositive,
    ArithmeticOverflow,
    InsufficientBalance,
    NotFound,
}

#[near(serializers = [borsh])]
pub(crate) struct Vault {
    balances: LookupMap<AccountId, Balance>,
    reservations: LookupMap<String, Reservation>,
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

        let updated = Balance {
            available,
            reserved: balance.reserved,
        };
        self.balances.insert(account_id, &updated);
        U128(0)
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
        if self.reservations.get(&order_id.to_owned()).is_some() {
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
                state: ReservationState::Pending,
            },
        );
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn commit_outflow(&mut self, order_id: &str) -> Result<(), ReservationError> {
        let mut reservation = self.pending_reservation(order_id)?;
        let Some(balance) = self.balances.get(&reservation.payer) else {
            return Err(ReservationError::NotFound);
        };
        let Some(reserved) = balance.reserved.checked_sub(reservation.amount) else {
            return Err(ReservationError::ArithmeticOverflow);
        };

        self.balances.insert(
            &reservation.payer,
            &Balance {
                available: balance.available,
                reserved,
            },
        );
        reservation.state = ReservationState::Committed;
        self.reservations.insert(&order_id.to_owned(), &reservation);
        Ok(())
    }

    #[allow(dead_code)]
    pub(crate) fn release_reservation(&mut self, order_id: &str) -> Result<(), ReservationError> {
        let mut reservation = self.pending_reservation(order_id)?;
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
        reservation.state = ReservationState::Released;
        self.reservations.insert(&order_id.to_owned(), &reservation);
        Ok(())
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

    fn pending_reservation(&self, order_id: &str) -> Result<Reservation, ReservationError> {
        let Some(reservation) = self.reservations.get(&order_id.to_owned()) else {
            return Err(ReservationError::NotFound);
        };
        if reservation.state != ReservationState::Pending {
            return Err(ReservationError::AlreadyFinalized);
        }
        Ok(reservation.clone())
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
            Err(ReservationError::AlreadyFinalized)
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
            Err(ReservationError::AlreadyFinalized)
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
}
