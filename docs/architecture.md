# Architecture

The full picture is drawn on the team board, fliq Platform Architecture and Handoff v1 (FigJam, FliqLabs team), as 14 diagrams:

1. Platform architecture
2. App sitemap, 42 screens
3. Web sitemap, 19 pages
4. Sign in, passkey and vault creation
5. Pay flow, every decision
6. Payout sequence, $50 to DARA OKONKWO in 21 seconds
7. Agent path through the vault
8. Scope map: hackathon, after, cut
9. Build timeline by owner
10. Payout state machine and webhook events
11. Operations after the hackathon
12. Analytics pipeline
13. Business pipeline, sandbox to live corridors
14. This repository: layout, owners and how a change reaches main

The written reference is the fliq Build Handoff doc. Design source of truth: fliq App Design v5 and fliq Web Design v4.

## In one paragraph

Clients (the iPhone app, the web dashboard, the public site and AI agents through MCP) only ever call the fliq API. The API quotes every provider, picks the best after-fee rate, registers an order with the NEAR vault, and the vault releases USDC to the provider's deposit address only if the payer's balance and the agent's caps allow it. The provider pays the bank; the API records the bank reference from provider evidence and sends signed webhooks for every state change. A USDC transfer to the provider is never treated as proof that the bank paid.

## Payout states

`awaiting_deposit` → `deposit_seen` → `paying_out` → `settled`, with `refused`, `refunded` and `not_received` as branches. Each transition fires a `payout.<state>` webhook.
