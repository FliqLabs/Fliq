use crate::Contract;
use crate::errors;
use crate::orders::MAX_CORRIDOR_LENGTH;
use crate::types::{AgentPolicy, AgentPolicyView, PolicyAction, now};
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
