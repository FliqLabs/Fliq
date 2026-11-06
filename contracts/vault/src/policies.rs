use crate::Contract;
use crate::errors;
use crate::orders::MAX_CORRIDOR_LENGTH;
use crate::types::{AgentPolicy, AgentPolicyView, Amount, PendingPolicySpend, PolicyAction, now};
use near_sdk::json_types::{U64, U128};
use near_sdk::{AccountId, env, require};

pub const DAY_NS: u64 = 24 * 60 * 60 * 1_000_000_000;
pub const MAX_POLICY_CORRIDORS: usize = 16;

pub fn set_agent_policy(
    contract: &mut Contract,
    agent_id: AccountId,
    max_per_payout: U128,
    daily_limit: U128,
    allowed_corridors: Vec<String>,
    cooldown_ns: U64,
    expiry_ns: U64,
) {
    let owner = env::predecessor_account_id();
    require!(owner != agent_id, errors::INVALID_POLICY);
    require!(
        max_per_payout.0 > 0 && daily_limit.0 > 0 && max_per_payout.0 <= daily_limit.0,
        errors::INVALID_POLICY
    );
    require!(expiry_ns.0 > now(), errors::INVALID_EXPIRY);
    let allowed_corridors = validate_corridors(allowed_corridors);

    let current_day = day_index(now());
    let (spent_today, policy_day, last_payout_at) = match contract.agent_policies.get(&agent_id) {
        Some(policy) => {
            require!(policy.owner == owner, errors::POLICY_OWNER_ONLY);
            if policy.day_index == current_day {
                (policy.spent_today, policy.day_index, policy.last_payout_at)
            } else {
                (0, current_day, policy.last_payout_at)
            }
        }
        None => (0, current_day, None),
    };

    contract.agent_policies.insert(
        &agent_id,
        &AgentPolicy {
            owner,
            agent_id: agent_id.clone(),
            allowed_action: PolicyAction::Payout,
            max_per_payout: max_per_payout.0,
            daily_limit: daily_limit.0,
            allowed_corridors,
            cooldown_ns: cooldown_ns.0,
            expiry_ns: expiry_ns.0,
            revoked: false,
            day_index: policy_day,
            spent_today,
            last_payout_at,
        },
    );
}

pub fn revoke_agent(contract: &mut Contract, agent_id: &AccountId) {
    let Some(mut policy) = contract.agent_policies.get(agent_id) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    require!(
        policy.owner == env::predecessor_account_id(),
        errors::POLICY_OWNER_ONLY
    );
    policy.revoked = true;
    contract.agent_policies.insert(agent_id, &policy);
}

pub fn get_policy(contract: &Contract, agent_id: &AccountId) -> Option<AgentPolicyView> {
    contract.agent_policies.get(agent_id).map(|policy| {
        let spent_today = if policy.day_index == day_index(now()) {
            policy.spent_today
        } else {
            0
        };
        AgentPolicyView {
            owner: policy.owner,
            agent_id: policy.agent_id,
            allowed_action: policy.allowed_action,
            max_per_payout: U128(policy.max_per_payout),
            daily_limit: U128(policy.daily_limit),
            spent_today: U128(spent_today),
            allowed_corridors: policy.allowed_corridors,
            cooldown_ns: U64(policy.cooldown_ns),
            expiry_ns: U64(policy.expiry_ns),
            revoked: policy.revoked,
            last_payout_at: policy.last_payout_at.map(U64),
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
    let current_time = now();
    let current_day = day_index(current_time);
    if caller == payer {
        contract.pending_policy_spends.insert(
            &order_id.to_owned(),
            &PendingPolicySpend {
                agent_id: None,
                amount,
                day_index: current_day,
            },
        );
        return;
    }

    let Some(mut policy) = contract.agent_policies.get(caller) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    require!(policy.owner == *payer, errors::POLICY_PAYER_MISMATCH);
    require!(!policy.revoked, errors::POLICY_REVOKED);
    require!(policy.expiry_ns > current_time, errors::POLICY_EXPIRED);
    require!(
        policy.allowed_action == PolicyAction::Payout,
        errors::POLICY_ACTION_DENIED
    );
    require!(
        amount <= policy.max_per_payout,
        errors::POLICY_PER_PAYOUT_LIMIT
    );
    require!(
        policy
            .allowed_corridors
            .iter()
            .any(|allowed| allowed == corridor),
        errors::POLICY_CORRIDOR_DENIED
    );
    if let Some(last_payout_at) = policy.last_payout_at {
        require!(
            current_time >= last_payout_at.saturating_add(policy.cooldown_ns),
            errors::POLICY_COOLDOWN
        );
    }
    if policy.day_index != current_day {
        policy.day_index = current_day;
        policy.spent_today = 0;
    }
    let Some(next_spent) = policy.spent_today.checked_add(amount) else {
        env::panic_str(errors::POLICY_ARITHMETIC);
    };
    require!(next_spent <= policy.daily_limit, errors::POLICY_DAILY_LIMIT);

    policy.spent_today = next_spent;
    policy.last_payout_at = Some(current_time);
    contract.agent_policies.insert(caller, &policy);
    contract.pending_policy_spends.insert(
        &order_id.to_owned(),
        &PendingPolicySpend {
            agent_id: Some(caller.clone()),
            amount,
            day_index: current_day,
        },
    );
}

pub fn release_pending(contract: &mut Contract, order_id: &str) {
    let Some(pending) = contract.pending_policy_spends.remove(&order_id.to_owned()) else {
        env::panic_str(errors::POLICY_PENDING_MISSING);
    };
    let Some(agent_id) = pending.agent_id else {
        return;
    };
    let Some(mut policy) = contract.agent_policies.get(&agent_id) else {
        env::panic_str(errors::POLICY_NOT_FOUND);
    };
    if policy.day_index == pending.day_index {
        let Some(spent_today) = policy.spent_today.checked_sub(pending.amount) else {
            env::panic_str(errors::POLICY_ARITHMETIC);
        };
        policy.spent_today = spent_today;
        contract.agent_policies.insert(&agent_id, &policy);
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

fn validate_corridors(mut corridors: Vec<String>) -> Vec<String> {
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
    corridors
}
