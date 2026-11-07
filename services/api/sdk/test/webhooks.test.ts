import { describe, expect, it } from "vitest";
import { signatureHeader } from "../../packages/webhooks/signature.js";
import { verifyWebhook, WebhookVerificationError, type WebhookFailure } from "../src/index.js";
import { fixture } from "./fake-api.js";

const body = JSON.stringify(fixture("webhook-event.payout-settled.json"));
const sentAt = 1_761_742_952;

async function failure(promise: Promise<unknown>): Promise<WebhookFailure | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    if (error instanceof WebhookVerificationError) return error.reason;
    throw error;
  }
}

describe("verifyWebhook against the API's own signer", () => {
  it("accepts a delivery signed by the server and returns the event", async () => {
    const headers = { "fliq-signature": signatureHeader(["whsec_a"], sentAt, body) };
    const event = await verifyWebhook(body, headers, "whsec_a", { now: sentAt + 10 });
    expect(event).toMatchObject({ id: "evt_01jbx7k3m2q8d4n6p0r5s9t1vw", type: "payout.settled" });
  });

  it("reads the header from a fetch Headers object and accepts the raw body as bytes", async () => {
    const headers = new Headers({ "Fliq-Signature": signatureHeader(["whsec_a"], sentAt, body) });
    const event = await verifyWebhook(new TextEncoder().encode(body), headers, "whsec_a", { now: sentAt });
    expect(event.type).toBe("payout.settled");
  });

  it("accepts either secret while the server signs with both during a rotation", async () => {
    const headers = { "fliq-signature": signatureHeader(["whsec_new", "whsec_old"], sentAt, body) };
    await expect(verifyWebhook(body, headers, "whsec_old", { now: sentAt })).resolves.toBeTruthy();
    await expect(
      verifyWebhook(body, headers, ["whsec_other", "whsec_new"], { now: sentAt }),
    ).resolves.toBeTruthy();
  });

  it("allows exactly the tolerance and refuses one second more, either side", async () => {
    const headers = { "fliq-signature": signatureHeader(["whsec_a"], sentAt, body) };
    await expect(verifyWebhook(body, headers, "whsec_a", { now: sentAt + 300 })).resolves.toBeTruthy();
    expect(await failure(verifyWebhook(body, headers, "whsec_a", { now: sentAt + 301 }))).toBe(
      "timestamp_out_of_tolerance",
    );
    expect(await failure(verifyWebhook(body, headers, "whsec_a", { now: sentAt - 301 }))).toBe(
      "timestamp_out_of_tolerance",
    );
    await expect(
      verifyWebhook(body, headers, "whsec_a", { now: sentAt + 301, toleranceSeconds: 600 }),
    ).resolves.toBeTruthy();
  });

  it("refuses a changed body, a wrong secret, and a missing or malformed header", async () => {
    const headers = { "fliq-signature": signatureHeader(["whsec_a"], sentAt, body) };
    expect(await failure(verifyWebhook(`${body} `, headers, "whsec_a", { now: sentAt }))).toBe(
      "signature_mismatch",
    );
    expect(await failure(verifyWebhook(body, headers, "whsec_b", { now: sentAt }))).toBe(
      "signature_mismatch",
    );
    expect(await failure(verifyWebhook(body, {}, "whsec_a", { now: sentAt }))).toBe("missing_signature");
    expect(
      await failure(verifyWebhook(body, { "fliq-signature": `t=${sentAt}` }, "whsec_a", { now: sentAt })),
    ).toBe("malformed_signature");
  });
});
