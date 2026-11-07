import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "../errors";
import type { CreateOrderRequest, Institution, ProviderAdapter, ProviderId } from "../types";
import { INSTITUTION_TABLE } from "./table";
import {
  describeInstitution,
  findInstitution,
  institutionsIn,
  nameKey,
  withInstitutionCodes,
} from "./translate";

function fakeAdapter(id: ProviderId, lists: Partial<Record<string, Institution[]>>) {
  const adapter = {
    id,
    institutions: vi.fn(async (country: string) => lists[country] ?? []),
    verifyAccount: vi.fn(async () => ({ found: true as const, accountName: "DARA OKONKWO" })),
    createOrder: vi.fn(async () => ({
      providerOrderId: "order-1",
      reference: "po_1",
      funding: { kind: "balance_debit" as const, asset: "USDC" as const, units: 1n },
    })),
  };
  return adapter as unknown as ProviderAdapter & typeof adapter;
}

function orderFor(institutionCode: string): CreateOrderRequest {
  return {
    payoutId: "po_1",
    quote: {
      provider: "paycrest",
      sendUnits: 1n,
      receiveMinorUnits: 1n,
      rate: "1",
      fees: [],
      expiresAt: new Date(0),
    },
    corridor: { country: "NG", currency: "NGN", payoutType: "bank" },
    source: { asset: "USDC", chain: "base" },
    recipient: { institutionCode, accountNumber: "0123456789", accountName: "DARA OKONKWO" },
    refundAddress: "0xrefund",
  };
}

const check = (institutionCode: string) => ({
  institutionCode,
  accountNumber: "0123456789",
  country: "NG" as const,
});

describe("institution table", () => {
  it("gives every code and alias one institution", () => {
    const codes = INSTITUTION_TABLE.flatMap((entry) => [entry.code, ...(entry.aliases ?? [])]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("keeps names distinct within a country so name matching is unambiguous", () => {
    for (const country of ["NG", "KE", "GH"] as const) {
      const keys = institutionsIn(country).flatMap((entry) => [
        ...new Set([entry.name, ...(entry.names ?? [])].map(nameKey)),
      ]);
      expect(new Set(keys).size, country).toBe(keys.length);
    }
  });

  it("keeps the codes in spec/fixtures", () => {
    expect(findInstitution("058")?.name).toBe("GTBank");
    expect(findInstitution("044")?.name).toBe("Access Bank");
    expect(findInstitution("999992")?.name).toBe("OPay");
    expect(findInstitution("mpesa")?.country).toBe("KE");
  });

  it("accepts the NIP code for a Nigerian bank", () => {
    expect(findInstitution("000013")?.code).toBe("058");
  });
});

describe("withInstitutionCodes", () => {
  it("sends the provider's own code for a fliq code", async () => {
    const paycrest = fakeAdapter("paycrest", {});
    const busha = fakeAdapter("busha", {});
    await withInstitutionCodes(paycrest).verifyAccount(check("058"));
    await withInstitutionCodes(busha).createOrder(orderFor("058"));
    expect(paycrest.verifyAccount).toHaveBeenCalledWith(
      expect.objectContaining({ institutionCode: "GTBINGLA" }),
    );
    expect(busha.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: expect.objectContaining({ institutionCode: "000013" }) }),
    );
  });

  it("matches by name for a provider whose codes come from its own list", async () => {
    const fonbnk = fakeAdapter("fonbnk", { NG: [{ code: "17", name: "Guaranty Trust Bank", type: "bank" }] });
    await withInstitutionCodes(fonbnk).createOrder(orderFor("058"));
    expect(fonbnk.createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ recipient: expect.objectContaining({ institutionCode: "17" }) }),
    );
  });

  it("lists one fliq code per bank whichever provider lists it", async () => {
    const paycrest = withInstitutionCodes(
      fakeAdapter("paycrest", { NG: [{ code: "GTBINGLA", name: "Guaranty Trust Bank", type: "bank" }] }),
    );
    const busha = withInstitutionCodes(
      fakeAdapter("busha", { NG: [{ code: "000013", name: "Guaranty Trust Bank", type: "bank" }] }),
    );
    const listed = [...(await paycrest.institutions("NG")), ...(await busha.institutions("NG"))];
    expect(listed.map((institution) => institution.code)).toEqual(["058", "058"]);
  });

  it("scopes an institution the table does not know to the provider that listed it", async () => {
    const unknown = { code: "ABOVNGPC", name: "Above Only Microfinance Bank", type: "bank" as const };
    const paycrest = fakeAdapter("paycrest", { NG: [unknown] });
    const wrapped = withInstitutionCodes(paycrest);
    const [listed] = await wrapped.institutions("NG");
    expect(listed?.code).toBe("paycrest:ABOVNGPC");
    expect(describeInstitution("paycrest:ABOVNGPC")?.name).toBe("Above Only Microfinance Bank");

    await wrapped.verifyAccount(check("paycrest:ABOVNGPC"));
    expect(paycrest.verifyAccount).toHaveBeenCalledWith(
      expect.objectContaining({ institutionCode: "ABOVNGPC" }),
    );
    await expect(
      withInstitutionCodes(fakeAdapter("busha", {})).verifyAccount(check("paycrest:ABOVNGPC")),
    ).rejects.toMatchObject({
      kind: "not_supported",
    });
  });

  it("refuses an order before calling the provider when it cannot pay that institution", async () => {
    const fonbnk = fakeAdapter("fonbnk", { NG: [] });
    const refused = withInstitutionCodes(fonbnk).createOrder(orderFor("058"));
    await expect(refused).rejects.toBeInstanceOf(ProviderError);
    await expect(refused).rejects.toMatchObject({ kind: "rejected", operation: "createOrder" });
    expect(fonbnk.createOrder).not.toHaveBeenCalled();
  });

  it("refuses a code from another country and an unknown code", async () => {
    const paycrest = withInstitutionCodes(fakeAdapter("paycrest", {}));
    await expect(paycrest.verifyAccount(check("mpesa"))).rejects.toMatchObject({ kind: "not_supported" });
    await expect(paycrest.verifyAccount(check("123"))).rejects.toMatchObject({ kind: "not_supported" });
  });

  it("reads a provider's list once while it is fresh", async () => {
    let now = 0;
    const fonbnk = fakeAdapter("fonbnk", { NG: [{ code: "17", name: "GTBank", type: "bank" }] });
    const wrapped = withInstitutionCodes(fonbnk, () => now);
    await wrapped.createOrder(orderFor("058"));
    await wrapped.verifyAccount(check("058"));
    expect(fonbnk.institutions).toHaveBeenCalledTimes(1);
    now = 11 * 60 * 1000;
    await wrapped.verifyAccount(check("058"));
    expect(fonbnk.institutions).toHaveBeenCalledTimes(2);
  });
});
