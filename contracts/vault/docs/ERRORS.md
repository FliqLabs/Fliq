# Error codes

Every contract-owned panic uses the exact `fliq_vault: CODE` form.

| Code | Meaning |
| --- | --- |
| INITIALIZER_ONLY | Only the vault account may initialize. |
| ALREADY_INITIALIZED | State already exists. |
| OWNER_ONLY | Only the owner may call this method. |
| REGISTRATION_ONLY | Only the registration account may call this method. |
| UNAUTHORIZED | The caller or transfer participants are not authorized. |
| ORDER_NOT_FOUND | The order ID is not registered. |
| ORDER_EXISTS | The order ID is already permanently used. |
| INVALID_ORDER_ID | The order ID is empty or too long. |
| INVALID_AMOUNT | Amount must be positive. |
| INSUFFICIENT_BALANCE | The payer has insufficient available funds. |
| INVALID_CORRIDOR | Corridor is empty or too long. |
| INVALID_ADDRESS | Deposit address is not a valid NEAR account. |
| INVALID_EXPIRY | Expiry or timeout is invalid. |
| ORDER_EXPIRED | The registered order is past expiry. |
| INVALID_STATE | The requested transfer-state transition is not allowed. |
| AMOUNT_MISMATCH | Payout amount differs from the registered amount. |
| DESTINATION_MISMATCH | Payout destination differs from the registered destination. |
| INSUFFICIENT_GAS | The payout lacks gas for transfer and callback. |
| INVALID_STATUS | Backend status is unknown. |
| INVALID_TRANSITION | A status or write-once reference transition is not allowed. |
| INVALID_REFS | Backend refs are invalid. |
| STATUS_BACKWARD | Backend status transition is not allowed. |
| STATUS_TERMINAL | Backend status is already terminal. |
| CALLBACK_UNAUTHORIZED | Callback predecessor is not this contract. |
| CALLBACK_PROMISE_COUNT | Callback did not receive exactly one promise result. |
| EXECUTING_SINCE_MISSING | Executing order has no start timestamp. |
| TIMEOUT_NOT_REACHED | Stuck-payout timeout has not elapsed. |
| NO_ATTACHED_DEPOSIT | Payout must not attach NEAR. |
| RECEIPT_NOT_FOUND | Receipt storage is missing for an order. |
| TRANSFER_ENCODING | USDC transfer arguments could not be encoded. |
| CALLBACK_ENCODING | Callback arguments could not be encoded. |
| PAYOUT_NOT_EXECUTING | Stuck resolution requires Executing. |
| REFUND_NOT_ALLOWED | Recredit requires a Dispatched order. |
| INVALID_REFUND_STATUS | Backend status is not refundable. |
| ALREADY_RECREDITED | The order or refund transaction was already used for recredit. |
| RECREDIT_EXCEEDS_ORDER | Recredit exceeds the committed order outflow. |
| RECREDIT_EXCEEDS_UNATTRIBUTED | Recredit exceeds USDC not already backing liabilities. |
| ORDER_DETAILS_MISSING | Required order details are missing. |
| STUCK_PAYOUT_UNRESOLVED | Stuck payout could not be finalized. |
| RELEASED_ORDER | Released orders cannot be changed. |
| TEST_ACCOUNT_UNREGISTERED | Test funding requires a registered account. |
| VAULT_RESERVATION_FAILED | Dapper reservation failed. |
| VAULT_COMMIT_FAILED | Dapper outflow commit failed. |
| VAULT_RELEASE_FAILED | Dapper reservation release failed. |
| VAULT_REFUND_FAILED | Dapper refund recredit failed. |
| INVALID_POLICY | Policy fields are internally inconsistent or unsafe. |
| POLICY_NOT_FOUND | The caller has no agent policy. |
| POLICY_OWNER_ONLY | Only the stored policy owner may change or revoke it. |
| POLICY_PAYER_MISMATCH | The policy owner is not the order payer. |
| POLICY_REVOKED | The agent policy is revoked. |
| POLICY_EXPIRED | The agent policy has expired. |
| POLICY_PER_PAYOUT_CAP | The action exceeds the single-action cap. |
| POLICY_DAILY_CAP | Pending plus completed spend would exceed the daily cap. |
| POLICY_CORRIDOR | The order corridor is not allowed by the policy. |
| POLICY_COOLDOWN | The agent is attempting another payout too soon. |
| POLICY_PENDING_EXISTS | The order already has pending policy spend. |
| POLICY_PENDING_MISSING | Expected pending policy spend is missing. |
| POLICY_ARITHMETIC | Policy spend accounting would overflow or underflow. |
