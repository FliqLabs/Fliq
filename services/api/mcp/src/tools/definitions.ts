// The four agent tools, defined once so the stdio package and the hosted server describe them identically.

export type JsonSchema = {
  type: "object" | "string";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  enum?: readonly string[];
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  default?: string;
};

export interface ToolDefinition {
  name: ToolName;
  title: string;
  description: string;
  inputSchema: JsonSchema & { type: "object" };
  annotations: {
    title: string;
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
}

export type ToolName = "cashout_quote" | "cashout_verify_account" | "cashout_pay" | "cashout_status";

const CURRENCIES = ["ngn", "kes", "ghs", "idr", "php"] as const;
const COUNTRIES = ["ng", "ke", "gh", "id", "ph"] as const;

const country: JsonSchema = {
  type: "string",
  enum: COUNTRIES,
  description:
    "Two-letter country of the account: ng Nigeria, ke Kenya, gh Ghana, id Indonesia, ph Philippines.",
};
const bank: JsonSchema = {
  type: "string",
  pattern: "^[0-9A-Za-z_-]{1,20}$",
  description: "Institution code of the bank or mobile-money network, for example 058 for GTBank.",
};
const number: JsonSchema = {
  type: "string",
  pattern: "^[0-9]{6,20}$",
  description: "Account or mobile-money number, digits only.",
};

export const SERVER_INSTRUCTIONS = [
  "fliq turns stablecoins into money in a bank or mobile-money account in Nigeria, Kenya, Ghana, Indonesia and the Philippines.",
  "To pay someone: cashout_quote, then cashout_verify_account and read the returned name back to the person, then cashout_pay with the quote id, then cashout_status.",
  "cashout_pay refuses a recipient that was not verified with cashout_verify_account in this session.",
  "When an agent key is configured you pay on behalf of the person who set it up, within per-payout and daily caps that the vault contract enforces; a payout over the caps is refused by the contract and nothing moves.",
  "Every tool returns a summary sentence you can repeat to the person as it is.",
].join(" ");

export const TOOL_DEFINITIONS: readonly ToolDefinition[] = [
  {
    name: "cashout_quote",
    title: "Quote a cash-out",
    description:
      "Prices a payout across every licensed provider and returns the top three routes with what each one pays, its fees and how long it takes. The quote id is needed to pay and expires after expires_in seconds.",
    inputSchema: {
      type: "object",
      properties: {
        amount: {
          type: "string",
          pattern: "^[0-9]+(\\.[0-9]{1,6})?$",
          description:
            'Token amount as a decimal string, for example "50.00". With mode receive it is the local amount the recipient gets.',
        },
        currency: { type: "string", enum: CURRENCIES, description: "Local currency the recipient gets." },
        token: {
          type: "string",
          enum: ["usdc", "usdt"],
          default: "usdc",
          description: "Stablecoin being sent.",
        },
        source_chain: {
          type: "string",
          maxLength: 32,
          description: "Chain the funds start on. Defaults to near, where the fliq vault is.",
        },
        payout_type: { type: "string", enum: ["bank", "mobile_money"], default: "bank" },
        mode: {
          type: "string",
          enum: ["send", "receive"],
          default: "send",
          description: "send fixes what the sender pays, receive fixes what the recipient gets.",
        },
      },
      required: ["amount", "currency"],
      additionalProperties: false,
    },
    annotations: {
      title: "Quote a cash-out",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
  },
  {
    name: "cashout_verify_account",
    title: "Verify a bank or mobile-money account",
    description:
      "Asks the bank for the name on an account. Read the name back to the person before paying. A recipient must be verified here before cashout_pay will pay it.",
    inputSchema: {
      type: "object",
      properties: {
        country,
        bank,
        number,
        account_name: {
          type: "string",
          minLength: 1,
          maxLength: 100,
          description: "Only when a previous call said the bank cannot return names for this account.",
        },
      },
      required: ["country", "bank", "number"],
      additionalProperties: false,
    },
    annotations: {
      title: "Verify an account",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "cashout_pay",
    title: "Pay a quote to a verified account",
    description:
      "Creates the payout for a quote. Refused unless the recipient was verified with cashout_verify_account in this session. With a vault agent key it pays from the vault within the contract's caps; without one it returns where to send the deposit.",
    inputSchema: {
      type: "object",
      properties: {
        quote_id: { type: "string", minLength: 1, maxLength: 64, description: "From cashout_quote." },
        recipient: {
          type: "object",
          properties: { country, bank, number },
          required: ["country", "bank", "number"],
          additionalProperties: false,
        },
        provider: {
          type: "string",
          enum: ["paycrest", "busha", "fonbnk", "bitnob", "transfi", "mock"],
          description:
            "Optional check: the route the person chose. The payout always uses the quote's best route.",
        },
        refund_address: {
          type: "string",
          maxLength: 128,
          description: "Where a failed payout is refunded. Defaults to the person's fliq account.",
        },
        client_reference: {
          type: "string",
          maxLength: 100,
          description: "Your own reference, unique per payout.",
        },
      },
      required: ["quote_id", "recipient"],
      additionalProperties: false,
    },
    annotations: {
      title: "Pay out",
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: "cashout_status",
    title: "Where a payout is",
    description:
      "The payout's state, its timeline, the transaction and bank references, and the receipt link.",
    inputSchema: {
      type: "object",
      properties: {
        payout_id: { type: "string", minLength: 1, maxLength: 64, description: "From cashout_pay." },
      },
      required: ["payout_id"],
      additionalProperties: false,
    },
    annotations: {
      title: "Payout status",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
];
