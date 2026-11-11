import { CodeBlock } from "../code-block";

export default function DocsInstitutionsContent() {
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
          {"Institutions"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "#6B6B6B", lineHeight: "1.5" }}>
          {
            "Banks and mobile-money providers you can pay into, by country, with the logo key the app uses. Public, no key needed, cached for an hour."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"GET /v1/institutions?country=ng"}
        </h2>
        <CodeBlock
          text={
            '{ "items": [\n  { "code": "058",    "name": "GTBank",      "type": "bank",         "country": "ng", "logo_key": "gtbank" },\n  { "code": "044",    "name": "Access Bank", "type": "bank",         "country": "ng", "logo_key": "access-bank" },\n  { "code": "999992", "name": "OPay",        "type": "mobile_money", "country": "ng", "logo_key": "opay" }\n] }'
          }
        >
          {"{ "}
          <span style={{ color: "#F2C879" }}>{'"items"'}</span>
          {": [\n  { "}
          <span style={{ color: "#F2C879" }}>{'"code"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"058"'}</span>
          {",    "}
          <span style={{ color: "#F2C879" }}>{'"name"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"GTBank"'}</span>
          {",      "}
          <span style={{ color: "#F2C879" }}>{'"type"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"bank"'}</span>
          {",         "}
          <span style={{ color: "#F2C879" }}>{'"country"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"ng"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"logo_key"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"gtbank"'}</span>
          {" },\n  { "}
          <span style={{ color: "#F2C879" }}>{'"code"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"044"'}</span>
          {",    "}
          <span style={{ color: "#F2C879" }}>{'"name"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"Access Bank"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"type"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"bank"'}</span>
          {",         "}
          <span style={{ color: "#F2C879" }}>{'"country"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"ng"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"logo_key"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"access-bank"'}</span>
          {" },\n  { "}
          <span style={{ color: "#F2C879" }}>{'"code"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"999992"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"name"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"OPay"'}</span>
          {",        "}
          <span style={{ color: "#F2C879" }}>{'"type"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"mobile_money"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"country"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"ng"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"logo_key"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"opay"'}</span>
          {" }\n] }"}
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"country"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"query"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"ng (default), ke, gh, id, ph. Only ng and ke have live providers today."}
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"code"}</span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"The code you pass as bank to verify and payouts. CBN codes for NG banks."}
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"type"}</span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"enum"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"bank or mobile_money. Mobile money takes a phone number."}
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
              {"logo_key"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "#3A3A3A" }}>{"Asset name in the app bundle and the web sprite."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Coverage today"}</h2>
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
            <span>{"Country"}</span>
            <span>{"Currency"}</span>
            <span>{"Rails and providers"}</span>
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
              {"Nigeria"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"NGN"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"All NIP banks, OPay, PalmPay, Moniepoint via Paycrest and Busha. Fonbnk for mobile money."}
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
              {"Kenya"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"KES"}</span>
            <span style={{ color: "#3A3A3A" }}>{"M-Pesa via Busha."}</span>
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
              {"Ghana"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"GHS"}</span>
            <span style={{ color: "#3A3A3A" }}>
              {"Mobile money via Bitnob. Sandbox only until Bitnob KYB."}
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
              {"Indonesia, Philippines"}
            </span>
            <span style={{ color: "#6B6B6B", fontSize: "12px" }}>{"IDR, PHP"}</span>
            <span style={{ color: "#3A3A3A" }}>{"TransFi. Listed, live after KYB."}</span>
          </div>
        </div>
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
          {
            "Institutions are the same across providers. fliq routes the payout; the user never picks a provider, only a bank."
          }
        </div>
      </section>
    </>
  );
}
