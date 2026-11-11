import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { initiatePajSession, verifyPajSession } from "../app/lib/paj-session.ts";

const KEY = "test-business-key";
const realFetch = globalThis.fetch;
let calls;

function mockFetch({
  me = 200,
  paj = () => Response.json({ email: "ada@example.com" }, { status: 201 }),
} = {}) {
  calls = [];
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith("/me")) return new Response("{}", { status: me });
    return paj();
  };
}

function post(body, token = "fliq-session") {
  return new Request("http://localhost/api/paj", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

const verifyBody = {
  phone: "+2348012345678",
  otp: "1234",
  device: { uuid: "device-1", device: "iPhone", os: "iOS" },
};

beforeEach(() => {
  process.env.PAJ_BUSINESS_API_KEY = KEY;
  process.env.FLIQ_API_BASE_URL = "https://fliq.test/v1";
  delete process.env.PAJ_API_BASE_URL;
  mockFetch();
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

test("no bearer token is refused without calling Paj", async () => {
  const response = await initiatePajSession(post({ email: "ada@example.com" }, null));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "sign_in_required" });
  assert.equal(calls.length, 0);
});

test("a token fliq rejects is refused without calling Paj", async () => {
  mockFetch({ me: 401 });
  const response = await verifyPajSession(post(verifyBody, "expired"));
  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "sign_in_required" });
  assert.deepEqual(
    calls.map((call) => call.url),
    ["https://fliq.test/v1/me"],
  );
  assert.equal(calls[0].init.headers.Authorization, "Bearer expired");
});

test("bad input is a 400 and never reaches Paj", async () => {
  const cases = [
    [initiatePajSession, {}],
    [initiatePajSession, { email: "ada@example.com", phone: "+2348012345678" }],
    [initiatePajSession, { email: "not-an-email" }],
    [initiatePajSession, { phone: "08012345678" }],
    [initiatePajSession, { phone: "+1234567" }],
    [verifyPajSession, { ...verifyBody, otp: "12" }],
    [verifyPajSession, { ...verifyBody, otp: "12a4" }],
    [verifyPajSession, { ...verifyBody, device: undefined }],
    [verifyPajSession, { ...verifyBody, device: { device: "iPhone" } }],
    [verifyPajSession, { ...verifyBody, device: { uuid: "x".repeat(101), device: "iPhone" } }],
  ];
  for (const [handler, body] of cases) {
    mockFetch();
    const response = await handler(post(body));
    assert.equal(response.status, 400, JSON.stringify(body));
    const result = await response.json();
    assert.equal(result.error, "invalid_request");
    assert.equal(typeof result.message, "string");
    assert.equal(
      calls.some((call) => !call.url.endsWith("/me")),
      false,
    );
  }
});

test("a missing business key is a 503", async () => {
  delete process.env.PAJ_BUSINESS_API_KEY;
  const response = await initiatePajSession(post({ email: "ada@example.com" }));
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: "paj_not_configured" });
});

test("initiate forwards the key to Paj and passes the reply through", async () => {
  const response = await initiatePajSession(post({ email: "ada@example.com" }));
  assert.equal(response.status, 201);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { email: "ada@example.com" });
  assert.equal(text.includes(KEY), false);
  assert.equal(response.headers.get("x-api-key"), null);

  const paj = calls[1];
  assert.equal(paj.url, "https://api.paj.cash/pub/initiate");
  assert.equal(paj.init.headers["x-api-key"], KEY);
  assert.deepEqual(JSON.parse(paj.init.body), { email: "ada@example.com" });
});

test("verify sends only the expected fields and returns the Paj session", async () => {
  process.env.PAJ_API_BASE_URL = "https://paj.test";
  const session = {
    recipient: "+2348012345678",
    isActive: true,
    expiresAt: "2026-12-01T00:00:00.000Z",
    token: "paj-token",
  };
  mockFetch({ paj: () => Response.json(session, { status: 201 }) });
  const response = await verifyPajSession(post({ ...verifyBody, extra: "dropped" }));
  assert.equal(response.status, 201);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), session);
  assert.equal(text.includes(KEY), false);

  const paj = calls[1];
  assert.equal(paj.url, "https://paj.test/pub/verify");
  assert.equal(paj.init.headers["x-api-key"], KEY);
  assert.deepEqual(JSON.parse(paj.init.body), verifyBody);
});

test("a Paj 4xx becomes paj_refused with the Paj message", async () => {
  mockFetch({ paj: () => Response.json({ message: "Can't find business" }, { status: 400 }) });
  const response = await initiatePajSession(post({ email: "ada@example.com" }));
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "paj_refused", message: "Can't find business" });
});

test("a Paj 5xx or network failure is a 502", async () => {
  mockFetch({ paj: () => new Response("oops", { status: 503 }) });
  let response = await initiatePajSession(post({ email: "ada@example.com" }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "paj_unavailable" });

  mockFetch({
    paj: () => {
      throw new TypeError("fetch failed");
    },
  });
  response = await initiatePajSession(post({ email: "ada@example.com" }));
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { error: "paj_unavailable" });
});
