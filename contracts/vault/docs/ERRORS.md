# Error codes

Every contract-owned panic uses the exact `fliq_vault: CODE` form.

| Code | Meaning |
| --- | --- |
| INITIALIZER_ONLY | Only the vault account may initialize. |
| ALREADY_INITIALIZED | State already exists. |
| OWNER_ONLY | Only the owner may call this method. |
| REGISTRATION_ONLY | Only the registration account may call this method. |
| ORDER_NOT_FOUND | The order ID is not registered. |
| ORDER_EXISTS | The order ID is already permanently used. |
| INVALID_ORDER_ID | The order ID is empty or too long. |
| INVALID_AMOUNT | Amount must be positive. |
| INVALID_CORRIDOR | Corridor is empty or too long. |
| INVALID_ADDRESS | Deposit address is not a valid NEAR account. |
| INVALID_EXPIRY | Expiry or timeout is invalid. |
| ORDER_EXPIRED | The registered order is past expiry. |
| INVALID_STATE | The requested transfer-state transition is not allowed. |
| AMOUNT_MISMATCH | Payout amount differs from the registered amount. |
| DESTINATION_MISMATCH | Payout destination differs from the registered destination. |
| INSUFFICIENT_GAS | The payout lacks gas for transfer and callback. |
| INVALID_STATUS | Backend status is unknown. |
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
| ORDER_DETAILS_MISSING | Required order details are missing. |
| STUCK_PAYOUT_UNRESOLVED | Stuck payout could not be finalized. |
| RELEASED_ORDER | Released orders cannot be changed. |
| TEST_ACCOUNT_UNREGISTERED | Test funding requires a registered account. |
| VAULT_RESERVATION_FAILED | Dapper reservation failed. |
| VAULT_COMMIT_FAILED | Dapper outflow commit failed. |
| VAULT_RELEASE_FAILED | Dapper reservation release failed. |
| VAULT_REFUND_FAILED | Dapper refund recredit failed. |
| TEMP_POLICY_DENIED | Temporary policy rejected the caller. |
| TEMP_PENDING_EXISTS | Temporary policy already has a pending spend. |
| TEMP_PENDING_MISSING | Temporary policy spend record is missing. |
| TEMP_PENDING_CORRUPT | Temporary policy spend record is corrupt. |

## Dapper to convert

The narrow Stage 6 vault integration converts Dapper's current messages to `fliq_vault: CODE`; the underlying enum cases are `AlreadyExists`, `AmountMustBePositive`, `ArithmeticOverflow`, `InsufficientBalance`, `NotFound`, `ExceedsOutflow`, `ExceedsUnallocatedBalance`, `PayerNotRegistered`, and `Underbacked`.
