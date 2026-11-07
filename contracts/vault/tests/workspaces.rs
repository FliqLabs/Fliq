use anyhow::{Context, Result};
use near_sdk::serde::de::DeserializeOwned;
use near_workspaces::types::{AccountId, Gas, NearToken};
use near_workspaces::{Account, Contract, Worker};
use serde_json::json;

const VAULT_WASM: &[u8] = include_bytes!("../target/near/fliq_vault.wasm");
const MOCK_USDC_WASM: &[u8] = include_bytes!("../../mock_usdc/target/near/fliq_mock_usdc.wasm");
const USDC_UNIT: u128 = 1_000_000;
const STORAGE_DEPOSIT: u128 = 10_000_000_000_000_000_000_000;
const TOKEN_STORAGE_DEPOSIT: u128 = 1_000_000_000_000_000_000_000;
const HOUR_NS: u64 = 60 * 60 * 1_000_000_000;
const MINUTE_NS: u64 = 60 * 1_000_000_000;

async fn expiry_ns(
    worker: &Worker<near_workspaces::network::Sandbox>,
    margin_ns: u64,
) -> Result<String> {
    Ok(worker
        .view_block()
        .await?
        .timestamp()
        .checked_add(margin_ns)
        .context("sandbox timestamp overflow")?
        .to_string())
}

async fn call(
    account: &Account,
    receiver: &AccountId,
    method: &str,
    args: serde_json::Value,
    deposit: u128,
) -> Result<near_workspaces::result::ExecutionFinalResult> {
    Ok(account
        .call(receiver, method)
        .args_json(args)
        .deposit(NearToken::from_yoctonear(deposit))
        .gas(Gas::from_tgas(300))
        .transact()
        .await?)
}

async fn expect_failure(
    account: &Account,
    receiver: &AccountId,
    method: &str,
    args: serde_json::Value,
    deposit: u128,
) -> Result<()> {
    let outcome = call(account, receiver, method, args, deposit).await?;
    assert!(outcome.is_failure(), "{method} unexpectedly succeeded");
    Ok(())
}

async fn view_json<T: DeserializeOwned>(
    contract: &Contract,
    method: &str,
    args: serde_json::Value,
) -> Result<T> {
    Ok(contract.view(method).args_json(args).await?.json()?)
}

async fn register_order(
    worker: &Worker<near_workspaces::network::Sandbox>,
    registration: &Account,
    vault: &Contract,
    order_id: &str,
    payer: &Account,
    deposit_address: &Account,
    amount: u128,
    margin_ns: u64,
) -> Result<()> {
    call(
        registration,
        vault.id(),
        "register_order",
        json!({
            "order_id": order_id,
            "payer": payer.id(),
            "deposit_address": deposit_address.id(),
            "amount": amount.to_string(),
            "expires_at_ns": expiry_ns(worker, margin_ns).await?,
            "corridor": "NG-NGN-bank"
        }),
        0,
    )
    .await?
    .into_result()?;
    Ok(())
}

#[tokio::test]
async fn payout_cases_run_in_a_local_sandbox() -> Result<()> {
    let worker: Worker<near_workspaces::network::Sandbox> = near_workspaces::sandbox().await?;
    let mock = worker
        .dev_deploy(MOCK_USDC_WASM)
        .await
        .context("deploy mock USDC")?;
    let vault = worker
        .dev_deploy(VAULT_WASM)
        .await
        .context("deploy vault")?;
    let owner = worker.dev_create_account().await?;
    let registration = worker.dev_create_account().await?;
    let payer = worker.dev_create_account().await?;
    let agent = worker.dev_create_account().await?;
    let recipient = worker.dev_create_account().await?;
    let outsider = worker.dev_create_account().await?;

    let init = call(
        vault.as_account(),
        vault.id(),
        "new",
        json!({
            "owner": owner.id().to_string(),
            "registration_account": registration.id().to_string(),
            "approved_usdc_token_contract": mock.id().to_string()
        }),
        0,
    )
    .await?;
    if init.is_failure() {
        anyhow::bail!("vault new failures: {:?}", init.failures());
    }
    expect_failure(
        &outsider,
        vault.id(),
        "new",
        json!({
            "owner": owner.id(),
            "registration_account": registration.id(),
            "approved_usdc_token_contract": mock.id()
        }),
        0,
    )
    .await?;

    call(
        vault.as_account(),
        vault.id(),
        "storage_deposit",
        json!({ "account_id": null, "registration_only": true }),
        STORAGE_DEPOSIT,
    )
    .await?
    .into_result()?;
    for account in [&payer, &recipient] {
        call(
            account,
            vault.id(),
            "storage_deposit",
            json!({ "account_id": null, "registration_only": true }),
            STORAGE_DEPOSIT,
        )
        .await?
        .into_result()?;
        call(
            account,
            mock.id(),
            "storage_deposit",
            json!({ "account_id": null, "registration_only": true }),
            TOKEN_STORAGE_DEPOSIT,
        )
        .await?
        .into_result()?;
    }
    call(
        &owner,
        mock.id(),
        "storage_deposit",
        json!({ "account_id": vault.id(), "registration_only": true }),
        TOKEN_STORAGE_DEPOSIT,
    )
    .await?
    .into_result()?;

    call(
        &owner,
        mock.id(),
        "mint",
        json!({ "account_id": payer.id(), "amount": (100 * USDC_UNIT).to_string() }),
        0,
    )
    .await?
    .into_result()?;
    call(
        &payer,
        mock.id(),
        "ft_transfer_call",
        json!({
            "receiver_id": vault.id(),
            "amount": (100 * USDC_UNIT).to_string(),
            "memo": null,
            "msg": json!({ "top_up": { "account_id": payer.id() } }).to_string()
        }),
        1,
    )
    .await?
    .into_result()?;

    register_order(
        &worker,
        &registration,
        &vault,
        "po_payer",
        &payer,
        &recipient,
        50 * USDC_UNIT,
        HOUR_NS,
    )
    .await?;
    register_order(
        &worker,
        &registration,
        &vault,
        "po_agent",
        &payer,
        &recipient,
        20 * USDC_UNIT,
        HOUR_NS,
    )
    .await?;

    call(
        &payer,
        vault.id(),
        "set_agent",
        json!({
            "public_key": agent.secret_key().public_key().to_string(),
            "agent_id": agent.id(),
            "per_payout_cap": (50 * USDC_UNIT).to_string(),
            "daily_cap": (100 * USDC_UNIT).to_string(),
            "corridors": ["NG-NGN-bank"],
            "cooldown_ns": "0",
            "expiry_ns": "9999999999999999999"
        }),
        STORAGE_DEPOSIT,
    )
    .await?
    .into_result()?;

    call(
        &registration,
        vault.id(),
        "set_status",
        json!({ "order_id": "po_payer", "status": "routing", "refs": {} }),
        0,
    )
    .await?
    .into_result()?;
    call(
        &payer,
        vault.id(),
        "payout",
        json!({
            "order_id": "po_payer",
            "amount": (50 * USDC_UNIT).to_string(),
            "deposit_address": recipient.id()
        }),
        0,
    )
    .await?
    .into_result()?;
    call(
        &agent,
        vault.id(),
        "payout",
        json!({
            "order_id": "po_agent",
            "amount": (20 * USDC_UNIT).to_string(),
            "deposit_address": recipient.id()
        }),
        0,
    )
    .await?
    .into_result()?;
    expect_failure(
        &payer,
        vault.id(),
        "payout",
        json!({
            "order_id": "po_payer",
            "amount": (50 * USDC_UNIT).to_string(),
            "deposit_address": recipient.id()
        }),
        0,
    )
    .await?;

    call(
        &owner,
        mock.id(),
        "set_failing",
        json!({ "failing": true }),
        0,
    )
    .await?
    .into_result()?;
    register_order(
        &worker,
        &registration,
        &vault,
        "po_failed",
        &payer,
        &recipient,
        10 * USDC_UNIT,
        HOUR_NS,
    )
    .await?;
    call(
        &payer,
        vault.id(),
        "payout",
        json!({
            "order_id": "po_failed",
            "amount": (10 * USDC_UNIT).to_string(),
            "deposit_address": recipient.id()
        }),
        0,
    )
    .await?
    .into_result()?;
    call(
        &owner,
        mock.id(),
        "set_failing",
        json!({ "failing": false }),
        0,
    )
    .await?
    .into_result()?;

    let failed_receipt: serde_json::Value =
        view_json(&vault, "get_receipt", json!({ "order_id": "po_failed" })).await?;
    assert_eq!(failed_receipt["transfer_state"], "transfer_failed");

    call(
        &registration,
        vault.id(),
        "set_status",
        json!({
            "order_id": "po_payer",
            "status": "refunding",
            "refs": { "refund_tx": "recredit-po-payer" }
        }),
        0,
    )
    .await?
    .into_result()?;
    call(
        &owner,
        mock.id(),
        "mint",
        json!({ "account_id": vault.id(), "amount": (10 * USDC_UNIT).to_string() }),
        0,
    )
    .await?
    .into_result()?;
    call(
        &registration,
        vault.id(),
        "recredit",
        json!({ "order_id": "po_payer", "amount": (10 * USDC_UNIT).to_string() }),
        0,
    )
    .await?
    .into_result()?;

    register_order(
        &worker,
        &registration,
        &vault,
        "po_expired",
        &payer,
        &recipient,
        USDC_UNIT,
        MINUTE_NS,
    )
    .await?;
    worker.fast_forward(7_200).await?;
    expect_failure(
        &payer,
        vault.id(),
        "payout",
        json!({
            "order_id": "po_expired",
            "amount": USDC_UNIT.to_string(),
            "deposit_address": recipient.id()
        }),
        0,
    )
    .await?;
    call(
        &registration,
        vault.id(),
        "release_order",
        json!({ "order_id": "po_expired" }),
        0,
    )
    .await?
    .into_result()?;

    register_order(
        &worker,
        &registration,
        &vault,
        "po_release",
        &payer,
        &recipient,
        5 * USDC_UNIT,
        HOUR_NS,
    )
    .await?;
    call(
        &registration,
        vault.id(),
        "release_order",
        json!({ "order_id": "po_release" }),
        0,
    )
    .await?
    .into_result()?;

    let invariant: serde_json::Value =
        view_json(&vault, "get_balance", json!({ "account_id": payer.id() })).await?;
    assert_eq!(
        invariant["available"]
            .as_str()
            .unwrap_or_default()
            .parse::<u128>()?
            + invariant["reserved"]
                .as_str()
                .unwrap_or_default()
                .parse::<u128>()?,
        invariant["total"]
            .as_str()
            .unwrap_or_default()
            .parse::<u128>()?
    );
    let token_balance: String =
        view_json(&mock, "ft_balance_of", json!({ "account_id": vault.id() })).await?;
    let _vault_token_balance = token_balance.parse::<u128>()?;

    for (method, args, deposit) in [
        ("set_payout_timeout", json!({ "payout_timeout": "1" }), 0),
        ("register_order", json!({}), 0),
        ("payout", json!({}), 0),
        ("set_status", json!({}), 0),
        ("release_order", json!({}), 0),
        ("recredit", json!({}), 0),
        (
            "transfer",
            json!({ "to_account": recipient.id(), "amount": "1" }),
            1,
        ),
        (
            "resolve_stuck_payout",
            json!({ "order_id": "po_payer", "transferred": false }),
            0,
        ),
    ] {
        expect_failure(&outsider, vault.id(), method, args, deposit).await?;
    }
    expect_failure(
        &outsider,
        mock.id(),
        "mint",
        json!({ "account_id": outsider.id(), "amount": "1" }),
        0,
    )
    .await?;
    expect_failure(
        &outsider,
        mock.id(),
        "set_failing",
        json!({ "failing": true }),
        0,
    )
    .await?;

    Ok(())
}
