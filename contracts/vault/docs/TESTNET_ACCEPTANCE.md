# Testnet acceptance

The local sandbox covers top-up, registration, payout, failed payout, release, plain-token refund backing and recredit. Production enablement still requires the following run against the deployed vault and approved USDC contract.

## Required accounts

- vault contract account;
- immutable registration account;
- contract owner account;
- approved testnet USDC account;
- funded payer and recipient accounts, each with approximately 0.02 NEAR;
- at least one maximum-size agent policy funded with no more than 0.01 NEAR.

Never record private keys in this repository. Record only public account IDs and transaction hashes.

## Refund proof

1. Register the payer for vault storage and top it up with approved USDC.
2. Register an order, execute `payout`, and confirm the `payout_executed` event.
3. Send a plain approved-USDC `ft_transfer` back to the vault, reproducing the NEAR Intents refund shape. This transfer must not credit a user automatically.
4. From the registration account, call `set_status(order_id, "refunding", { refund_tx })` with the successful refund transaction hash.
5. From the registration account, call `recredit(order_id, amount)`.
6. Confirm the payer's available balance rises by exactly the refund amount, the receipt is `refunded`, and the same order or refund transaction cannot be reused.

## Additional gates

- Exercise a `top_up` `ft_transfer_call` and confirm the emitted `deposited` payload matches `EVENTS.md`.
- Exercise `transfer` with a `request_id` and confirm the backend stores the request against the submitted transaction.
- Leave a payout executing past its timeout, alert both operators, and have the registration account resolve it only after checking the USDC transaction.
- Run `routing` to `with_provider` to `paying_out` to `settled` only after the payout transfer is dispatched.

The contract team signs off the on-chain results. Backend owns refund evidence verification, watcher ingestion and transaction-to-request correlation.
