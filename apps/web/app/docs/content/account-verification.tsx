import { CodeBlock } from "../code-block";

export default function DocsVerifyContent() {
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
          {"Account verification"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "Before anything moves, the bank tells you whose account it is. The name comes from the bank, not from the user, and it is shown on the confirm screen and the receipt."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"POST /v1/accounts/verify"}
        </h2>
        <CodeBlock
          text={
            'curl -X POST https://fliq-yclq.onrender.com/v1/accounts/verify \\\n  -H "Authorization: Bearer <YOUR_TEST_KEY>" \\\n  -d "bank=058&number=0123456789"\n\n{ "bank": "058", "number": "0123456789", "account_name": "DARA OKONKWO", "institution": "GTBank" }\n\n# unknown account\n{ "error": { "code": "account_not_found", "message": "GTBank returned no name for 0123456780." } }'
          }
        >
          {"curl -X POST https://fliq-yclq.onrender.com/v1/accounts/verify \\\n  -H "}
          <span style={{ color: "#F2C879" }}>{'"Authorization: Bearer <YOUR_TEST_KEY>"'}</span>
          {" \\\n  -d "}
          <span style={{ color: "#F2C879" }}>{'"bank=058&number=0123456789"'}</span>
          {"\n\n{ "}
          <span style={{ color: "#F2C879" }}>{'"bank"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"058"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"number"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"0123456789"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"account_name"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"DARA OKONKWO"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"institution"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"GTBank"'}</span>
          {" }\n\n"}
          <span style={{ color: "#7A7A7A" }}>{"# unknown account"}</span>
          {"\n{ "}
          <span style={{ color: "#F2C879" }}>{'"error"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"code"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"account_not_found"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"message"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"GTBank returned no name for 0123456780."'}</span>
          {" } }"}
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"bank"}</span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Institution code from /institutions."}</span>
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
            <span style={{ color: "var(--fg2)" }}>
              {"10 digits for Nigerian banks, phone number for M-Pesa and OPay."}
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
              {"account_name"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Exactly as the bank returns it, usually upper case. Show it verbatim."}
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
              {"institution"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Display name for the UI."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"In the product"}</h2>
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Type"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Counter shows n/10. Nothing is sent until the tenth digit."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Ask"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {'"Asking GTBank…" for about a second.'}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Show"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {'Name in green with the bank\'s tick, or an amber "No account found".'}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Save"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"POST /recipients stores it masked, ···6789, for next time."}
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
            "Verification is cached for 24 hours per bank and number, so the confirm screen and the payout both reuse it. The name on a payout is frozen at creation."
          }
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Saved recipients"}</h2>
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
            {"/v1/recipients"}
          </span>
          <span style={{ color: "var(--muted)" }}>{"Newest first. Numbers always masked."}</span>
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
              background: "var(--accent-soft)",
              color: "var(--accent)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {"POST"}
          </span>
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"/v1/recipients"}
          </span>
          <span style={{ color: "var(--muted)" }}>
            {"Verify and save in one call. Saving twice returns the existing one."}
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
              background: "var(--bad-soft)",
              color: "var(--bad)",
              fontSize: "11px",
              fontWeight: 700,
              letterSpacing: "0.04em",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            {"DELETE"}
          </span>
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"/v1/recipients/{recipientId}"}
          </span>
          <span style={{ color: "var(--muted)" }}>{"Remove. Past receipts keep the name."}</span>
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
            "Sandbox resolves exactly one account: bank 058, number 0123456789, DARA OKONKWO. Everything else returns account_not_found so you can test the error path."
          }
        </div>
      </section>
    </>
  );
}
