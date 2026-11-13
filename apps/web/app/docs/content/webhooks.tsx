import { CodeBlock } from "../code-block";

export default function DocsWebhooksContent() {
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
          {"Webhooks"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "A signed POST for every state change. Three attempts, replay from the dashboard, and the payout id in every body so you never have to poll."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Events"}</h2>
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
            <span>{"Event"}</span>
            <span>{"Sent"}</span>
            <span>{"When"}</span>
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
              {"payout.deposit_seen"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"always"}</span>
            <span style={{ color: "var(--fg2)" }}>{'USDC arrived. Good moment to show "sending".'}</span>
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
              {"payout.paying_out"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"always"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Provider has the order."}</span>
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
              {"payout.settled"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"always"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Money landed. Carries NIP session and vault receipt."}
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
              {"payout.refunded"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"always"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Provider failed. Funds back in the vault."}</span>
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
              {"payout.refused"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"always"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Vault cap or policy refused it. Nothing moved."}</span>
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
              {"rate.alert"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"opt in"}</span>
            <span style={{ color: "var(--fg2)" }}>{"A corridor crossed a threshold you set."}</span>
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"agent.connected"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"opt in"}</span>
            <span style={{ color: "var(--fg2)" }}>{"A new agent key was issued on the workspace."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"Body and signature"}
        </h2>
        <CodeBlock
          mode="reference"
          text={
            'POST https://api.yourapp.dev/hooks\nFliq-Signature: t=1762350152,v1=5f8a3c…e21d\nContent-Type: application/json\n\n{\n  "id": "evt_8d1c40aa", "type": "payout.settled", "created_at": "2026-10-29T13:02:32Z",\n  "payout_id": "po_9c2f71aa", "state": "settled",\n  "amount": "50.00", "receive": 68816, "currency": "ngn", "provider": "paycrest",\n  "provider_order": "pc_8c9d1a4b10", "vault_receipt": "ord_7f3a9ec21e", "bank_reference": "000013251029140213",\n  "seconds": 21, "reference": "payroll-2026-11-05-dara"\n}'
          }
        >
          {
            "POST https://api.yourapp.dev/hooks\nFliq-Signature: t=1762350152,v1=5f8a3c…e21d\nContent-Type: application/json\n\n{\n  "
          }
          <span style={{ color: "#F2C879" }}>{'"id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"evt_8d1c40aa"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"type"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"payout.settled"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"created_at"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"2026-10-29T13:02:32Z"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"payout_id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"po_9c2f71aa"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"state"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"settled"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"amount"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"50.00"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"receive"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"68816"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"currency"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"ngn"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"paycrest"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"provider_order"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"pc_8c9d1a4b10"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"vault_receipt"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"ord_7f3a9ec21e"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"bank_reference"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"000013251029140213"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"seconds"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"21"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"reference"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"payroll-2026-11-05-dara"'}</span>
          {"\n}"}
        </CodeBlock>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {"Verify with HMAC-SHA256 over "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {'t + "." + raw_body'}
          </span>
          {
            " using your signing secret, compare in constant time, and reject anything older than 5 minutes. The secret is per endpoint and shown in the dashboard."
          }
        </p>
        <CodeBlock
          mode="reference"
          text={
            '// node\nconst [t, v1] = sig.split(",").map(p => p.split("=")[1]);\nconst expected = crypto.createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");\nif (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) return res.status(401).end();'
          }
        >
          <span style={{ color: "#7A7A7A" }}>{"// node"}</span>
          {
            '\nconst [t, v1] = sig.split(",").map(p => p.split("=")[1]);\nconst expected = crypto.createHmac("sha256", SECRET).update(`${t}.${raw}`).digest("hex");\nif (!crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(v1))) return res.status(401).end();'
          }
        </CodeBlock>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Delivery"}</h2>
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Attempt 1"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Immediately. Any 2xx within 5s counts."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Attempt 2"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"After 1 second."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Attempt 3"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"After 10 seconds, then 60."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Dead"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Kept 30 days. Replay from the dashboard or GET /payouts/{id}."}
            </span>
          </div>
        </div>
        <div
          style={{
            border: "1px solid var(--warn)",
            borderRadius: "12px",
            background: "var(--warn-soft)",
            color: "var(--warn)",
            padding: "12px 14px",
            fontSize: "13px",
            lineHeight: "1.5",
          }}
        >
          {
            "Events for one payout are delivered in order. Across payouts, order is not guaranteed, so key your handler on payout_id and state, and treat a repeat as a no-op."
          }
        </div>
      </section>
    </>
  );
}
