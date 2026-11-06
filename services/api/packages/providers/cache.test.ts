import { describe, expect, it, vi } from "vitest";
import { INSTITUTIONS_TTL_MS, VERIFY_TTL_MS, withCache } from "./cache";
import { createMockProvider } from "./mock/mock";
import type { AccountCheck, ProviderAdapter } from "./types";

const CHECK: AccountCheck = { country: "NG", institutionCode: "058", accountNumber: "0123456789" };

function setup() {
  let clock = new Date("2026-11-05T12:00:00Z");
  const { adapter } = createMockProvider({ deps: { alert: () => undefined }, webhookSecret: "s" });
  const institutions = vi.fn(async () => [{ code: "058", name: "GTBank", type: "bank" as const }]);
  const verifyAccount = vi.fn(async () => ({ found: true as const, accountName: "ADA OBI" }));
  const cached = withCache<ProviderAdapter>(
    { ...adapter, institutions, verifyAccount },
    { hashKey: Buffer.alloc(32, 7), now: () => clock },
  );
  const advance = (ms: number) => {
    clock = new Date(clock.getTime() + ms);
  };
  return { cached, institutions, verifyAccount, advance };
}

describe("provider cache", () => {
  it("serves institutions from cache for 24 hours per country", async () => {
    const { cached, institutions, advance } = setup();
    await cached.institutions("NG");
    await cached.institutions("NG");
    await cached.institutions("KE");
    expect(institutions).toHaveBeenCalledTimes(2);
    advance(INSTITUTIONS_TTL_MS);
    await cached.institutions("NG");
    expect(institutions).toHaveBeenCalledTimes(3);
  });

  it("serves account checks from cache for 10 minutes per account", async () => {
    const { cached, verifyAccount, advance } = setup();
    expect(await cached.verifyAccount(CHECK)).toEqual({ found: true, accountName: "ADA OBI" });
    await cached.verifyAccount(CHECK);
    await cached.verifyAccount({ ...CHECK, accountNumber: "9876543210" });
    expect(verifyAccount).toHaveBeenCalledTimes(2);
    advance(VERIFY_TTL_MS);
    await cached.verifyAccount(CHECK);
    expect(verifyAccount).toHaveBeenCalledTimes(3);
  });

  it("shares one provider call between concurrent requests", async () => {
    const { cached, institutions } = setup();
    await Promise.all([cached.institutions("NG"), cached.institutions("NG")]);
    expect(institutions).toHaveBeenCalledTimes(1);
  });

  it("never caches a failure", async () => {
    const { cached, verifyAccount } = setup();
    verifyAccount.mockRejectedValueOnce(new Error("timeout"));
    await expect(cached.verifyAccount(CHECK)).rejects.toThrow("timeout");
    expect(await cached.verifyAccount(CHECK)).toEqual({ found: true, accountName: "ADA OBI" });
    expect(verifyAccount).toHaveBeenCalledTimes(2);
  });

  it("leaves the other operations untouched", () => {
    const { cached } = setup();
    expect(cached.id).toBe("mock");
    expect(cached.capabilities().corridors.length).toBeGreaterThan(0);
  });
});
