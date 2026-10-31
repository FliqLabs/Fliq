import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Payout, Quote } from "@fliq/spec";
import { handle } from "../src/mock";

let server: Server;
let base: string;
const auth = { authorization: "Bearer rt_test_7Kp2demo00c9Qe" };

beforeAll(async () => {
  server = createServer(handle);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  base = `http://localhost:${(server.address() as AddressInfo).port}/v1`;
});

afterAll(() => server.close());

describe("mock API", () => {
  it("serves the public rate without a key", async () => {
    const res = await fetch(`${base}/rates/usdc/ngn`);
    expect(res.status).toBe(200);
  });

  it("rejects a quote without a key", async () => {
    const res = await fetch(`${base}/quote`, { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("quotes the fixture payout", async () => {
    const res = await fetch(`${base}/quote`, { method: "POST", headers: auth });
    const quote = (await res.json()) as Quote;
    expect(quote.receive).toBe(68816);
    expect(quote.rate).toBe(1376.32);
  });

  it("returns the settled receipt with the bank reference", async () => {
    const res = await fetch(`${base}/payouts/po_9c2f71aa`, { headers: auth });
    const payout = (await res.json()) as Payout;
    expect(payout.state).toBe("settled");
    expect(payout.bank_reference).toBe("000013251029140213");
  });
});
