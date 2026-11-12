import Image from "next/image";
import { CodeBlock } from "../code-block";

export default function DocsMCPContent() {
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
          {"Agents and MCP"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "An AI agent pays people from your vault with a key that has caps. The caps live in the vault contract on NEAR, so the agent cannot talk its way past them and neither can anyone who steals the key."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"How it works"}</h2>
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Issue"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Make an agent key in the app or dashboard. Set per-payout and daily caps with Face ID."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Connect"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Add the MCP server to Claude, Cursor or your own runtime."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Pay"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"The agent calls pay(). fliq quotes, verifies the name, and asks the vault."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Enforce"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"Within caps the vault signs. Over caps it refuses and the owner gets a push."}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"MCP config"}</h2>
        <details className="rounded-xl border border-[var(--line)] p-4">
          <summary className="cursor-pointer text-[13px] font-semibold">
            Optional: configure a real agent connection
          </summary>
          <p className="my-3 text-[12px] leading-6 text-[var(--fg2)]">
            Reading the guide needs no key. A real agent connection uses credentials from your workspace.
          </p>{" "}
          <CodeBlock
            mode="reference"
            text={
              '{\n  "mcpServers": {\n    "fliq": {\n      "url": "https://mcp.fliq.money",\n      "env": { "FLIQ_KEY": "<YOUR_TEST_KEY>" }\n    }\n  }\n}'
            }
          >
            {"{\n  "}
            <span style={{ color: "#F2C879" }}>{'"mcpServers"'}</span>
            {": {\n    "}
            <span style={{ color: "#F2C879" }}>{'"fliq"'}</span>
            {": {\n      "}
            <span style={{ color: "#F2C879" }}>{'"url"'}</span>
            {": "}
            <span style={{ color: "#F2C879" }}>{'"https://mcp.fliq.money"'}</span>
            {",\n      "}
            <span style={{ color: "#F2C879" }}>{'"env"'}</span>
            {": { "}
            <span style={{ color: "#F2C879" }}>{'"FLIQ_KEY"'}</span>
            {": "}
            <span style={{ color: "#F2C879" }}>{'"<YOUR_TEST_KEY>"'}</span>
            {" }\n    }\n  }\n}"}
          </CodeBlock>
        </details>
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
            <span>{"Name"}</span>
            <span>{"Kind"}</span>
            <span>{"Does"}</span>
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>{"pay"}</span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"tool"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"name or bank+number, amount, note. Returns the payout id and receipt."}
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
              {"quote"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"tool"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"Preview the rate and receive amount without moving money."}
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
              {"verify_account"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"tool"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Bank name lookup, same as the API."}</span>
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
              {"recipients"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"tool"}</span>
            <span style={{ color: "var(--fg2)" }}>{"The owner's saved people, masked."}</span>
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
              {"limits"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"resource"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"What this key may still spend today. Read it before planning a batch."}
            </span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"A conversation"}</h2>
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <div
            style={{
              borderRadius: "12px",
              background: "var(--panel2)",
              padding: "12px 14px",
              fontSize: "13px",
            }}
          >
            <span style={{ color: "var(--muted)" }}>{"You:"}</span>
            {" Pay Dara ₦30,000 for the studio."}
          </div>
          <div
            className="docs-flow"
            style={{
              borderRadius: "12px",
              background: "var(--panel2)",
              padding: "12px 14px",
              fontSize: "13px",
              display: "flex",
              gap: "10px",
            }}
          >
            <Image
              src="/docs/agent.png"
              alt=""
              width={18}
              height={18}
              style={{ width: "18px", height: "18px", borderRadius: "9px", display: "block" }}
            />
            <span>
              {"Paid ₦30,000 to DARA OKONKWO, Access ···2201, via Paycrest in 20s. Receipt po_4b77…e3c0."}
            </span>
          </div>
          <div
            style={{
              borderRadius: "12px",
              background: "var(--panel2)",
              padding: "12px 14px",
              fontSize: "13px",
            }}
          >
            <span style={{ color: "var(--muted)" }}>{"You:"}</span>
            {" Now send her ₦500,000."}
          </div>
          <div
            className="docs-flow"
            style={{
              borderRadius: "12px",
              background: "var(--warn-soft)",
              padding: "12px 14px",
              fontSize: "13px",
              display: "flex",
              gap: "10px",
            }}
          >
            <Image
              src="/docs/agent.png"
              alt=""
              width={18}
              height={18}
              style={{ width: "18px", height: "18px", borderRadius: "9px", display: "block" }}
            />
            <span>
              {
                "Refused by the vault: ₦500,000 is over your ₦50,000 per-payout cap and the ₦150,000 daily cap. Nothing moved. Raise the cap in the fliq app if you meant it."
              }
            </span>
          </div>
        </div>
        <CodeBlock
          text={
            '# the refusal, as the API returns it\n{ "error": { "code": "vault_cap_exceeded", "message": "₦500,000 is over your ₦50,000 per-payout cap and the ₦150,000 daily cap. Nothing moved." },\n  "attempted": 500000, "per_payout_cap": 50000, "daily_cap": 150000, "used_today": 30000 }'
          }
        >
          <span style={{ color: "#7A7A7A" }}>{"# the refusal, as the API returns it"}</span>
          {"\n{ "}
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
            "Agent keys can only pay saved recipients unless the owner opens them. Changing a cap signs a NEAR transaction with the owner's passkey; the agent has no path to do it."
          }
        </div>
      </section>
    </>
  );
}
