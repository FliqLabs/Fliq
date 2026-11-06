# Storage decision

The unit-test measurement for a representative order plus receipt is 219 bytes. The unit-test storage byte price is 10,000,000,000,000,000,000 yoctoNEAR, so the measured cost is 2,190,000,000,000,000,000,000 yoctoNEAR (0.00000219 NEAR) per order plus receipt. The contract currently keeps orders and receipts and does not delete them.

Options:

1. Keep every order and receipt forever. The vault account pays ongoing storage; this is simplest and preserves the complete audit trail.
2. Keep every order and receipt, requiring the registration account to attach a deposit covering the measured bytes. The registration account pays, and future protocol storage-price changes require a policy for top-ups.
3. After retention, delete heavy receipt details but keep a permanent order-ID/final-state tombstone. The registration account pays initial storage; deletion is safe only with the tombstone because deleting the full order would allow the same ID to be registered and paid again.

Recommendation: option (1) for the hackathon release. It has no retention job, no tombstone migration, and no risk of accidentally reopening an ID. Revisit option (3) only after a permanent tombstone schema and retention authority are approved.
