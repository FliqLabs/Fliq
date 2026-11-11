import { CodeBlock } from "../code-block";

export default function DocsRatesContent() {
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
          {"Rates (public)"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "#6B6B6B", lineHeight: "1.5" }}>
          {
            "The best after-fee rate for every corridor, refreshed every 10 seconds, with the official and P2P references beside it. No key, CORS open, free to embed."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"GET /v1/rates/{token}/{currency}"}
        </h2>
        <CodeBlock
          text={
            'curl https://fliq-yclq.onrender.com/v1/rates/usdc/ngn\n\n{\n  "token": "usdc", "currency": "ngn",\n  "rate": 1376.32, "rate_before_fees": 1383.2, "spread": 17.92,\n  "provider": "paycrest", "providers_quoting": 3,\n  "official": { "source": "cbn_nfem_close", "rate": 1348.01 },\n  "p2p": { "source": "bybit_usdt_ngn_median_top10", "rate": 1381.85 },\n  "change_24h": 0.0042, "fetched_at": "2026-10-29T13:02:13Z"\n}'
          }
        >
          {"curl https://fliq-yclq.onrender.com/v1/rates/usdc/ngn\n\n{\n  "}
          <span style={{ color: "#F2C879" }}>{'"token"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"usdc"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"currency"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"ngn"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1376.32"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"rate_before_fees"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1383.2"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"spread"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"17.92"}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"provider"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"paycrest"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"providers_quoting"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"3"}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"official"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"source"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"cbn_nfem_close"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1348.01"}</span>
          {" },\n  "}
          <span style={{ color: "#F2C879" }}>{'"p2p"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"source"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"bybit_usdt_ngn_median_top10"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"rate"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"1381.85"}</span>
          {" },\n  "}
          <span style={{ color: "#F2C879" }}>{'"change_24h"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"0.0042"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"fetched_at"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"2026-10-29T13:02:13Z"'}</span>
          {"\n}"}
        </CodeBlock>
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
              borderBottom: "1px solid #E6E6E6",
              fontSize: "13px",
              alignItems: "baseline",
            }}
          >
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"rate"}</span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"number"}</span>
            <span style={{ color: "#3A3A3A" }}>{"After fees, for $50. The headline number everywhere."}</span>
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
              {"spread"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"number"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"P2P median minus our after-fee rate. How much the user keeps versus the street."}
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
              {"official"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"object"}</span>
            <span style={{ color: "#3A3A3A" }}>{"CBN NFEM close. Context only; nobody pays out at it."}</span>
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"p2p"}</span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"object"}</span>
            <span style={{ color: "#3A3A3A" }}>{"Median of Bybit's top 10 USDT/NGN offers."}</span>
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
              {"providers_quoting"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"integer"}</span>
            <span style={{ color: "#3A3A3A" }}>{"How many of the 4 were live for this sample."}</span>
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
              {"fetched_at"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"timestamp"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {'Show it. Past 60s turn amber, past 5 minutes say "not live".'}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Corridors"}</h2>
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
            <span>{"Path"}</span>
            <span>{"Rail"}</span>
            <span>{"Where"}</span>
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
              {"usdc/ngn"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"bank"}</span>
            <span style={{ color: "#3A3A3A" }}>{"Nigeria, NIP. The hackathon corridor."}</span>
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
              {"usdc/ngn?rail=opay"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"mobile money"}</span>
            <span style={{ color: "#3A3A3A" }}>{"Nigeria, OPay."}</span>
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
              {"usdt/ngn"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"bank"}</span>
            <span style={{ color: "#3A3A3A" }}>{"Nigeria, from USDT."}</span>
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
              {"usdc/kes"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"M-Pesa"}</span>
            <span style={{ color: "#3A3A3A" }}>{"Kenya."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Embedding"}</h2>
        <p style={{ margin: "0", fontSize: "13px", color: "#6B6B6B", lineHeight: "1.5" }}>
          {"The public pages at "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"fliq.money/rates"}
          </span>
          {" and "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"/rates/usdc-ngn"}
          </span>
          {
            " are built on this endpoint. The OG image updates with the rate every 10 minutes, so a shared link always shows a current number."
          }
        </p>
        <div
          style={{
            border: "1px solid #E6E6E6",
            borderRadius: "12px",
            background: "#F6F6F6",
            color: "#0A0A0A",
            padding: "12px 14px",
            fontSize: "13px",
            lineHeight: "1.5",
          }}
        >
          {"Rate limit is 120 requests a minute per IP. Cache for 10 seconds and you will never hit it."}
        </div>
      </section>
    </>
  );
}
