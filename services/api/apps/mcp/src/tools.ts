import type { AgentClient, ApiAnswer, SignStep } from "./client.js";

type Schema = { type: "object"; properties: Record<string, unknown>; required?: string[]; additionalProperties: false };

export type Tool = {
  name: string;
  description: string;
  inputSchema: Schema;
  run: (client: AgentClient, args: Record<string, unknown>) => Promise<ApiAnswer>;
};

const text = (value: unknown) => String(value ?? "");

export const TOOLS: readonly Tool[] = [
  {
    name: "fliq_limits",
    description: "What this agent may pay from its owner's fliq vault: daily and per-payout caps, allowed currencies, what is left today.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (client) => client.request("GET", "/v1/agent"),
  },
  {
    name: "fliq_recipients",
    description: "The owner's saved bank and mobile money accounts. When saved accounts only is on, these are the only accounts the agent may pay.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    run: (client) => client.request("GET", "/v1/agent/recipients"),
  },
  {
    name: "fliq_quote",
    description: "Price a payout from the owner's vault in Nigerian naira (ngn) or Kenyan shillings (kes). amount is dollars to send, or the local amount to receive with mode receive.",
    inputSchema: {
      type: "object",
      properties: {
        currency: { type: "string", enum: ["ngn", "kes"] },
        amount: { type: "string", description: "A decimal string, for example 21.80" },
        mode: { type: "string", enum: ["send", "receive"] },
      },
      required: ["currency", "amount"],
      additionalProperties: false,
    },
    run: (client, args) => client.request("POST", "/v1/agent/quotes", { currency: text(args.currency), amount: text(args.amount), ...(args.mode ? { mode: text(args.mode) } : {}) }),
  },
  {
    name: "fliq_pay",
    description: "Pay a quote to one of the owner's saved accounts. fliq checks this agent's limits first and refuses anything over them; the vault checks them again on chain.",
    inputSchema: {
      type: "object",
      properties: { quote_id: { type: "string" }, recipient_id: { type: "string" } },
      required: ["quote_id", "recipient_id"],
      additionalProperties: false,
    },
    async run(client, args) {
      const quoteId = text(args.quote_id);
      const created = await client.request("POST", "/v1/agent/payouts", { quote_id: quoteId, recipient_id: text(args.recipient_id) }, { "idempotency-key": `mcp-${quoteId}` });
      if (created.status !== 201) return created;
      const { payout, sign } = created.body as { payout: { payout_id: string }; sign: SignStep };
      const relayed = await client.signAndRelay(sign);
      return { status: relayed.status, body: { payout_id: payout.payout_id, payout, relay: relayed.body } };
    },
  },
  {
    name: "fliq_payout_status",
    description: "Where a payout this agent made is: sending, paid with the bank reference, or refunded to the vault.",
    inputSchema: { type: "object", properties: { payout_id: { type: "string" } }, required: ["payout_id"], additionalProperties: false },
    run: (client, args) => client.request("GET", `/v1/agent/payouts/${encodeURIComponent(text(args.payout_id))}`),
  },
];
