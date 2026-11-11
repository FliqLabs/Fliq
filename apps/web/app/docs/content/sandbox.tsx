import Link from "next/link";

export default function DocsSandboxContent() {
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
          {"Sandbox"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "#6B6B6B", lineHeight: "1.5" }}>
          {
            "The same API with test keys and mocked providers. Payouts settle in about 20 seconds, rates move, one account verifies, and nothing you do here costs anything."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"What is mocked"}</h2>
        <div style={{ border: "1px solid #E6E6E6", borderRadius: "14px", overflow: "hidden" }}>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "10px 16px",
              background: "#F6F6F6",
              fontSize: "11px",
              fontWeight: 600,
              color: "#6B6B6B",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              borderBottom: "1px solid #E6E6E6",
            }}
          >
            <span>{"Area"}</span>
            <span>{"Behaviour"}</span>
            <span>{"Detail"}</span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Providers"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"all four"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"Paycrest and Busha quote live. Fonbnk is always stale (240s). Bitnob is paused."}
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Rates"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"fixture ± 0.3%"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"Jitter per quote so your ticker moves. Fixture is 1376.32 after fees."}
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Settlement"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"18 to 24 s"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"Any payout to the fixture recipient settles with NIP 000013251029140213."}
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Verification"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"one account"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"058 / 0123456789 returns DARA OKONKWO. Everything else is account_not_found."}
            </span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"Caps"}</span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"enforced"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {
                "₦50,000 per payout, ₦150,000 daily on the default agent key. Over them you get the exact refusal."
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
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Deposits"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"instant"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"The sandbox vault is pre-funded with $9,842.60 of test USDC. No real chain."}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Test scenarios"}</h2>
        <div style={{ border: "1px solid #E6E6E6", borderRadius: "14px", overflow: "hidden" }}>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "10px 16px",
              background: "#F6F6F6",
              fontSize: "11px",
              fontWeight: 600,
              color: "#6B6B6B",
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              borderBottom: "1px solid #E6E6E6",
            }}
          >
            <span>{"Scenario"}</span>
            <span>{"How"}</span>
            <span>{"Expect"}</span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Happy path"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"$50 to 058 / 0123456789"}</span>
            <span style={{ color: "#3A3A3A" }}>{"settled in ~21s, webhook x3."}</span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Refund"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"reference=force_refund"}</span>
            <span style={{ color: "#3A3A3A" }}>{"paying_out then refunded, funds back."}</span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Refusal"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"amount over cap"}</span>
            <span style={{ color: "#3A3A3A" }}>{"403 vault_cap_exceeded before anything moves."}</span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Expired quote"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"wait 91s"}</span>
            <span style={{ color: "#3A3A3A" }}>{"409 quote_expired."}</span>
          </div>
          <div
            className="docs-columns"
            style={{
              display: "grid",
              gridTemplateColumns: "200px 120px 1fr",
              gap: "14px",
              padding: "11px 16px",
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"Bad account"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"any other number"}</span>
            <span style={{ color: "#3A3A3A" }}>{"404 account_not_found."}</span>
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
              {"Webhook failure"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"endpoint returns 500"}</span>
            <span style={{ color: "#3A3A3A" }}>{"three attempts, then dead letter you can replay."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Going live"}</h2>
        <p style={{ margin: "0", fontSize: "13px", color: "#6B6B6B", lineHeight: "1.5" }}>
          {
            "Live keys exist after KYB. The API, event names and shapes are identical; only the key prefix and the money change. Keep your sandbox key; it still works after you go live."
          }
        </p>
        <div>
          <Link
            href="/dashboard/go-live"
            style={{
              height: "36px",
              padding: "0 14px",
              borderRadius: "10px",
              background: "#111111",
              color: "#ffffff",
              border: "1px solid #111111",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {"Start KYB"}
          </Link>{" "}
          <Link
            href="/dashboard"
            style={{
              height: "36px",
              padding: "0 14px",
              borderRadius: "10px",
              background: "#ffffff",
              color: "#0A0A0A",
              border: "1px solid #E6E6E6",
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              fontWeight: 600,
              textDecoration: "none",
              whiteSpace: "nowrap",
            }}
          >
            {"Create a test payout"}
          </Link>
        </div>
      </section>
    </>
  );
}
