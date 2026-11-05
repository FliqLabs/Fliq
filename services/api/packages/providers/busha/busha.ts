import { verifyHmac } from "../../webhooks/hmac";
import { ProviderError } from "../errors";
import { OPERATION_TIMEOUT_MS, createProviderHttp } from "../http";
import { jsonReader, type JsonObject } from "../json";
import { ASSET_DECIMALS, FIAT_DECIMALS, toDecimalString } from "../money";
import type {
  AdapterDeps,
  Capabilities,
  Chain,
  Corridor,
  CreateOrderRequest,
  Fee,
  FiatCurrency,
  Institution,
  OrderSnapshot,
  OrderStatus,
  ProviderAdapter,
  ProviderQuote,
} from "../types";

// Sources: services/Project MD/EXTERNAL_ADAPTERS/BUSHA.md, verified against docs.busha.io and bushaHQ/openapi.
export const BUSHA_BASE_URL = { production: "https://api.busha.io", sandbox: "https://api.sandbox.busha.so" };
export const BUSHA_SIGNATURE_HEADER = "x-bu-signature";

export type BushaEnvironment = keyof typeof BUSHA_BASE_URL;

// Network codes differ per environment: sandbox Polygon is the AMOY testnet and sandbox offers no Solana.
const NETWORKS: Record<BushaEnvironment, Partial<Record<Chain, string>>> = {
  production: { base: "BASE", polygon: "POL", solana: "SOL" },
  sandbox: { base: "BASE", polygon: "AMOY" },
};

type Route = { payOut: "bank_transfer" | "mobile_money"; recipientType: "ngn_bank" | "mpesa_mobile_money" };

const ROUTES: Record<string, Route> = {
  "NG:bank": { payOut: "bank_transfer", recipientType: "ngn_bank" },
  "KE:mobile_money": { payOut: "mobile_money", recipientType: "mpesa_mobile_money" },
};

// Busha prices the payout fee only once a recipient exists, which a fan-out quote never has. These are the
// published flat fees (docs.busha.io fees page); the firm quote at createOrder carries the real ones.
const ESTIMATED_PAYOUT_FEE_MINOR: Partial<Record<FiatCurrency, bigint>> = { NGN: 10_750n, KES: 33_000n };

const MPESA: Institution = { code: "MPESA", name: "M-Pesa", type: "mobile_money" };
const RETRYABLE_FAILURES: ReadonlySet<string> = new Set(["insufficient_funds"]);

export type BushaOptions = {
  secretKey: string;
  webhookSecrets: readonly string[];
  environment: BushaEnvironment;
  deps: AdapterDeps;
  baseUrl?: string;
  maxConcurrent?: number;
};

export function createBushaAdapter(options: BushaOptions): ProviderAdapter {
  const networks = NETWORKS[options.environment];
  const webhookSecrets = options.webhookSecrets.map((secret) => secret.trim()).filter(Boolean);
  const bankNames = new Map<string, string>();
  const http = createProviderHttp({
    provider: "busha",
    baseUrl: options.baseUrl ?? BUSHA_BASE_URL[options.environment],
    maxConcurrent: options.maxConcurrent ?? 4,
    ...(options.deps.fetch ? { fetch: options.deps.fetch } : {}),
    authHeaders: () => ({ Authorization: `Bearer ${options.secretKey}` }),
  });

  const capabilities: Capabilities = {
    provider: "busha",
    custody: "per_quote_transfer",
    corridors: [
      { country: "NG", currency: "NGN", payoutType: "bank" },
      { country: "KE", currency: "KES", payoutType: "mobile_money" },
    ],
    sources: Object.keys(networks).map((chain) => ({ asset: "USDC" as const, chain: chain as Chain })),
    limits: {},
  };

  function routeFor(corridor: Corridor, operation: "quote" | "createOrder"): Route {
    const route = ROUTES[`${corridor.country}:${corridor.payoutType}`];
    if (!route) throw new ProviderError("busha", operation, "not_supported", `corridor ${corridor.country}`);
    return route;
  }

  function networkFor(
    request: { source: { asset: string; chain: Chain } },
    operation: "quote" | "createOrder",
  ) {
    const network = networks[request.source.chain];
    if (request.source.asset !== "USDC" || !network) {
      throw new ProviderError(
        "busha",
        operation,
        "not_supported",
        `${request.source.asset} on ${request.source.chain}`,
      );
    }
    return network;
  }

  function toStatus(status: string, transfer: JsonObject): OrderStatus | null {
    const payOut =
      typeof transfer.pay_out === "object" && transfer.pay_out !== null
        ? (transfer.pay_out as JsonObject)
        : {};
    const error =
      typeof transfer.error === "object" && transfer.error !== null ? (transfer.error as JsonObject) : {};
    switch (status) {
      // Busha sends "processing" before "funds_received" in every documented sequence, so it is not yet a deposit.
      case "pending":
      case "processing":
        return { status: "awaiting_deposit" };
      case "funds_received":
        return { status: "deposit_received" };
      case "funds_converted":
      case "outgoing_payment_sent":
        return { status: "processing" };
      case "funds_delivered": {
        const fiatReference =
          typeof payOut.session_id === "string" && payOut.session_id !== "" ? payOut.session_id : undefined;
        return fiatReference ? { status: "paid", fiatReference } : { status: "paid" };
      }
      case "funds_not_delivered":
      case "reverse_fund_conversion":
        return { status: "refunding" };
      // The refund lands in our Busha balance, not on-chain, so there is no refund hash to report.
      case "funds_refunded":
        return { status: "refunded" };
      case "cancelled":
        return { status: "failed", code: "cancelled", retryable: true };
      case "failed": {
        const code = typeof error.code === "string" && error.code !== "" ? error.code : "failed";
        return { status: "failed", code, retryable: RETRYABLE_FAILURES.has(code) };
      }
      default:
        return null;
    }
  }

  function unmappable(operation: "getOrder" | "parseWebhook", value: string): ProviderError {
    options.deps.alert({ provider: "busha", kind: "unmappable_status", detail: `${operation} ${value}` });
    return new ProviderError("busha", operation, "unmappable_status", value);
  }

  function snapshot(transfer: JsonObject): OrderSnapshot {
    const read = jsonReader("busha", "getOrder");
    const status = read.string(transfer, "status");
    const mapped = toStatus(status, transfer);
    if (!mapped) throw unmappable("getOrder", status);
    const reference = read.optionalString(transfer, "reference");
    return { providerOrderId: read.string(transfer, "id"), ...(reference ? { reference } : {}), ...mapped };
  }

  function readQuote(
    body: unknown,
    operation: "quote" | "createOrder",
    currency: FiatCurrency,
    asset: "USDC",
  ) {
    const read = jsonReader("busha", operation);
    const data = read.object(read.object(body, "body").data, "data");
    const fees: Fee[] = read.array(data.fees ?? [], "fees").map((entry) => {
      const amount = read.object(read.object(entry, "fee").amount, "fee.amount");
      const unit = read.string(amount, "currency");
      if (unit !== currency) throw read.fail("fee currency differs from the payout currency");
      return {
        kind: "provider",
        amount: read.units(amount, "amount", FIAT_DECIMALS[currency]),
        unit: currency,
      };
    });
    return {
      id: read.string(data, "id"),
      sendUnits: read.units(data, "source_amount", ASSET_DECIMALS[asset]),
      targetMinorUnits: read.units(data, "target_amount", FIAT_DECIMALS[currency], "down"),
      rate: read.string(read.object(data.rate, "rate"), "rate"),
      fees,
      expiresAt: read.date(data, "expires_at"),
    };
  }

  async function bankName(code: string, deadline: number): Promise<string> {
    if (!bankNames.has(code)) await loadBanks(deadline);
    const name = bankNames.get(code);
    if (!name) throw new ProviderError("busha", "createOrder", "rejected", "unknown bank code");
    return name;
  }

  async function loadBanks(deadline?: number): Promise<Institution[]> {
    const read = jsonReader("busha", "institutions");
    const response = await http.request({
      operation: "institutions",
      method: "GET",
      path: "/v1/banks",
      query: { currency: "NGN" },
      ...(deadline ? { deadline } : {}),
    });
    return read.array(read.object(response.body, "body").data, "data").map((entry) => {
      const bank = read.object(entry, "bank");
      const institution: Institution = {
        code: read.string(bank, "code"),
        name: read.string(bank, "name"),
        type: "bank",
      };
      bankNames.set(institution.code, institution.name);
      return institution;
    });
  }

  async function createRecipient(
    request: CreateOrderRequest,
    route: Route,
    deadline: number,
  ): Promise<string> {
    const read = jsonReader("busha", "createOrder");
    const { recipient, corridor } = request;
    const details =
      route.recipientType === "ngn_bank"
        ? {
            bank_name: await bankName(recipient.institutionCode, deadline),
            bank_code: recipient.institutionCode,
            account_number: recipient.accountNumber,
          }
        : { phone_number: kenyanPhone(recipient.phone ?? recipient.accountNumber) };
    const response = await http.request({
      operation: "createOrder",
      method: "POST",
      path: "/v1/recipients",
      body: {
        type: route.recipientType,
        currency: corridor.currency,
        country_code: corridor.country,
        account_name: recipient.accountName,
        one_time: true,
        ...details,
      },
      deadline,
    });
    return read.string(read.object(read.object(response.body, "body").data, "data"), "id");
  }

  async function findByReference(reference: string): Promise<OrderSnapshot | null> {
    const read = jsonReader("busha", "getOrder");
    const response = await http.request({
      operation: "getOrder",
      method: "GET",
      path: "/v1/transfers",
      query: { reference },
    });
    const transfers = read
      .array(read.object(response.body, "body").data, "data")
      .map((entry) => read.object(entry, "transfer"));
    if (transfers.length === 0) return null;
    const match = transfers.find((transfer) => transfer.reference === reference);
    // The reference filter is documented but unconfirmed in the sandbox; a non-matching result is not proof of absence.
    if (!match)
      throw new ProviderError(
        "busha",
        "getOrder",
        "unavailable",
        "reference filter returned other transfers",
      );
    return snapshot(match);
  }

  return {
    id: "busha",

    capabilities: () => capabilities,

    async quote(request): Promise<ProviderQuote> {
      routeFor(request.corridor, "quote");
      const network = networkFor(request, "quote");
      const currency = request.corridor.currency;
      const estimatedFee = ESTIMATED_PAYOUT_FEE_MINOR[currency] ?? 0n;
      const fiatDecimals = FIAT_DECIMALS[currency];
      const amount =
        request.amount.side === "send"
          ? { source_amount: toDecimalString(request.amount.units, ASSET_DECIMALS.USDC) }
          : { target_amount: toDecimalString(request.amount.minorUnits + estimatedFee, fiatDecimals) };
      const response = await http.request({
        operation: "quote",
        method: "POST",
        path: "/v1/quotes",
        body: {
          source_currency: "USDC",
          target_currency: currency,
          ...amount,
          pay_in: { type: "address", network },
        },
      });
      const quote = readQuote(response.body, "quote", currency, "USDC");
      const fees: Fee[] =
        quote.fees.length > 0 ? quote.fees : [{ kind: "provider", amount: estimatedFee, unit: currency }];
      const receiveMinorUnits =
        quote.fees.length > 0 ? quote.targetMinorUnits : quote.targetMinorUnits - estimatedFee;
      return {
        provider: "busha",
        providerQuoteId: quote.id,
        sendUnits: quote.sendUnits,
        receiveMinorUnits,
        rate: quote.rate,
        fees,
        expiresAt: quote.expiresAt,
      };
    },

    async createOrder(request) {
      const read = jsonReader("busha", "createOrder");
      const route = routeFor(request.corridor, "createOrder");
      const network = networkFor(request, "createOrder");
      const deadline = Date.now() + OPERATION_TIMEOUT_MS.createOrder;
      const recipientId = await createRecipient(request, route, deadline);
      const quoteResponse = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/v1/quotes",
        body: {
          source_currency: "USDC",
          target_currency: request.corridor.currency,
          source_amount: toDecimalString(request.quote.sendUnits, ASSET_DECIMALS.USDC),
          reference: request.payoutId,
          reversal_policy: "conversion_only",
          pay_in: { type: "address", network },
          pay_out: { type: route.payOut, recipient_id: recipientId },
        },
        deadline,
      });
      const firm = readQuote(quoteResponse.body, "createOrder", request.corridor.currency, "USDC");
      // Stop before the transfer: an untransferred quote simply expires, so nothing needs cancelling.
      if (firm.targetMinorUnits < request.quote.receiveMinorUnits) {
        throw new ProviderError("busha", "createOrder", "rejected", "quote_changed");
      }
      const transferResponse = await http.request({
        operation: "createOrder",
        method: "POST",
        path: "/v1/transfers",
        body: { quote_id: firm.id },
        deadline,
      });
      const transfer = read.object(read.object(transferResponse.body, "body").data, "data");
      const payIn = read.object(transfer.pay_in, "pay_in");
      const addressExpiry = read.date(payIn, "expires_at");
      // The quoted rate only holds until the quote expires, even though the address stays open longer.
      const validUntil = addressExpiry < firm.expiresAt ? addressExpiry : firm.expiresAt;
      return {
        providerOrderId: read.string(transfer, "id"),
        reference: read.optionalString(transfer, "reference") ?? request.payoutId,
        funding: {
          kind: "deposit_address",
          chain: request.source.chain,
          asset: "USDC",
          address: read.string(payIn, "address"),
          units: read.units(transfer, "source_amount", ASSET_DECIMALS.USDC),
          validUntil,
        },
      };
    },

    async getOrder(lookup) {
      if ("reference" in lookup) return findByReference(lookup.reference);
      const read = jsonReader("busha", "getOrder");
      const response = await http.request({
        operation: "getOrder",
        method: "GET",
        path: `/v1/transfers/${encodeURIComponent(lookup.providerOrderId)}`,
        acceptStatuses: [404],
      });
      if (response.status === 404) return null;
      return snapshot(read.object(read.object(response.body, "body").data, "data"));
    },

    async verifyAccount(check) {
      if (check.country !== "NG") {
        throw new ProviderError("busha", "verifyAccount", "not_supported", `country ${check.country}`);
      }
      const read = jsonReader("busha", "verifyAccount");
      const response = await http.request({
        operation: "verifyAccount",
        method: "POST",
        path: "/v1/recipients/resolve-bank-account",
        body: {
          currency_id: "NGN",
          country_id: "NG",
          channel: "bank_transfer",
          bank_code: check.institutionCode,
          account_number: check.accountNumber,
        },
        acceptStatuses: [400, 404],
      });
      if (response.status === 400 || response.status === 404) return { found: false };
      const data = read.object(read.object(response.body, "body").data, "data");
      return { found: true, accountName: read.string(data, "account_name") };
    },

    async institutions(country) {
      if (country === "NG") return loadBanks();
      if (country === "KE") return [MPESA];
      return [];
    },

    parseWebhook(webhook) {
      const read = jsonReader("busha", "parseWebhook");
      const valid = verifyHmac({
        algorithm: "sha256",
        encoding: "base64",
        secrets: webhookSecrets,
        payload: webhook.rawBody,
        signature: webhook.headers[BUSHA_SIGNATURE_HEADER],
      });
      if (!valid) {
        options.deps.alert({
          provider: "busha",
          kind: "invalid_signature",
          detail: "webhook signature mismatch",
        });
        throw new ProviderError("busha", "parseWebhook", "invalid_signature", "signature mismatch");
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(webhook.rawBody);
      } catch {
        throw read.fail("body is not JSON");
      }
      const body = read.object(parsed, "body");
      const event = read.string(body, "event");
      const data = read.object(body.data, "data");
      const order = event.startsWith("transfer.") ? toStatus(event.slice("transfer.".length), data) : null;
      if (!order) throw unmappable("parseWebhook", event);
      const id = read.string(data, "id");
      const reference = read.optionalString(data, "reference");
      // Busha sends no event id; one transfer emits each event once, so id plus event is the dedupe key.
      return { eventId: `${id}:${event}`, providerOrderId: id, ...(reference ? { reference } : {}), order };
    },

    // GET /health answers on both hosts but is not in Busha's public docs, so treat it as best effort.
    async health() {
      const response = await http.request({ operation: "health", method: "GET", path: "/health" });
      const body = response.body as { status?: unknown } | null;
      return { healthy: body?.status === "success" };
    },
  };
}

function kenyanPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  return `+254${digits}`;
}
