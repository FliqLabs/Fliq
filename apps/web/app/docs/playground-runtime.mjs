export async function runExample(source, fixtures) {
  const logs = [];
  const format = (value) => (typeof value === "string" ? value : JSON.stringify(value, null, 2));
  const print = (...values) => logs.length < 100 && logs.push(values.map(format).join(" ").slice(0, 10000));
  const code = source.trim();
  if (!code) throw new Error("Enter some code before running the example.");
  if (code.length > 30000) throw new Error("Keep examples under 30,000 characters.");

  async function request(input, options = {}) {
    const url = new URL(String(input), "https://fliq-yclq.onrender.com");
    if (!["fliq-yclq.onrender.com", "api.fliq.io", "api.fliq.xyz"].includes(url.hostname)) {
      throw new Error("Use a Fliq API URL. External requests are unavailable in this playground.");
    }
    const method = String(options.method || "GET").toUpperCase();
    const key = `${method} ${url.pathname}`;
    const fixture = fixtures[key];
    if (!fixture)
      throw new Error(`No test response for ${key}. Check the endpoint and HTTP method in API reference.`);
    let body = {};
    if (options.body) {
      try {
        body = JSON.parse(options.body);
      } catch {
        throw new Error("The request body must be valid JSON. Check quotes, commas and brackets.");
      }
    }
    if (method === "POST" && (!body || Array.isArray(body) || typeof body !== "object")) {
      throw new Error("The request body must be a JSON object.");
    }
    if (key === "POST /v1/quote" || key === "POST /v1/quotes") {
      if (body.token !== "usdc" || body.currency !== "ngn" || body.amount !== "50.00") {
        throw new Error(
          'This demo supports token "usdc", currency "ngn" and amount "50.00". Other inputs need the actual sandbox API.',
        );
      }
    }
    if (key.endsWith("/verify")) {
      if (body.bank !== "058" || body.number !== "0123456789") {
        throw new Error("account_not_found: the demo account is bank 058, number 0123456789.");
      }
    }
    if (key === "POST /v1/payouts") {
      const account = body.account;
      if (
        body.quote_id !== fixtures["POST /v1/quote"].quote_id ||
        account?.bank !== "058" ||
        account?.number !== "0123456789"
      ) {
        throw new Error('Use the demo quote_id and account { bank: "058", number: "0123456789" }.');
      }
    }
    const value = structuredClone(fixture);
    logs.push(`${method} ${url.pathname} · Test response`);
    const status = key === "POST /v1/payouts" ? 201 : 200;
    return { ok: true, status, json: async () => value, text: async () => JSON.stringify(value) };
  }

  if (/^[\[{]/.test(code)) {
    try {
      return `Valid JSON\n${JSON.stringify(JSON.parse(code), null, 2)}`;
    } catch (error) {
      throw new Error(`Invalid JSON: ${error.message}`);
    }
  }
  if (/^(?:#.*\n\s*)*curl\s/.test(code)) {
    // Documentation often places a sample response after a blank line.
    const command = code.split(/\n\s*\n/)[0].replace(/\\\r?\n/g, " ");
    const tokens = [];
    const pattern = /"(?:\\.|[^"\\])*"|'[^']*'|[^\s]+/g;
    for (const match of command.matchAll(pattern)) {
      const token = match[0];
      tokens.push(
        token.startsWith('"') ? JSON.parse(token) : token.startsWith("'") ? token.slice(1, -1) : token,
      );
    }
    if (tokens[0] !== "curl") throw new Error("Start the request with curl.");
    let url;
    let method;
    let body;
    for (let i = 1; i < tokens.length; i++) {
      const token = tokens[i];
      if (token === "-X" || token === "--request") method = tokens[++i];
      else if (["-d", "--data", "--data-raw"].includes(token)) body = tokens[++i];
      else if (token === "-H" || token === "--header") {
        if (!tokens[++i]) throw new Error("Add a header after -H.");
      } else if (token === "-s" || token === "--silent") continue;
      else if (/^https:\/\//.test(token)) url = token;
      else throw new Error(`Unsupported curl argument: ${token}. Use -X, -H and -d.`);
    }
    if (!url) throw new Error("Add a valid HTTPS Fliq API URL after curl.");
    if (method === undefined) method = body === undefined ? "GET" : "POST";
    const response = await request(url, { method, body });
    return `${logs.join("\n")}\n${JSON.stringify(await response.json(), null, 2)}`;
  }
  if (
    /^(npm |pnpm |yarn |cargo |export |#|import .* from ['"](?:ethers|viem|@modelcontextprotocol))/.test(code)
  ) {
    throw new Error(
      "This setup or server-side example runs in your own terminal. The playground runs JSON, curl requests and JavaScript examples.",
    );
  }
  const runnable = code.replace(/import\s*\{\s*Fliq\s*\}\s*from\s*['"]@fliq\/sdk['"];?/g, "");
  class Fliq {
    accounts = {
      verify: async (body) =>
        (await request("/v1/accounts/verify", { method: "POST", body: JSON.stringify(body) })).json(),
    };
    quotes = {
      create: async (body) =>
        (await request("/v1/quote", { method: "POST", body: JSON.stringify(body) })).json(),
    };
    payouts = {
      create: async (body) =>
        (
          await request("/v1/payouts", {
            method: "POST",
            body: JSON.stringify({
              quote_id: body.quoteId,
              account: { bank: body.bank, number: body.number },
            }),
          })
        ).json(),
      watch: async function* () {
        yield structuredClone(fixtures.settled);
      },
    };
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const execute = new AsyncFunction("fetch", "console", "process", "Fliq", "quote", runnable);
  const result = await execute(
    request,
    { log: print, error: print, warn: print, info: print },
    { env: { FLIQ_KEY: "<PLAYGROUND_TEST_KEY>" } },
    Fliq,
    fixtures["POST /v1/quote"],
  );
  if (result !== undefined) print(result);
  return logs.join("\n") || "Code completed successfully. Use console.log(...) to display a value.";
}
