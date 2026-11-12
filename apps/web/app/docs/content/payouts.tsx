import { CodeBlock } from "../code-block";

export default function DocsPayoutsContent() {
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
          {"Payouts"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "One call moves money. You pass a quote and a verified account, send USDC to the deposit address, and watch the state machine finish in about 20 seconds."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Lifecycle"}</h2>
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"awaiting_deposit"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Created. Deposit address and amount returned."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"deposit_seen"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"USDC landed on NEAR. Provider order placed."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"paying_out"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Provider is sending over NIP or M-Pesa."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"settled"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Money in the account. NIP session attached."}
            </span>
          </div>
        </div>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {"Two side exits: "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"refunded"}
          </span>
          {" when a provider fails (USDC is back in the vault, nothing lost) and "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"refused"}
          </span>
          {" when the vault says no before anything moves."}
        </p>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"POST /v1/payouts"}</h2>
        <CodeBlock
          text={
            '# Create a payout from a quote\ncurl -X POST https://fliq-yclq.onrender.com/v1/payouts \\\n  -H "Authorization: Bearer <YOUR_TEST_KEY>" \\\n  -H "Idempotency-Key: payroll-2026-11-05-dara" \\\n  -d "quote_id=q_31ad77e0&bank=058&number=0123456789"\n\n# 201 Created\n{\n  "payout_id": "po_9c2f71aa",\n  "state": "awaiting_deposit",\n  "account_name": "DARA OKONKWO",\n  "amount": "50.00", "receive": 68816, "currency": "ngn",\n  "rate": 1376.32, "fees": { "provider": 25000, "network": 9400, "total": 34400 },\n  "provider": "paycrest",\n  "deposit": { "chain": "near", "address": "fliq-vault.testnet", "amount": "50.00" },\n  "history": [{ "state": "awaiting_deposit", "at": "2026-10-29T13:02:10Z" }]\n}'
          }
        >
          <span style={{ color: "#7A7A7A" }}>{"# Create a payout from a quote"}</span>
          {"\ncurl -X POST https://fliq-yclq.onrender.com/v1/payouts \\\n  -H "}
          <span style={{ color: "#F2C879" }}>{'"Authorization: Bearer <YOUR_TEST_KEY>"'}</span>
          {" \\\n  -H "}
          <span style={{ color: "#F2C879" }}>{'"Idempotency-Key: payroll-2026-11-05-dara"'}</span>
          {" \\\n  -d "}
          <span style={{ color: "#F2C879" }}>{'"quote_id=q_31ad77e0&bank=058&number=0123456789"'}</span>
          <span style={{ color: "#7A7A7A" }}>{"# 201 Created"}</span>
          {"\n{\n  "}
          <span style={{ color: "#F2C879" }}>{'"payout_id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"po_9c2f71aa"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"state"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"awaiting_deposit"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"account_name"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"DARA OKONKWO"'}</span>
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
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1376.32"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"fees"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"25000"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"network"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"9400"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"total"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"34400"}</span>
          {" },\n  "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"paycrest"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"deposit"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"chain"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"near"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"address"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"fliq-vault.testnet"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"amount"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"50.00"'}</span>
          {" },\n  "}
          <span style={{ color: "#F2C879" }}>{'"history"'}</span>
          {": [{ "}
          <span style={{ color: "#F2C879" }}>{'"state"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"awaiting_deposit"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"at"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"2026-10-29T13:02:10Z"'}</span>
          {" }]\n}"}
        </CodeBlock>
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
            <span>{"Field"}</span>
            <span>{"Type"}</span>
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
              {"quote_id"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>{"From /quote. Must be younger than 90 seconds."}</span>
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"bank"}</span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Institution code, e.g. 058 for GTBank. See Institutions."}
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
              {"number"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>{"10-digit NUBAN or M-Pesa phone number."}</span>
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
              {"Idempotency-Key"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"header"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Any string, kept 24 hours. Same key, same payout, no double send."}
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
              {"reference"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Optional, yours. Shows on the receipt and in webhooks."}
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"metadata"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"object"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Optional, up to 1 KB. Returned untouched."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"Timeline from the fixture"}
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
            <span>{"State"}</span>
            <span>{"At"}</span>
            <span>{"What happened"}</span>
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
              {"awaiting_deposit"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"13:02:10Z"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Payout created from q_31ad77e0."}</span>
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
              {"deposit_seen"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"13:02:11Z"}</span>
            <span style={{ color: "var(--fg2)" }}>{"50.00 USDC at fliq-vault.testnet, 1 second later."}</span>
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
              {"paying_out"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"13:02:13Z"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Paycrest order pc_8c9d1a4b10 placed."}</span>
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
              {"settled"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"13:02:32Z"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"NIP 000013251029140213 in DARA OKONKWO's GTBank account. 21 seconds end to end."}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Reading it back"}</h2>
        <div
          className="docs-flow"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            fontSize: "13px",
          }}
        >
          <span
            style={{
              width: "58px",
              height: "22px",
              borderRadius: "6px",
              background: "var(--good-soft)",
              color: "var(--good)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {"GET"}
          </span>
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"/v1/payouts/{payoutId}"}
          </span>
          <span style={{ color: "var(--muted)" }}>{"The payout, history[] and receipt fields."}</span>
        </div>
        <div
          className="docs-flow"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            fontSize: "13px",
          }}
        >
          <span
            style={{
              width: "58px",
              height: "22px",
              borderRadius: "6px",
              background: "var(--good-soft)",
              color: "var(--good)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {"GET"}
          </span>
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"/v1/payouts"}
          </span>
          <span style={{ color: "var(--muted)" }}>
            {"Newest first. Filter by state, search name, id or NIP."}
          </span>
        </div>
        <div
          className="docs-flow"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            padding: "12px 16px",
            border: "1px solid var(--line)",
            borderRadius: "12px",
            fontSize: "13px",
          }}
        >
          <span
            style={{
              width: "58px",
              height: "22px",
              borderRadius: "6px",
              background: "var(--good-soft)",
              color: "var(--good)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {"GET"}
          </span>
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"/v1/payouts/stats"}
          </span>
          <span style={{ color: "var(--muted)" }}>{"Today's count, volume and median seconds."}</span>
        </div>
        <CodeBlock
          text={
            'GET /v1/payouts/po_9c2f71aa\n{ "payout_id": "po_9c2f71aa", "state": "settled", "seconds": 21,\n  "provider_order": "pc_8c9d1a4b10", "vault_receipt": "ord_7f3a9ec21e", "bank_reference": "000013251029140213",\n  "history": [ … four entries … ] }'
          }
        >
          {"GET /v1/payouts/po_9c2f71aa\n{ "}
          <span style={{ color: "#F2C879" }}>{'"payout_id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"po_9c2f71aa"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"state"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"settled"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"seconds"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"21"}</span>
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
          <span style={{ color: "#F2C879" }}>{'"history"'}</span>
          {": [ … four entries … ] }"}
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
          {"Every settled payout has a public receipt at "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"pay.fliq.money/r/<vault_receipt>"}
          </span>
          {" showing the amount, bank and NIP session, never balances or full account numbers."}
        </div>
      </section>
    </>
  );
}
