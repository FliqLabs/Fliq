import { sdkPlaygroundExample } from "./quickstart-examples";
import { CodeBlock } from "../code-block";

export default function DocsSDKContent() {
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
          {"SDK"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "The proposed TypeScript SDK interface is shown below. This repository currently provides generated OpenAPI types; a published SDK package is not included. Python and Swift are planned after the hackathon."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"Install in your own app (optional)"}
        </h2>
        <CodeBlock mode="reference" text={"npm install @fliq/sdk\n\n// or\npnpm add @fliq/sdk"}>
          {"npm install @fliq/sdk\n\n"}
          <span style={{ color: "#7A7A7A" }}>{"// or"}</span>
          {"\npnpm add @fliq/sdk"}
        </CodeBlock>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"Pay someone in ten lines"}
        </h2>
        <p className="text-[13px] leading-6 text-[var(--fg2)]">
          The docs playground preconfigures a demo client. No installation or API key is needed to run this
          example here. For your own app, configure the SDK using the authentication guide.
        </p>
        <CodeBlock text={sdkPlaygroundExample} />
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"What it gives you"}</h2>
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
            <span>{"Thing"}</span>
            <span>{"How"}</span>
            <span>{"Detail"}</span>
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
              {"Types"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"generated"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Every request and response from spec/openapi.yaml. pnpm --filter @fliq/spec generate."}
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
              {"Retries"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"built in"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"429 and 503 with backoff. POST /payouts only with an idempotency key."}
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
              {"watch()"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"helper"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Polls GET /payouts/{id} until a terminal state, or subscribes to your webhook relay."}
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
              {"webhooks.verify()"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"helper"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Signature check with constant-time compare."}</span>
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
              {"Sandbox"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"default"}</span>
            <span style={{ color: "var(--fg2)" }}>{"A test key selects sandbox automatically."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Verify a webhook"}</h2>
        <CodeBlock
          mode="reference"
          text={
            'import { webhooks } from "@fliq/sdk";\n\napp.post("/hooks", express.raw({ type: "*/*" }), (req, res) => {\n  const event = webhooks.verify(req.body, req.header("Fliq-Signature"), process.env.FLIQ_WEBHOOK_SECRET);\n  if (event.type === "payout.settled") markPaid(event.payout_id, event.bank_reference);\n  res.sendStatus(200);\n});'
          }
        >
          {"import { webhooks } from "}
          <span style={{ color: "#F2C879" }}>{'"@fliq/sdk"'}</span>
          {";\n\napp.post("}
          <span style={{ color: "#F2C879" }}>{'"/hooks"'}</span>
          {", express.raw({ type: "}
          <span style={{ color: "#F2C879" }}>{'"*/*"'}</span>
          {" }), (req, res) => {\n  const event = webhooks.verify(req.body, req.header("}
          <span style={{ color: "#F2C879" }}>{'"Fliq-Signature"'}</span>
          {"), process.env.FLIQ_WEBHOOK_SECRET);\n  if (event.type === "}
          <span style={{ color: "#F2C879" }}>{'"payout.settled"'}</span>
          {") markPaid(event.payout_id, event.bank_reference);\n  res.sendStatus(200);\n});"}
        </CodeBlock>
      </section>
    </>
  );
}
