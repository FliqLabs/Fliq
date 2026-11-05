import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { newId } from "../db/src/ids.js";
import type { PayoutState, RouteKind } from "./payout-state.js";
import { transitionPayout, type Step } from "./transition.js";

// Runs only against a throwaway local database; Prisma loads .env, which may point at a shared one.
const enabled = /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "");

describe.skipIf(!enabled)("transitions against a real database", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const db = new PrismaClient({ transactionOptions: { maxWait: 30_000, timeout: 60_000 } });
  const workspace = `ws_${newId("ws")}`;
  const user = newId("usr");
  const recipient = newId("rcp");
  const quote = newId("q");
  const created: string[] = [];

  beforeAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.recipient.create({
        data: { id: recipient, userId: user, institutionCode: "058", accountCipher: Buffer.from("x"), nameCipher: Buffer.from("x"), lookupHash: Buffer.from("x") },
      });
      await tx.quote.create({
        data: {
          id: quote,
          developerId: workspace,
          mode: "send_exactly",
          tokenSymbol: "USDC",
          sourceChain: "base",
          currency: "ngn",
          amountIn: 50_000_000n,
          amountOutMinor: 6_881_600n,
          rate: "1376.32",
          expiresAt: new Date(Date.now() + 90_000),
        },
      });
    });
  }, 60_000);

  afterAll(async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM core.payout_events WHERE payout_id = ANY(${created}::text[])`;
      await tx.payout.deleteMany({ where: { developerId: workspace } });
      await tx.recipient.deleteMany({ where: { id: recipient } });
      await tx.quote.deleteMany({ where: { developerId: workspace } });
    });
    await db.$disconnect();
  }, 60_000);

  async function newPayout(route: RouteKind, state: PayoutState = "awaiting_deposit") {
    const id = newId("po");
    created.push(id);
    await db.payout.create({
      data: {
        id,
        developerId: workspace,
        clientReference: id,
        quoteId: quote,
        recipientId: recipient,
        routeKind: route,
        provider: "paycrest",
        state,
        amountIn: 50_000_000n,
        amountOutMinor: 6_881_600n,
        currency: "ngn",
        rate: "1376.32",
      },
    });
    return id;
  }

  const move = (payoutId: string, target: PayoutState, effect?: (step: Step) => void) =>
    db.$transaction((tx) =>
      transitionPayout(tx, { payoutId, target, cause: "test" }, effect ? async (_tx, step) => effect(step) : undefined),
    );

  const history = async (payoutId: string) =>
    (await db.payoutEvent.findMany({ where: { payoutId }, orderBy: { version: "asc" } })).map((event) => [event.version, event.toState, event.cause]);

  it("records a single step and bumps the version", async () => {
    const id = await newPayout("direct");
    const result = await move(id, "deposit_seen");
    expect(result).toMatchObject({ outcome: "advanced", state: "deposit_seen", version: 2 });
    expect(await history(id)).toEqual([[2, "deposit_seen", "test"]]);
  });

  it("backfills skipped states in order, marking them as backfilled", async () => {
    const id = await newPayout("direct");
    const effects: string[] = [];
    await move(id, "settled", (step) => effects.push(`${step.from}>${step.to}${step.backfilled ? "*" : ""}`));
    expect(effects).toEqual(["awaiting_deposit>deposit_seen*", "deposit_seen>with_provider*", "with_provider>paying_out*", "paying_out>settled"]);
    expect(await history(id)).toEqual([
      [2, "deposit_seen", "backfilled:test"],
      [3, "with_provider", "backfilled:test"],
      [4, "paying_out", "backfilled:test"],
      [5, "settled", "test"],
    ]);
    expect((await db.payout.findUniqueOrThrow({ where: { id } })).version).toBe(5);
  });

  it("answers duplicates, stale and late signals without writing anything", async () => {
    const id = await newPayout("direct");
    await move(id, "settled");
    const before = await history(id);
    expect(await move(id, "settled")).toEqual({ outcome: "duplicate", state: "settled" });
    expect(await move(id, "deposit_seen")).toEqual({ outcome: "stale", state: "settled" });
    expect(await move(id, "refunding")).toEqual({ outcome: "late_signal", state: "settled" });
    expect(await history(id)).toEqual(before);
  });

  it("rejects an illegal move and leaves the payout alone", async () => {
    const id = await newPayout("direct", "deposit_seen");
    expect(await move(id, "expired")).toEqual({ outcome: "illegal", state: "deposit_seen" });
    expect((await db.payout.findUniqueOrThrow({ where: { id } })).state).toBe("deposit_seen");
  });

  it("rolls the whole transition back when an effect fails", async () => {
    const id = await newPayout("direct");
    await expect(
      move(id, "settled", (step) => {
        if (step.to === "paying_out") throw new Error("ledger posting failed");
      }),
    ).rejects.toThrow("ledger posting failed");
    expect((await db.payout.findUniqueOrThrow({ where: { id } })).state).toBe("awaiting_deposit");
    expect(await history(id)).toEqual([]);
  });

  it("converges when watcher and provider signals race for the same payout", async () => {
    const id = await newPayout("intents");
    const signals: PayoutState[] = ["deposit_seen", "routing", "with_provider", "paying_out", "settled"];
    const shuffled = [...signals, ...signals, ...signals].sort(() => Math.random() - 0.5);
    const results = await Promise.all(shuffled.map((target) => move(id, target)));

    expect((await db.payout.findUniqueOrThrow({ where: { id } })).state).toBe("settled");
    expect((await history(id)).map(([, state]) => state)).toEqual(signals);
    expect((await history(id)).map(([version]) => version)).toEqual([2, 3, 4, 5, 6]);
    expect(results.filter((result) => result.outcome === "late_signal")).toEqual([]);
  }, 120_000);
});
