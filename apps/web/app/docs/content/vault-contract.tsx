import { CodeBlock } from "../code-block";

export default function DocsVaultContent() {
  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
        <h1
          style={{
            margin: "0",
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "-0.03em",
            lineHeight: "1.1",
          }}
        >
          {"Vault contract"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "A NEAR contract that holds USDC per user, executes an approved payout order exactly once, and enforces agent caps on chain. The backend never holds funds."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"What it guarantees"}
        </h2>
        <div style={{ border: "1px solid var(--line)", borderRadius: "14px", overflow: "hidden" }}>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "10px 16px",
              background: "var(--panel2)",
              fontSize: "11px",
              fontWeight: 600,
              color: "var(--muted)",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              borderBottom: "1px solid var(--line)",
            }}
          >
            <span>{"Area"}</span>
            <span>{"Scope"}</span>
            <span>{"Rule"}</span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Balances"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"per account"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"available and reserved, fixed integers in USDC minor units. Never floats."}
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Orders"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"once"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {
                "register_order reserves; payout consumes once; release_order on failure. An order id can never execute twice."
              }
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Policies"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"per agent key"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {
                "per_payout_cap, daily_cap, reset at 00:00 WAT, allowed recipients. Checked before any transfer."
              }
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid var(--line)",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Receipts"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"public"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"get_receipt returns the order, amount and provider reference anyone can verify on NEAR."}
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"TTL"}</span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"1 hour"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"MAX_ORDER_TTL. Unexecuted orders expire and release their reservation."}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Methods"}</h2>
        <CodeBlock
          text={
            "// writes, called by the relayer with a NEP-366 delegate signed by the user or agent key\nregister_order(order_id, amount, provider, recipient_hash)   // reserve\npayout(order_id)                                               // consume, transfer out once\nrelease_order(order_id)                                        // provider failed, back to available\nset_status(order_id, status, reference)                        // settled | refunded, with the NIP session\nrecredit(order_id)                                             // refund path, needs proof\n\n// views\nget_balance(account)   get_receipt(order_id)   get_policy(agent_key)   events(from, limit)"
          }
        >
          <span style={{ color: "#7A7A7A" }}>
            {"// writes, called by the relayer with a NEP-366 delegate signed by the user or agent key"}
          </span>
          {"\nregister_order(order_id, amount, provider, recipient_hash)   "}
          <span style={{ color: "#7A7A7A" }}>{"// reserve"}</span>
          {"\npayout(order_id)                                               "}
          <span style={{ color: "#7A7A7A" }}>{"// consume, transfer out once"}</span>
          {"\nrelease_order(order_id)                                        "}
          <span style={{ color: "#7A7A7A" }}>{"// provider failed, back to available"}</span>
          {"\nset_status(order_id, status, reference)                        "}
          <span style={{ color: "#7A7A7A" }}>{"// settled | refunded, with the NIP session"}</span>
          {"\nrecredit(order_id)                                             "}
          <span style={{ color: "#7A7A7A" }}>{"// refund path, needs proof"}</span>
          <span style={{ color: "#7A7A7A" }}>{"// views"}</span>
          {"\nget_balance(account)   get_receipt(order_id)   get_policy(agent_key)   events(from, limit)"}
        </CodeBlock>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {"Deposits arrive by "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"ft_transfer_call"}
          </span>
          {
            " from the USDC contract only; the vault credits the NEP-141 sender. Cross-chain deposits come through NEAR Intents and land the same way, with "
          }
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {'{"top_up":{"account_id"}}'}
          </span>
          {" as the message."}
        </p>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Who can do what"}</h2>
        <div
          className="docs-flow"
          style={{ display: "flex", alignItems: "stretch", gap: "0", flexWrap: "wrap" }}
        >
          <div
            style={{
              flex: "1 1 150px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "14px 16px",
              border: "1px solid var(--line)",
              borderRadius: "12px",
              background: "var(--panel)",
              minWidth: "0",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "11px",
                  background: "var(--ink)",
                  color: "var(--ink-fg)",
                  fontSize: "11px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {"1"}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"User"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Signs with the passkey-backed key. Any amount up to the balance."}
            </span>
          </div>
          <span className="docs-flow" style={{ display: "flex", alignItems: "center", padding: "0 6px" }}>
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8E8E8E"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M9 6l6 6-6 6"></path>
            </svg>
          </span>
          <div
            style={{
              flex: "1 1 150px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "14px 16px",
              border: "1px solid var(--line)",
              borderRadius: "12px",
              background: "var(--panel)",
              minWidth: "0",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "11px",
                  background: "var(--ink)",
                  color: "var(--ink-fg)",
                  fontSize: "11px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {"2"}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Agent key"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Signs delegates. Vault checks caps and the allowlist before moving anything."}
            </span>
          </div>
          <span className="docs-flow" style={{ display: "flex", alignItems: "center", padding: "0 6px" }}>
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8E8E8E"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M9 6l6 6-6 6"></path>
            </svg>
          </span>
          <div
            style={{
              flex: "1 1 150px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "14px 16px",
              border: "1px solid var(--line)",
              borderRadius: "12px",
              background: "var(--panel)",
              minWidth: "0",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "11px",
                  background: "var(--ink)",
                  color: "var(--ink-fg)",
                  fontSize: "11px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {"3"}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Relayer"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {
                "Pays gas and forwards delegates. Allowlisted to payout, release_order and ft_transfer_call. Cannot originate."
              }
            </span>
          </div>
          <span className="docs-flow" style={{ display: "flex", alignItems: "center", padding: "0 6px" }}>
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#8E8E8E"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M9 6l6 6-6 6"></path>
            </svg>
          </span>
          <div
            style={{
              flex: "1 1 150px",
              display: "flex",
              flexDirection: "column",
              gap: "6px",
              padding: "14px 16px",
              border: "1px solid var(--line)",
              borderRadius: "12px",
              background: "var(--panel)",
              minWidth: "0",
            }}
          >
            <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
              <span
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "11px",
                  background: "var(--ink)",
                  color: "var(--ink-fg)",
                  fontSize: "11px",
                  fontWeight: 600,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {"4"}
              </span>
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Nobody"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Can withdraw to an arbitrary address. Payouts go to provider addresses registered on chain."}
            </span>
          </div>
        </div>
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: "12px",
            background: "var(--panel2)",
            color: "var(--fg)",
            padding: "12px 14px",
            fontSize: "13px",
            lineHeight: "1.5",
          }}
        >
          {
            "Changes to balances, permissions or outgoing transfers need two contract owners to approve. Testnet: vault.fliq.testnet, deposits to fliq-vault.testnet."
          }
        </div>
      </section>
    </>
  );
}
