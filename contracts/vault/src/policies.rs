use crate::Contract;
use crate::errors;
use crate::orders::MAX_CORRIDOR_LENGTH;
use crate::types::{AgentPolicy, AgentPolicyView, Amount, PendingPolicySpend, now};
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, NearToken, PublicKey, env, require};

pub const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
pub const MAX_POLICY_CORRIDORS: usize = 16;

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
    require_one_yocto();
    let owner = env::predecessor_account_id();
    require!(owner != agent_id, errors::INVALID_POLICY);
    require!(
        per_payout_cap.0 > 0 && daily_cap.0 > 0 && per_payout_cap.0 <= daily_cap.0,
        errors::INVALID_POLICY
    );
    require!(expiry_ns.0 > now(), errors::INVALID_EXPIRY);
    let corridors = validate_corridors(corridors);
    let current_day = day_index(now());

    let prior_key = contract.agent_policy_keys.get(&agent_id);
    if let Some(key) = prior_key.as_ref() {
        require!(key == &public_key, errors::INVALID_POLICY);
    }
    let prior_policy = prior_key
        .as_ref()
        .and_then(|key| contract.agent_policies.get(key));
    if let Some(policy) = prior_policy.as_ref() {
        require!(policy.owner == owner, errors::POLICY_OWNER_ONLY);
    }
    if let Some(policy) = contract.agent_policies.get(&public_key) {
        require!(
            policy.owner == owner && policy.agent_id == agent_id,
            errors::POLICY_OWNER_ONLY
        );
    }

    let (spent_today, policy_day, last_payout_at) = match prior_policy {
        Some(policy) if policy.day_index == current_day => {
            (policy.spent_today, policy.day_index, policy.last_payout_at)
        }
        Some(policy) => (0, current_day, policy.last_payout_at),
        None => (0, current_day, None),
    };
    contract.agent_policies.insert(
        &public_key,
        &AgentPolicy {
            owner,
            agent_id: agent_id.clone(),
            public_key: public_key.clone(),
            per_payout_cap: per_payout_cap.0,
            daily_cap: daily_cap.0,
            corridors,
            cooldown_ns: cooldown_ns.0,
            expiry_ns: expiry_ns.0,
            revoked: false,
            day_index: policy_day,
            spent_today,
            last_payout_at,
        },
    );
    contract.agent_policy_keys.insert(&agent_id, &public_key);
}

pub fn remove_agent(contract: &mut Contract, public_key: &PublicKey) {
    require_one_yocto();
    let Some(mut policy) = contract.agent_policies.get(public_key) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    require!(
        policy.owner == env::predecessor_account_id(),
        errors::POLICY_OWNER_ONLY
    );
    policy.revoked = true;
    contract.agent_policies.insert(public_key, &policy);
}

pub fn get_policy(contract: &Contract, public_key: &PublicKey) -> Option<AgentPolicyView> {
    contract
        .agent_policies
        .get(public_key)
        .filter(|policy| !policy.revoked)
        .map(|policy| {
            let spent_today = current_spend(&policy);
            AgentPolicyView {
                owner: policy.owner,
                per_payout_cap: U128(policy.per_payout_cap),
                daily_cap: U128(policy.daily_cap),
                spent_today: U128(spent_today),
                corridors: policy.corridors,
            }
        })
}

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
    if caller == payer {
        contract.pending_policy_spends.insert(
            &order_id.to_owned(),
            &PendingPolicySpend {
                policy_key: None,
                amount,
                day_index: current_day,
            },
        );
        return;
    }

    let (policy_key, mut policy) = policy_for_agent(contract, caller);
    validate_spend(&mut policy, payer, amount, Some(corridor));
    contract.agent_policies.insert(&policy_key, &policy);
    contract.pending_policy_spends.insert(
        &order_id.to_owned(),
        &PendingPolicySpend {
            policy_key: Some(policy_key),
            amount,
            day_index: current_day,
        },
    );
}

pub fn authorize_transfer(
    contract: &mut Contract,
    caller: &AccountId,
    amount: Amount,
) -> AccountId {
    let Some(policy_key) = contract.agent_policy_keys.get(caller) else {
        return caller.clone();
    };
    let Some(mut policy) = contract.agent_policies.get(&policy_key) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    let owner = policy.owner.clone();
    validate_spend(&mut policy, &owner, amount, None);
    contract.agent_policies.insert(&policy_key, &policy);
    owner
}

pub fn release_pending(contract: &mut Contract, order_id: &str) {
    let Some(pending) = contract.pending_policy_spends.remove(&order_id.to_owned()) else {
        env::panic_str(errors::POLICY_PENDING_MISSING);
    };
    let Some(policy_key) = pending.policy_key else {
        return;
    };
    let Some(mut policy) = contract.agent_policies.get(&policy_key) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    if policy.day_index == pending.day_index {
        let Some(spent_today) = policy.spent_today.checked_sub(pending.amount) else {
            env::panic_str(errors::POLICY_ARITHMETIC);
        };
        policy.spent_today = spent_today;
        contract.agent_policies.insert(&policy_key, &policy);
    }
}

pub fn settle_pending(contract: &mut Contract, order_id: &str) {
    require!(
        contract
            .pending_policy_spends
            .remove(&order_id.to_owned())
            .is_some(),
        errors::POLICY_PENDING_MISSING
    );
}

pub(crate) fn day_index(timestamp: u64) -> u64 {
    timestamp / DAY_NS
}

fn policy_for_agent(contract: &Contract, agent_id: &AccountId) -> (PublicKey, AgentPolicy) {
    let Some(policy_key) = contract.agent_policy_keys.get(agent_id) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    let Some(policy) = contract.agent_policies.get(&policy_key) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    (policy_key, policy)
}

fn validate_spend(
    policy: &mut AgentPolicy,
    payer: &AccountId,
    amount: Amount,
    corridor: Option<&str>,
) {
    let current_time = now();
    require!(policy.owner == *payer, errors::POLICY_PAYER_MISMATCH);
    require!(!policy.revoked, errors::POLICY_REVOKED);
    require!(policy.expiry_ns > current_time, errors::POLICY_EXPIRED);
    require!(
        amount <= policy.per_payout_cap,
        errors::POLICY_PER_PAYOUT_CAP
    );
    if let (Some(allowed), Some(corridor)) = (&policy.corridors, corridor) {
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

fn require_one_yocto() {
    require!(
        env::attached_deposit() == NearToken::from_yoctonear(1),
        errors::ONE_YOCTO_REQUIRED
    );
}
