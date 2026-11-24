import type { FastifyRequest } from "fastify";
import { describe, expect, it } from "vitest";
import { createPaidApiHandler } from "../apps/api/src/agent-payments.js";
import { loadConfig } from "../apps/api/src/config.js";
import { MockVault } from "../packages/chains/vault/index.js";

const NS = 1_000_000n;
const USDC_UNIT = 1_000_000n;
const OWNER = "owner.testnet";
const AGENT = "agent.testnet";
const ADDRESS = "live-naira-rate.testnet";

function harness() {
  let now = 1_762_200_000n * 1_000_000n;
  const vault = new MockVault({ registrar: "registrar.testnet", usdc: "usdc.test.near", now: () => now });
  vault.registerStorage(OWNER);
  vault.ftOnTransfer({ predecessor: "usdc.test.near", senderId: OWNER, amount: 100n * USDC_UNIT, msg: "" });
  vault.setAgent(OWNER, AGENT, {
    perPayoutCap: 10_000n,
    dailyCap: 100_000n,
    corridors: ["API"],
    cooldownNs: 0n,
    expiresAtNs: now + 86_400n * 1_000_000n,
  });

  const orders = new Map<string, any>();
  const calls: any[] = [];
  const tx = {
    agent: {
      findUnique: async ({ where }: any) => (where.id === AGENT ? { id: AGENT, userId: "user-1" } : null),
    },
    user: { findUnique: async () => ({ nearAccount: OWNER }) },
    paidApiOrder: {
      create: async ({ data }: any) => orders.set(data.orderId, data),
      findFirst: async ({ where }: any) => {
        for (const order of orders.values()) {
          if (
            order.userId === where.userId &&
            order.agentId === where.agentId &&
            where.OR?.some((part: any) => part.orderId === order.orderId || part.txHash === order.txHash)
          )
            return order;
        }
        return null;
      },
      findUnique: async ({ where }: any) => orders.get(where.orderId) ?? null,
      updateMany: async ({ where, data }: any) => {
        const order = orders.get(where.orderId);
        if (!order || order.consumedAt) return { count: 0 };
        Object.assign(order, data);
        return { count: 1 };
      },
    },
    paidApiCall: {
      create: async ({ data }: any) => calls.push(data),
    },
  };
  const unit = async (work: (tx: any) => Promise<any>) => work(tx);
  const key = Buffer.alloc(32, 1).toString("base64");
  const config = {
    ...loadConfig({
      FLIQ_ACCESS_SECRET: "test",
      FLIQ_DATA_KEY: key,
      FLIQ_HASH_KEY: key,
      AGENT_API_PAY_TO_ADDRESS: ADDRESS,
    }),
    agentApiPayToAddress: ADDRESS,
  };
  const handler = createPaidApiHandler({
    config,
    unit,
    vault,
    now: () => new Date(Number(now / NS)),
    pollMs: 1,
    timeoutMs: 50,
    rate: async () => ({
      token: "usdc",
      currency: "ngn",
      rate: 1650,
      rate_before_fees: 1652,
      provider: "mock",
      providers_quoting: 1,
      spread: 2,
      fetched_at: "2026-11-24T10:00:00.000Z",
    }),
  });
  const request = (payment?: string) =>
    ({
      auth: { userId: "user-1", familyId: "", agentId: AGENT },
      headers: payment ? { "x-fliq-payment": payment } : {},
    }) as unknown as FastifyRequest;
  return {
    vault,
    orders,
    calls,
    handler,
    request,
    setNow: (value: bigint) => {
      now = value;
    },
  };
}

describe("agent 402 payments", () => {
  it("pays and retries once, then refuses replay", async () => {
    const h = harness();
    const first = await h.handler(h.request());
    expect(first.status).toBe(402);
    const orderId = (first.body as any).order_id;
    h.vault.payout(AGENT, orderId, 10_000n, ADDRESS);
    const paid = await h.handler(h.request(orderId));
    expect(paid.status).toBe(200);
    await expect(h.handler(h.request(orderId))).rejects.toMatchObject({ status: 409 });
  });

  it("rejects wrong amount and address", async () => {
    const h = harness();
    const first = await h.handler(h.request());
    const orderId = (first.body as any).order_id;
    expect(() => h.vault.payout(AGENT, orderId, 9_999n, ADDRESS)).toThrow();
    expect(() => h.vault.payout(AGENT, orderId, 10_000n, "wrong.testnet")).toThrow();
  });

  it("unpaid and failed payout retries remain clear", async () => {
    const h = harness();
    expect((await h.handler(h.request())).status).toBe(402);
    const first = await h.handler(h.request());
    const orderId = (first.body as any).order_id;
    await expect(h.handler(h.request(orderId))).rejects.toMatchObject({
      status: 402,
      code: "payment_required",
    });
  });

  it("marks an over-cap payout refused on the vault", async () => {
    const h = harness();
    h.vault.setAgent(OWNER, AGENT, {
      perPayoutCap: 9_999n,
      dailyCap: 100_000n,
      corridors: ["API"],
      cooldownNs: 0n,
    });
    const first = await h.handler(h.request());
    const orderId = (first.body as any).order_id;
    expect(() => h.vault.payout(AGENT, orderId, 10_000n, ADDRESS)).toThrow();
  });

  it("rejects an expired order", async () => {
    const h = harness();
    const first = await h.handler(h.request());
    const orderId = (first.body as any).order_id;
    h.setNow(1_762_200_000n * 1_000_000n + 16n * 60n * 1_000n * 1_000n * 1_000n);
    await expect(h.handler(h.request(orderId))).rejects.toMatchObject({ status: 400 });
  });
});
