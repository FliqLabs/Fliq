# Contract decisions

## Confirmed release_order rules

- `release_order(order_id)` is callable by the registration account or owner only.
- It works only from `Registered`, restores the order's reservation to the payer's available balance, and moves the order to terminal `Released`.
- A `Released` order cannot be paid, released again, registered again, or moved by `set_status`; an `Executing` order must use `resolve_stuck_payout`.
- The event is `order_released` under the `fliq_vault` NEP-297 envelope, version `1.0.0`.

## PROPOSED backend status rules

These rules are PROPOSED and require backend approval:

- `set_status` is callable only by `registration_account`.
- The order must exist and the status must be in `BACKEND_STATUSES`.
- Replaying the same status with the same refs is accepted as a no-op.
- Statuses follow the branching transitions from the backend payout-state model; illegal edges and signals after terminal states are rejected.
- `paying_out` and `settled` are accepted only after the verified NEAR `transfer_state` is `Dispatched`.
- Status updates never change the verified transfer state, balances, or policy counts.
- Refs are limited to 256 ASCII identifier characters (`A-Z`, `a-z`, `0-9`, `:`, `/`, `.`, `_`, `-`) to keep personal data out of receipts and events. This format is PROPOSED.
- The proposed status table includes the `refused` and `not_received` terminal branches from the API spec. The transition table remains PROPOSED pending backend approval.

## Confirmed refund behavior

- A refund can be recredited only for an existing `Dispatched` order whose backend status is `refunding` and whose receipt has a write-once `refund_tx`.
- The backend verifies the refund transaction before the registration account calls `recredit(order_id, amount)`.
- The contract queries `ft_balance_of` on the approved USDC contract, caps the credit at the committed outflow and unattributed token balance, and records both the order credit and refund transaction as single-use.
- A partial refund is allowed, but each order has at most one recredit. Only a successful callback changes the receipt status to `refunded`.
- Failed transfers and `resolve_stuck_payout(..., false)` release the reservation, enter terminal `TransferFailed`, and create no refund record.

## Confirmed NEP-145 storage behaviour

- The vault is registration-only: `storage_balance_bounds` reports `min` equal to `max`, there is never
  spendable storage credit, and `storage_withdraw` accepts only a zero or absent amount.
- `storage_unregister` accepts `force` and ignores it. Closing an account always requires a zero available
  and zero reserved balance. This deviates from NEP-145, which permits `force: true` to close an account and
  discard its tokens; the vault refuses instead, because discarding a user's USDC to satisfy a standard is
  not a trade this contract should make. Any NEP-145 client we publish must document that `force` will not
  override a balance.
- `storage_deposit` is idempotent and refunds the whole attachment for an already registered account, so a
  provisioner retrying a registration never pays twice.
- Per-account storage is measured once at initialization against a 64-character account ID, the longest
  NEAR allows, so registration never under-collects.

## Agent policy behavior

- Policies are keyed by (owner, agent account). The public key is a label for the backend. Naming an account as your agent never affects that account's own funds or anyone else's policy for it.
- `set_agent` creates or updates caps, optional exact-match corridors, cooldown and expiry without resetting same-day spend, charges the policy storage to the owner and refunds the rest of the deposit. `remove_agent` marks the policy revoked and keeps it. A deposit is required for both, so an ordinary function-call key cannot change agent permissions.
- New user accounts are funded with approximately 0.02 NEAR by the account provisioner. This covers one maximum-size policy, tested at no more than 0.01 NEAR, 1 yocto calls and ordinary gas without making the vault subsidize unrelated accounts.
- That 0.02 NEAR does **not** cover a direct `payout` call. The signer must hold the prepaid gas up front, and the 60 Tgas floor cost about 0.06 NEAR at the gas price observed on testnet on 10 November 2026; an agent account holding 0.08 NEAR failed a 150 Tgas payout outright. This does not affect the intended production path, where an agent's call is NEP-366 relayed and the relayer sponsors the gas, but any agent expected to call `payout` directly needs funding sized to the gas floor, not to storage.
- Daily spend includes pending and successful payouts. Parallel attempts therefore cannot race past the limit. A failed transfer releases its same-day amount; a successful payout remains counted even if it is later refunded.
- Cooldown starts when a payout is authorized and remains in force after a failed transfer. Daily buckets use NEAR block timestamp nanoseconds and UTC-sized 24-hour intervals.
- Direct payer calls do not require an agent policy. Agent payout calls require the policy owner to equal the registered order payer. Agent accounts cannot transfer the owner's balance; `transfer` always debits its predecessor's own vault balance.

## Confirmed mainnet configuration

- `payout_timeout` is **1 hour**, 3600000000000 ns. `new` does not take it: initialization always uses the
  10-minute `DEFAULT_PAYOUT_TIMEOUT`, so the owner must call `set_payout_timeout` as the step straight after
  deployment. Launching briefly at 10 minutes is safe, because 10 minutes is the enforced floor and no
  payout can be stuck inside that window anyway. The bounds are 10 minutes to 7 days and the owner can
  change it at any time, so this is not a one-shot choice. A healthy payout settles in
  seconds and cannot reach the stuck state at all, because the callback holds a fixed 20 Tgas under a
  60 Tgas floor and so cannot be starved; the timeout therefore only matters if NEAR itself drops a
  receipt. An hour is far beyond any legitimate in-flight transfer, so an operator resolving at the timeout
  can be confident the transfer is genuinely lost rather than merely slow, while recovery stays a short
  wait instead of a day.
- `max_expiry` stays at 24 hours, as on testnet.
- The approved USDC contract is the native Circle token recorded in `HANDOFF.md`. It is stored once at
  initialization and cannot be changed, so it is the one value that must be right first time.

## Backend-requested behavior

- `transfer` accepts an optional public `request_id` made only of ASCII letters, digits, `-` and `_`, at most 64 bytes. The identifier remains visible in the transaction arguments while the frozen `transferred` event stays unchanged.
- After the timeout the owner may resolve a stuck payout either way; the registration account may only confirm a transfer that happened. The caller verifies the approved-USDC transaction before resolving.
- Cash-out on arrival uses a deliberately scoped agent policy held by fliq; the vault does not add a second standing-permission type in this release.
- Account recovery is not a vault permission. A recovery key or social-recovery account design must be approved and implemented at the NEAR account layer before the recovery-contact screen can claim to restore access.

## Other OPEN contract questions

- The confirmed payout signature is now `payout(order_id, amount, deposit_address)` instead of `payout(order_id)`. This needs backend approval, and the relayer allowlist must permit both additional arguments.
- Public order and payout amounts use near-sdk `U128` JSON values, serialized as decimal strings; the contract keeps `u128` for internal arithmetic. Backend callers must send amounts as JSON strings.

- Is the order ID the same as the backend `po_` payout ID?
- What expiry time unit is final?
- How is corridor encoded?
- The registration account is stored once at initialization; key rotation happens on that account.
- Agent policy identity and daily-limit accounting are implemented as described above.
## Proposed policy identity and failure semantics

- **PROPOSED:** Agent policies are keyed by `(owner, agent account)`. An agent is a distinct NEAR account because a relayed NEP-366 call reports the relayer's key as the signer. The app and backend must never place an agent key on the user's own account: calls from the user's account are treated as the user. The contract cannot see which function-call key signed the transaction.
- **PROPOSED:** A failed payout refunds that payout's daily policy spend but retains the cooldown timestamp. This prevents a failed transfer from consuming the daily allowance while preventing immediate retry abuse.
- **PROPOSED:** A failed payout releases the Dapper reservation and enters terminal `TransferFailed`; it cannot be retried or released again. A stale callback is a no-op.

## Review fixes (November 2026)

Two reviews before mainnet found no way for an outsider to take funds, but found risks that rest on our own keys. These are fixed:

- **Users can always leave.** `withdraw(amount)` (1 yocto) sends the caller's own available USDC to their account with no order and no backend. The amount is reserved while the transfer is in flight, committed when it lands and returned if it fails, so `total_liabilities` is exact at every step. One withdraw per account at a time.
- **Expired orders unlock themselves.** Once a `Registered` order has expired anyone may call `release_order`, so a backend outage or a leaked registration key cannot freeze a balance for longer than the order's expiry (at most 24 hours).
- **The payout timeout is bounded** to between 10 minutes and 7 days. A 1 ns timeout let an operator resolve a payout as not transferred before the real transfer callback ran, leaving the vault owing more than it holds.
- **Only the owner may resolve a stuck payout as not transferred.** That answer gives funds back, so it needs the cold owner key. The registration key may only confirm a transfer that happened.
- **Orders are bound to an agent.** `register_order` takes an optional `agent_id`. Only the payer, or that one agent, may pay the order. An agent cannot pay an order registered without it, so it cannot pay one the user meant to confirm personally.
- **The payout gas floor is 60 Tgas**, so a call that passes the check always has gas left for the transfer and its callback.
- **Every outcome has an event**: failed payouts, resolutions, timeout changes, withdrawals and reversed agent spend.

Upgrading a vault deployed before these fixes: deploy the new code and call `migrate` in the same transaction. Balances, orders and policies are kept.

Still open, for after the hackathon: crediting refunds atomically in `ft_on_transfer` instead of a separate balance read, an owner pause, a rolling 24-hour agent cap instead of the UTC day, and cleaning up terminal orders.

