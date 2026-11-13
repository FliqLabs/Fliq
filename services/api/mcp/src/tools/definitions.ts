import { SOURCE_CHAINS } from "../config.js";

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

export type Mode = "developer" | "agent";

export type ToolName =
  | "cashout_limits"
  | "cashout_recipients"
  | "cashout_quote"
  | "cashout_verify_account"
  | "cashout_pay"
  | "cashout_status";

const CURRENCIES = ["ngn", "kes", "ghs", "idr", "php"] as const;
const COUNTRIES = ["ng", "ke", "gh", "id", "ph"] as const;
const AGENT_CURRENCIES = ["ngn", "kes"] as const;

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
const amount: JsonSchema = {
  type: "string",
  pattern: "^[0-9]+(\\.[0-9]{1,6})?$",
  description:
    'Token amount as a decimal string, for example "50.00". With mode receive it is the local amount the recipient gets.',
};
const quoteMode: JsonSchema = {
  type: "string",
  enum: ["send", "receive"],
  default: "send",
  description: "send fixes what the sender pays, receive fixes what the recipient gets.",
};
const quoteId: JsonSchema = {
  type: "string",
  minLength: 1,
  maxLength: 64,
  description: "From cashout_quote.",
};

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };
const PAYS = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true };

const status: ToolDefinition = {
  name: "cashout_status",
  title: "Where a payout is",
  description: "The payout's state, its timeline, the transaction and bank references, and the receipt link.",
  inputSchema: {
    type: "object",
    properties: {
      payout_id: { type: "string", minLength: 1, maxLength: 64, description: "From cashout_pay." },
    },
    required: ["payout_id"],
    additionalProperties: false,
  },
  annotations: { title: "Payout status", ...READ_ONLY, idempotentHint: true },
};

const DEVELOPER_TOOLS: readonly ToolDefinition[] = [
  {
    name: "cashout_quote",
    title: "Quote a cash-out",
    description:
      "Prices a payout across every live provider and returns the top three routes with what each one pays, its fees and how long it takes. The quote id is needed to pay and expires after expires_in seconds.",
    inputSchema: {
      type: "object",
      properties: {
        amount,
        currency: { type: "string", enum: CURRENCIES, description: "Local currency the recipient gets." },
        token: {
          type: "string",
          enum: ["usdc", "usdt"],
          default: "usdc",
          description: "Stablecoin being sent.",
        },
        source_chain: {
          type: "string",
          enum: SOURCE_CHAINS,
          description:
            "Chain the person sends the stablecoin from. Defaults to the server's FLIQ_SOURCE_CHAIN, or base.",
        },
        payout_type: { type: "string", enum: ["bank", "mobile_money"], default: "bank" },
        mode: quoteMode,
      },
      required: ["amount", "currency"],
      additionalProperties: false,
    },
    annotations: { title: "Quote a cash-out", ...READ_ONLY, idempotentHint: false },
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
    annotations: { title: "Verify an account", ...READ_ONLY, idempotentHint: true },
  },
  {
    name: "cashout_pay",
    title: "Pay a quote to a verified account",
    description:
      "Creates the payout for a quote and returns where to send the deposit. Refused unless the recipient was verified with cashout_verify_account in this session. Needs a refund address on the quote's source chain.",
    inputSchema: {
      type: "object",
      properties: {
        quote_id: quoteId,
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
          description:
            "Where the stablecoin goes back if the payout fails: the person's own address on the quote's source chain. When left out, the server's FLIQ_REFUND_ADDRESS is used if it fits that chain.",
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
    annotations: { title: "Pay out", ...PAYS },
  },
  status,
];

const AGENT_TOOLS: readonly ToolDefinition[] = [
  {
    name: "cashout_limits",
    title: "This agent's limits",
    description:
      "What this agent may pay from its owner's fliq vault: the daily and per-payout caps, the allowed currencies, what is left today, and whether only saved accounts may be paid.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Agent limits", ...READ_ONLY, idempotentHint: true },
  },
  {
    name: "cashout_recipients",
    title: "The owner's saved accounts",
    description:
      "The bank and mobile-money accounts the owner saved in fliq. cashout_pay pays one of them by its recipient_id.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { title: "Saved accounts", ...READ_ONLY, idempotentHint: true },
  },
  {
    name: "cashout_quote",
    title: "Quote a cash-out from the vault",
    description:
      "Prices a payout of USDC from the owner's vault on NEAR and returns the top three routes. The quote id is needed to pay and expires after expires_in seconds.",
    inputSchema: {
      type: "object",
      properties: {
        amount: {
          ...amount,
          description:
            'Dollars to send as a decimal string, for example "21.80". With mode receive it is the local amount the recipient gets.',
        },
        currency: {
          type: "string",
          enum: AGENT_CURRENCIES,
          description: "Local currency the recipient gets.",
        },
        mode: quoteMode,
      },
      required: ["amount", "currency"],
      additionalProperties: false,
    },
    annotations: { title: "Quote a cash-out", ...READ_ONLY, idempotentHint: false },
  },
  {
    name: "cashout_pay",
    title: "Pay a quote to a saved account",
    description:
      "Pays a quote from the owner's vault to one of their saved accounts. fliq refuses anything over this agent's limits before money moves; the agent then signs the vault payout and fliq relays it.",
    inputSchema: {
      type: "object",
      properties: {
        quote_id: quoteId,
        recipient_id: {
          type: "string",
          minLength: 1,
          maxLength: 64,
          description: "From cashout_recipients.",
        },
      },
      required: ["quote_id", "recipient_id"],
      additionalProperties: false,
    },
    annotations: { title: "Pay out", ...PAYS },
  },
  status,
];

const SUMMARY_RULE = "Every tool returns a summary sentence you can repeat to the person as it is.";

const DEVELOPER_INSTRUCTIONS = [
  "fliq turns stablecoins into money in a bank or mobile-money account. Which currencies can be paid depends on the payout providers live at the moment; when none can pay one, cashout_quote answers no_route.",
  "To pay someone: cashout_quote, then cashout_verify_account and read the returned name back to the person, then cashout_pay with the quote id, then cashout_status.",
  "cashout_pay refuses a recipient that was not verified with cashout_verify_account in this session.",
  "The person funds the payout by sending the stablecoin to the deposit address cashout_pay returns. If cashout_pay answers needs_refund_address, ask the person for their own address on the chain it names, where the money goes back if the payout fails, and call it again with refund_address.",
  SUMMARY_RULE,
].join(" ");

const AGENT_INSTRUCTIONS = [
  "You pay from the fliq vault on NEAR of the person who connected this agent, within the daily and per-payout limits they set.",
  "cashout_limits shows the limits and what is left today; cashout_recipients lists the person's saved accounts.",
  "To pay: cashout_quote, confirm the amount and the recipient with the person, then cashout_pay with the quote id and a recipient_id, then cashout_status.",
  "A payout over a limit is refused before anything moves, and the vault checks the limits again on chain.",
  SUMMARY_RULE,
].join(" ");

export function toolsFor(mode: Mode): readonly ToolDefinition[] {
  return mode === "agent" ? AGENT_TOOLS : DEVELOPER_TOOLS;
}

export function instructionsFor(mode: Mode): string {
  return mode === "agent" ? AGENT_INSTRUCTIONS : DEVELOPER_INSTRUCTIONS;
}
