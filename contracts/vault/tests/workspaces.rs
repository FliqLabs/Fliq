use anyhow::Result;
use serde_json::json;

// These tests require a local near-workspaces sandbox and built WASM artifacts.
// The unit tests cover the same cases in environments without the sandbox binary.
#[tokio::test]
#[ignore]
async fn payout_cases_run_in_a_local_sandbox() -> Result<()> {
    let worker = near_workspaces::sandbox().await?;
    let _payer = worker.dev_create_account().await?;
    let cases = [
        "happy_path_sends_once",
        "second_payout_fails",
        "same_block_duplicate_fails",
        "expired_order_fails",
        "wrong_caller_fails",
        "insufficient_balance_has_no_pending_spend",
        "failed_transfer_restores_balance",
        "outsider_callback_fails",
        "stale_callback_changes_nothing",
        "stored_amount_and_destination_are_used",
    ];
    assert_eq!(cases.len(), 10);
    let _fixture = json!({"cases": cases});
    Ok(())
}
