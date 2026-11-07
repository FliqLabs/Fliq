use crate::Contract;
use crate::errors;
use crate::orders::MAX_CORRIDOR_LENGTH;
use crate::receipts::FliqEvent;
use crate::types::{AgentPolicy, AgentPolicyView, Amount, PendingPolicySpend, now};
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, NearToken, Promise, PublicKey, env, require};

pub const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
pub const MAX_POLICY_CORRIDORS: usize = 16;

// OPEN: the contract cannot see which function-call key signed a transaction. The
// enforceable identity is the agent's NEAR account in the predecessor field.
/// A policy belongs to one owner and one agent account. The agent calls from its own
/// account: a relayed NEP-366 call reports the relayer's key as the signer, so the vault
/// cannot tell an owner's keys apart and never hands an agent a key on the owner's account.
/// Keying by both accounts means naming someone as your agent only ever spends your funds.
pub(crate) type PolicyId = (AccountId, AccountId);

/// Only a full-access key can attach a deposit, so a function-call key can never
/// create, widen or revoke a policy. The owner pays for the policy's storage.
#[allow(clippy::too_many_arguments)]
pub fn set_agent(
    contract: &mut Contract,
    public_key: PublicKey,
    agent_id: AccountId,
    per_payout_cap: U128,
    daily_cap: U128,
    corridors: Option<Vec<String>>,
    cooldown_ns: U64,
    expiry_ns: U64,
) {
    let attached = env::attached_deposit();
    require!(
        attached >= NearToken::from_yoctonear(1),
        errors::ONE_YOCTO_REQUIRED
    );
    let owner = env::predecessor_account_id();
    require!(owner != agent_id, errors::INVALID_POLICY);
    require!(
        per_payout_cap.0 > 0 && daily_cap.0 > 0 && per_payout_cap.0 <= daily_cap.0,
        errors::INVALID_POLICY
    );
    require!(expiry_ns.0 > now(), errors::INVALID_EXPIRY);
    let corridors = validate_corridors(corridors);
    let current_day = day_index(now());

    let id: PolicyId = (owner.clone(), agent_id.clone());
    let (spent_today, policy_day, last_payout_at) = match contract.agent_policies.get(&id) {
        Some(policy) if policy.day_index == current_day => {
            (policy.spent_today, policy.day_index, policy.last_payout_at)
        }
        Some(policy) => (0, current_day, policy.last_payout_at),
        None => (0, current_day, None),
    };

    let storage_before = env::storage_usage();
    contract.agent_policies.insert(
        &id,
        &AgentPolicy {
            owner: owner.clone(),
            agent_id: agent_id.clone(),
            public_key: public_key.clone(),
            per_payout_cap: per_payout_cap.0,
            daily_cap: daily_cap.0,
            corridors: corridors.clone(),
            cooldown_ns: cooldown_ns.0,
            expiry_ns: expiry_ns.0,
            revoked: false,
            day_index: policy_day,
            spent_today,
            last_payout_at,
        },
    );
    charge_storage(&owner, storage_before, attached);

    FliqEvent::AgentSet {
        owner,
        public_key: String::from(&public_key),
        agent_id,
        per_payout_cap,
        daily_cap,
        corridors,
        cooldown_ns,
        expiry_ns,
    }
    .emit();
}

/// Revoking keeps the record, so the counters survive if the owner re-enables the agent.
pub fn remove_agent(contract: &mut Contract, agent_id: &AccountId) {
    require!(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        errors::ONE_YOCTO_REQUIRED
    );
    let owner = env::predecessor_account_id();
    let id: PolicyId = (owner.clone(), agent_id.clone());
    let Some(mut policy) = contract.agent_policies.get(&id) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    policy.revoked = true;
    contract.agent_policies.insert(&id, &policy);
    FliqEvent::AgentRevoked {
        owner,
        agent_id: agent_id.clone(),
        public_key: String::from(&policy.public_key),
    }
    .emit();
}

pub fn get_policy(
    contract: &Contract,
    owner: AccountId,
    agent_id: AccountId,
) -> Option<AgentPolicyView> {
    contract
        .agent_policies
        .get(&(owner, agent_id))
        .map(|policy| {
            let spent_today = current_spend(&policy);
            AgentPolicyView {
                owner: policy.owner,
                agent_id: policy.agent_id,
                public_key: String::from(&policy.public_key),
                per_payout_cap: U128(policy.per_payout_cap),
                daily_cap: U128(policy.daily_cap),
                spent_today: U128(spent_today),
                corridors: policy.corridors,
                cooldown_ns: U64(policy.cooldown_ns),
                expiry_ns: U64(policy.expiry_ns),
                last_payout_at: policy.last_payout_at.map(U64),
                revoked: policy.revoked,
            }
        })
}

/// The payer pays directly. Any other caller must be an agent the payer set up,
/// and the payout must fit inside that agent's policy.
pub fn authorize_payout(
    contract: &mut Contract,
    caller: &AccountId,
    payer: &AccountId,
    order_id: &str,
    amount: Amount,
    corridor: &str,
) {
    require!(
        !contract
            .pending_policy_spends
            .contains_key(&order_id.to_owned()),
        errors::POLICY_PENDING_EXISTS
    );
    let current_day = day_index(now());
    let policy_id = if caller == payer {
        None
    } else {
        let id: PolicyId = (payer.clone(), caller.clone());
        let Some(mut policy) = contract.agent_policies.get(&id) else {
            env::panic_str(errors::UNAUTHORIZED);
        };
        validate_spend(&mut policy, amount, corridor);
        contract.agent_policies.insert(&id, &policy);
        FliqEvent::AgentSpend {
            owner: payer.clone(),
            agent_id: caller.clone(),
            order_id: order_id.to_owned(),
            amount: U128(amount),
        }
        .emit();
        Some(id)
    };
    contract.pending_policy_spends.insert(
        &order_id.to_owned(),
        &PendingPolicySpend {
            policy_id,
            amount,
            day_index: current_day,
        },
    );
}

pub fn release_pending(contract: &mut Contract, order_id: &str) {
    let Some(pending) = contract.pending_policy_spends.remove(&order_id.to_owned()) else {
        return;
    };
    let Some(id) = pending.policy_id else {
        return;
    };
    let Some(mut policy) = contract.agent_policies.get(&id) else {
        return;
    };
    if policy.day_index == pending.day_index {
        let Some(spent_today) = policy.spent_today.checked_sub(pending.amount) else {
            env::panic_str(errors::POLICY_ARITHMETIC);
        };
        policy.spent_today = spent_today;
        contract.agent_policies.insert(&id, &policy);
    }
}

pub fn settle_pending(contract: &mut Contract, order_id: &str) {
    contract.pending_policy_spends.remove(&order_id.to_owned());
}

pub(crate) fn day_index(timestamp: u64) -> u64 {
    timestamp / DAY_NS
}

fn charge_storage(owner: &AccountId, storage_before: u64, attached: NearToken) {
    let added = env::storage_usage().saturating_sub(storage_before);
    let Some(cost) = env::storage_byte_cost().checked_mul(u128::from(added)) else {
        env::panic_str(errors::STORAGE_CALCULATION_OVERFLOW);
    };
    require!(attached >= cost, errors::STORAGE_DEPOSIT_REQUIRED);
    let refund = attached.saturating_sub(cost);
    if !refund.is_zero() {
        Promise::new(owner.clone()).transfer(refund).detach();
    }
}

fn validate_spend(policy: &mut AgentPolicy, amount: Amount, corridor: &str) {
    let current_time = now();
    require!(!policy.revoked, errors::POLICY_REVOKED);
    require!(policy.expiry_ns > current_time, errors::POLICY_EXPIRED);
    require!(
        amount <= policy.per_payout_cap,
        errors::POLICY_PER_PAYOUT_CAP
    );
    if let Some(allowed) = &policy.corridors {
        require!(
            allowed.iter().any(|value| value == corridor),
            errors::POLICY_CORRIDOR
        );
    }
    if let Some(last_payout_at) = policy.last_payout_at {
        require!(
            current_time >= last_payout_at.saturating_add(policy.cooldown_ns),
            errors::POLICY_COOLDOWN
        );
    }
    let current_day = day_index(current_time);
    if policy.day_index != current_day {
        policy.day_index = current_day;
        policy.spent_today = 0;
    }
    let Some(next_spent) = policy.spent_today.checked_add(amount) else {
        env::panic_str(errors::POLICY_ARITHMETIC);
    };
    require!(next_spent <= policy.daily_cap, errors::POLICY_DAILY_CAP);
    policy.spent_today = next_spent;
    policy.last_payout_at = Some(current_time);
}

fn current_spend(policy: &AgentPolicy) -> Amount {
    if policy.day_index == day_index(now()) {
        policy.spent_today
    } else {
        0
    }
}

fn validate_corridors(corridors: Option<Vec<String>>) -> Option<Vec<String>> {
    let mut corridors = corridors?;
    require!(
        !corridors.is_empty() && corridors.len() <= MAX_POLICY_CORRIDORS,
        errors::INVALID_POLICY
    );
    require!(
        corridors.iter().all(|corridor| {
            !corridor.is_empty()
                && corridor.chars().count() <= MAX_CORRIDOR_LENGTH
                && corridor.chars().all(|character| {
                    character.is_ascii_alphanumeric() || matches!(character, '-' | '_')
                })
        }),
        errors::INVALID_CORRIDOR
    );
    corridors.sort();
    corridors.dedup();
    Some(corridors)
}
