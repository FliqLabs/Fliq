import { CodeBlock } from "../code-block";

export default function DocsQuotesContent() {
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
          {"Quotes"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "A quote is a promise: this many naira, from this provider, held for 90 seconds. Every payout starts from one."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"How a quote is made"}
        </h2>
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Fan out"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Every eligible provider is asked in parallel, 1.5 second budget."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Score"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"After-fee rate 70%, on-time rate 20%, speed 10%. Stale quotes (over 60s) are excluded."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Hold"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"The best route is the quote. It holds for expires_in seconds."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Pay"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"POST /payouts with the quote_id. After 90s you get quote_expired."}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"POST /v1/quote"}</h2>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {"The short form: best route only. Use "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"POST /v1/quotes"}
          </span>
          {" when you want every route with its score, for example to show a route picker."}
        </p>
        <CodeBlock
          text={
            'curl -X POST https://fliq-yclq.onrender.com/v1/quote \\\n  -H "Authorization: Bearer <YOUR_TEST_KEY>" \\\n  -d "token=USDC&currency=NGN&amount=50"\n\n{\n  "quote_id": "q_31ad77e0", "token": "usdc", "currency": "ngn", "amount": "50.00",\n  "rate_before_fees": 1383.2,\n  "fees": { "provider": 25000, "network": 9400, "total": 34400 },\n  "rate": 1376.32, "receive": 68816,\n  "provider": "paycrest", "best_of": 4,\n  "routes": [\n    { "provider": "paycrest", "status": "live",   "rate": 1376.32, "age_seconds": 6,   "routed": true },\n    { "provider": "busha",    "status": "live",   "rate": 1370.08, "age_seconds": 9,   "routed": false },\n    { "provider": "fonbnk",   "status": "stale",  "rate": 1358.4,  "age_seconds": 240, "routed": false },\n    { "provider": "bitnob",   "status": "paused", "rate": null, "routed": false }\n  ],\n  "expires_in": 90\n}'
          }
        >
          {"curl -X POST https://fliq-yclq.onrender.com/v1/quote \\\n  -H "}
          <span style={{ color: "#F2C879" }}>{'"Authorization: Bearer <YOUR_TEST_KEY>"'}</span>
          {" \\\n  -d "}
          <span style={{ color: "#F2C879" }}>{'"token=USDC&currency=NGN&amount=50"'}</span>
          {"\n\n{\n  "}
          <span style={{ color: "#F2C879" }}>{'"quote_id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"q_31ad77e0"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"token"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"usdc"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"currency"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"ngn"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"amount"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"50.00"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"rate_before_fees"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1383.2"}</span>
          {",\n  "}
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
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1376.32"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"receive"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"68816"}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"paycrest"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"best_of"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"4"}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"routes"'}</span>
          {": [\n    { "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"paycrest"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"status"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"live"'}</span>
          {",   "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1376.32"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"age_seconds"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"6"}</span>
          {",   "}
          <span style={{ color: "#F2C879" }}>{'"routed"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"true"}</span>
          {" },\n    { "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"busha"'}</span>
          {",    "}
          <span style={{ color: "#F2C879" }}>{'"status"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"live"'}</span>
          {",   "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1370.08"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"age_seconds"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"9"}</span>
          {",   "}
          <span style={{ color: "#F2C879" }}>{'"routed"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"false"}</span>
          {" },\n    { "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"fonbnk"'}</span>
          {",   "}
          <span style={{ color: "#F2C879" }}>{'"status"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"stale"'}</span>
          {",  "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1358.4"}</span>
          {",  "}
          <span style={{ color: "#F2C879" }}>{'"age_seconds"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"240"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"routed"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"false"}</span>
          {" },\n    { "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"bitnob"'}</span>
          {",   "}
          <span style={{ color: "#F2C879" }}>{'"status"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"paused"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"null"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"routed"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"false"}</span>
          {" }\n  ],\n  "}
          <span style={{ color: "#F2C879" }}>{'"expires_in"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"90"}</span>
          {"\n}"}
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
              {"amount"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"USD amount as a decimal string. Minimum 2.00 in sandbox."}
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
              {"rate_before_fees"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"number"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Provider mid rate before any fee."}</span>
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
              {"fees.*"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"integer"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Minor units (kobo). provider + network = total."}</span>
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"rate"}</span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"number"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"What the user actually gets per dollar, after fees. This is the number the app shows."}
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
              {"receive"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"integer"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Whole naira landing in the account. Never a float."}
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
              {"routes[].status"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"enum"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"live, stale (quote older than 60s, excluded), paused (provider off)."}
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
              {"expires_in"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"integer"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Seconds the quote holds. 90 today."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"When the quote moves"}
        </h2>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            'If the rate changes by more than 0.1% while the user is looking, the app shows "Rate updated" and asks for a fresh confirm. Never pay on a stale quote; the API refuses it anyway with '
          }
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"409 quote_expired"}
          </span>
          {"."}
        </p>
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
            "In sandbox the rate jitters ±0.3% per quote so your UI gets exercised. Fonbnk is always stale and Bitnob always paused there."
          }
        </div>
      </section>
    </>
  );
}
