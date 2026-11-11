import { describe, expect, it } from "vitest";
import { verifyAccount } from "../apps/api/src/recipients.js";
import { ProviderError } from "../packages/providers/errors.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

const lookup = { bank: "OPAYNGPC", number: "8012343301", country: "ng" };

function adapter(answers: Array<"timeout" | "unavailable" | "found" | "missing">): ProviderAdapter & { calls: number } {
  const fake = {
    calls: 0,
    async verifyAccount() {
      const answer = answers[fake.calls++] ?? "missing";
      if (answer === "timeout" || answer === "unavailable") throw new ProviderError("paycrest", "verifyAccount", answer, "simulated");
      return answer === "found" ? { found: true, accountName: "EMEKA STUDIOS LTD" } : { found: false };
    },
  };
  return fake as unknown as ProviderAdapter & { calls: number };
}

describe("verifyAccount", () => {
  it("asks again once when the bank's name lookup times out", async () => {
    const paycrest = adapter(["timeout", "found"]);
    await expect(verifyAccount([paycrest], lookup)).resolves.toMatchObject({ account_name: "EMEKA STUDIOS LTD", name_verified: true });
    expect(paycrest.calls).toBe(2);
  });

  it("calls the account unknown after a second timeout", async () => {
    const paycrest = adapter(["timeout", "timeout"]);
    await expect(verifyAccount([paycrest], lookup)).rejects.toMatchObject({ status: 404, code: "account_not_found" });
    expect(paycrest.calls).toBe(2);
  });

  it("does not ask again when the bank says the account does not exist", async () => {
    const paycrest = adapter(["missing"]);
    await expect(verifyAccount([paycrest], lookup)).rejects.toMatchObject({ code: "account_not_found" });
    expect(paycrest.calls).toBe(1);
  });

  it("does not ask again when the provider is down, and moves to the next provider", async () => {
    const down = adapter(["unavailable"]);
    const next = adapter(["found"]);
    await expect(verifyAccount([down, next], lookup)).resolves.toMatchObject({ account_name: "EMEKA STUDIOS LTD" });
    expect(down.calls).toBe(1);
  });
});
