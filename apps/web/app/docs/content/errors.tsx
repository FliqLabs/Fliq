import { CodeBlock } from "../code-block";

export default function DocsErrorsContent() {
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
          {"Errors"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "Every error is JSON with a stable code and a message you can show. Codes never change meaning; new ones are added, old ones stay."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Shape"}</h2>
        <CodeBlock
          text={
            '{ "error": { "code": "quote_expired", "message": "Quote q_31ad77e0 expired 12 seconds ago. Quote again." } }'
          }
        >
          {"{ "}
          <span style={{ color: "#F2C879" }}>{'"error"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"code"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"quote_expired"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"message"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>
            {'"Quote q_31ad77e0 expired 12 seconds ago. Quote again."'}
          </span>
          {" } }"}
        </CodeBlock>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {"Some errors carry extra fields beside "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"error"}</span>
          {" so the UI can explain itself, like the caps on a refusal."}
        </p>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Codes"}</h2>
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
            <span>{"Code"}</span>
            <span>{"Do"}</span>
            <span>{"Meaning"}</span>
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
              {"400 invalid_request"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"fix the call"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Missing or malformed field. message names it."}</span>
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
              {"401 unauthorized"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"fix the key"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Missing, revoked, or wrong environment."}</span>
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
              {"402 insufficient_vault_balance"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"top up"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"available is below the amount. Deposit and retry the same quote if it still holds."}
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
              {"403 vault_cap_exceeded"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"owner action"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Over an agent cap. Carries attempted, per_payout_cap, daily_cap, used_today."}
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
              {"404 account_not_found"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"check number"}</span>
            <span style={{ color: "var(--fg2)" }}>{"The bank returned no name."}</span>
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
              {"409 quote_expired"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"quote again"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Older than expires_in."}</span>
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
              {"409 idempotency_conflict"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"new key"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Same Idempotency-Key with a different body."}</span>
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
              {"422 no_route"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"wait"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"No provider can pay this corridor right now. Status page says why."}
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
              {"423 payouts_paused"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"owner action"}</span>
            <span style={{ color: "var(--fg2)" }}>{"An owner paused the workspace."}</span>
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
              {"429 rate_limited"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"back off"}</span>
            <span style={{ color: "var(--fg2)" }}>{"60 a minute per key. Retry-After is set."}</span>
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
              {"503 provider_unavailable"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"retry"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Transient. Safe to retry with the same Idempotency-Key."}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Refusal, in full"}</h2>
        <CodeBlock
          text={
            '{ "error": { "code": "vault_cap_exceeded", "message": "₦500,000 is over your ₦50,000 per-payout cap and the ₦150,000 daily cap. Nothing moved." },\n  "attempted": 500000, "per_payout_cap": 50000, "daily_cap": 150000, "used_today": 30000 }'
          }
        >
          {"{ "}
          <span style={{ color: "#F2C879" }}>{'"error"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"code"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"vault_cap_exceeded"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"message"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>
            {'"₦500,000 is over your ₦50,000 per-payout cap and the ₦150,000 daily cap. Nothing moved."'}
          </span>
          {" },\n  "}
          <span style={{ color: "#F2C879" }}>{'"attempted"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"500000"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"per_payout_cap"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"50000"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"daily_cap"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"150000"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"used_today"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"30000"}</span>
          {" }"}
        </CodeBlock>
        <div
          style={{
            border: "1px solid var(--good)",
            borderRadius: "12px",
            background: "var(--good-soft)",
            color: "var(--good)",
            padding: "12px 14px",
            fontSize: "13px",
            lineHeight: "1.5",
          }}
        >
          {
            "Show message verbatim. It is written for the person reading it and matches what the app and the push notification say."
          }
        </div>
      </section>
    </>
  );
}
