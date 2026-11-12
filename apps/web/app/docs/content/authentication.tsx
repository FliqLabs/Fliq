import { CodeBlock } from "../code-block";

export default function DocsAuthContent() {
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
          {"Authentication"}
        </h1>
        <p style={{ margin: "0", fontSize: "14px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "Two audiences, two mechanisms. Servers and agents use API keys. People use passkeys in the app and the dashboard, with an emailed link as the fallback."
          }
        </p>
      </div>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"API keys"}</h2>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {"A key is a Bearer token scoped to one workspace and one environment. Sandbox keys start with "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"rt_test_"}
          </span>
          {", live keys with "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"rt_live_"}
          </span>
          {
            " and exist only after KYB. Agent keys carry caps enforced by the vault contract, so a leaked agent key cannot exceed what the owner set."
          }
        </p>
        <CodeBlock
          text={
            'curl https://fliq-yclq.onrender.com/v1/vault \\\n  -H "Authorization: Bearer <YOUR_TEST_KEY>"\n\n# 401 when the key is missing, revoked, or a sandbox key hits the live API\n{ "error": { "code": "unauthorized", "message": "Missing or invalid API key." } }'
          }
        >
          {"curl https://fliq-yclq.onrender.com/v1/vault \\\n  -H "}
          <span style={{ color: "#F2C879" }}>{'"Authorization: Bearer <YOUR_TEST_KEY>"'}</span>
          <span style={{ color: "#7A7A7A" }}>
            {"# 401 when the key is missing, revoked, or a sandbox key hits the live API"}
          </span>
          {"\n{ "}
          <span style={{ color: "#F2C879" }}>{'"error"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"code"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"unauthorized"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"message"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"Missing or invalid API key."'}</span>
          {" } }"}
        </CodeBlock>
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
            "Keys are shown once, at creation. Roll a key from the dashboard if it leaks; the old secret keeps answering for 10 minutes so you can switch without downtime."
          }
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Passkeys (people)"}</h2>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {
            "No passwords anywhere. Registration and sign-in are both two calls: get options, verify the signed response. The session is a 15-minute access token plus a refresh token."
          }
        </p>
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Options"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"POST /auth/passkeys/register/options returns a WebAuthn challenge."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Sign"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"The device signs it with Face ID or Touch ID."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Verify"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"POST …/register/verify opens the session and creates the user."}
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
              <span style={{ fontSize: "13px", fontWeight: 600 }}>{"Refresh"}</span>
            </span>
            <span style={{ fontSize: "12px", color: "var(--muted)", lineHeight: "1.45" }}>
              {"POST /auth/refresh rotates the refresh token every 15 minutes."}
            </span>
          </div>
        </div>
        <CodeBlock
          text={
            'POST /v1/auth/passkeys/register/options\n{ "challenge_id": "chl_6e90b3f1", "options": { "challenge": "Zm9yLWRlbW8tb25seQ", "rp": { "id": "fliq.cash", "name": "fliq" }, "timeout": 60000 } }\n\nPOST /v1/auth/passkeys/register/verify\n{ "access_token": "at_demo_f3k9", "expires_in": 900, "refresh_token": "rf_demo_b81q",\n  "user": { "user_id": "usr_5d1c0a9e", "near_account": "frank.fliq.near", "display_name": "Frank", "vault": "fliq-vault.testnet" } }'
          }
        >
          {"POST /v1/auth/passkeys/register/options\n{ "}
          <span style={{ color: "#F2C879" }}>{'"challenge_id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"chl_6e90b3f1"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"options"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"challenge"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"Zm9yLWRlbW8tb25seQ"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"rp"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"fliq.cash"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"name"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"fliq"'}</span>
          {" }, "}
          <span style={{ color: "#F2C879" }}>{'"timeout"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"60000"}</span>
          {" } }\n\nPOST /v1/auth/passkeys/register/verify\n{ "}
          <span style={{ color: "#F2C879" }}>{'"access_token"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"at_demo_f3k9"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"expires_in"'}</span>
          {": "}
          <span style={{ color: "#8ED1A0" }}>{"900"}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"refresh_token"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"rf_demo_b81q"'}</span>
          {",\n  "}
          <span style={{ color: "#F2C879" }}>{'"user"'}</span>
          {": { "}
          <span style={{ color: "#F2C879" }}>{'"user_id"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"usr_5d1c0a9e"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"near_account"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"frank.fliq.near"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"display_name"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"Frank"'}</span>
          {", "}
          <span style={{ color: "#F2C879" }}>{'"vault"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"fliq-vault.testnet"'}</span>
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
            <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
              {"access_token"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Bearer for the app and dashboard. 15 minutes."}</span>
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
              {"refresh_token"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Single use; rotated by /auth/refresh."}</span>
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
              {"user.near_account"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>
              {"The claimed name. The vault sub-account lives behind it."}
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
              {"user.vault"}
            </span>
            <span style={{ color: "var(--muted)", fontSize: "12px" }}>{"string"}</span>
            <span style={{ color: "var(--fg2)" }}>{"Vault account that receives deposits."}</span>
          </div>
        </div>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>
          {"Email link (fallback)"}
        </h2>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          {"For a person without a passkey on this device. "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"POST /auth/email-links"}
          </span>
          {" sends a link that works once and expires in 15 minutes; "}
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"POST /auth/email-links/verify"}
          </span>
          {" exchanges the token for the same session shape."}
        </p>
        <CodeBlock
          text={'POST /v1/auth/email-links  { "email": "frank@fliq.money" }\n→ { "status": "sent" }'}
        >
          {"POST /v1/auth/email-links  { "}
          <span style={{ color: "#F2C879" }}>{'"email"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"frank@fliq.money"'}</span>
          {" }\n→ { "}
          <span style={{ color: "#F2C879" }}>{'"status"'}</span>
          {": "}
          <span style={{ color: "#F2C879" }}>{'"sent"'}</span>
          {" }"}
        </CodeBlock>
      </section>
      <section style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <h2 style={{ fontSize: "16px", fontWeight: 600, letterSpacing: "-0.01em" }}>{"Signing out"}</h2>
        <p style={{ margin: "0", fontSize: "13px", color: "var(--muted)", lineHeight: "1.5" }}>
          <span style={{ fontFamily: "var(--font-docs-mono), monospace", fontSize: "12px" }}>
            {"POST /auth/logout"}
          </span>
          {
            " revokes the current session. Owners can end every other session from Security in the app, or from workspace settings on the web."
          }
        </p>
      </section>
    </>
  );
}
