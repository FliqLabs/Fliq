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
  QuoteAmount,
} from "../types";

// Sources: services/Project MD/EXTERNAL_ADAPTERS/BUSHA.md, verified against docs.busha.io and bushaHQ/openapi.
export const BUSHA_BASE_URL = { production: "https://api.busha.io", sandbox: "https://api.sandbox.busha.so" };
export const BUSHA_SIGNATURE_HEADER = "x-bu-signature";

export type BushaEnvironment = keyof typeof BUSHA_BASE_URL;

type Networks = Partial<Record<Chain, string>>;

// Where Busha sold USDC for fiat on 10 Nov 2026 (GET /v1/currencies/USDC), used until the live list loads.
const DEFAULT_NETWORKS: Record<BushaEnvironment, Networks> = {
  production: { solana: "SOL" },
  sandbox: { base: "BASE" },
};
const CHAIN_BY_NETWORK: Readonly<Record<string, Chain>> = { BASE: "base", POL: "polygon", SOL: "solana" };
const NETWORK_REFRESH_MS = 60 * 60 * 1000;

// Busha allows 20 quotes a minute, shared by the rate board, user quotes and firm quotes.
const INDICATIVE_MEMO_MS = 10_000;
const QUOTE_TOLERANCE_BPS = 30n;
const BPS = 10_000n;

// Busha's minimum USDC deposit is 2. Its upper limits are published in fiat and enforced by the firm quote.
const SEND_LIMITS = { side: "send", min: 2_000_000n, max: 1_000_000_000_000n } as const;

const CORRIDORS: Corridor[] = [
  { country: "NG", currency: "NGN", payoutType: "bank" },
  { country: "KE", currency: "KES", payoutType: "mobile_money" },
];

type Route = { payOut: "bank_transfer" | "mobile_money"; recipientType: "ngn_bank" | "mpesa_mobile_money" };

const ROUTES: Record<string, Route> = {
  "NG:bank": { payOut: "bank_transfer", recipientType: "ngn_bank" },
  "KE:mobile_money": { payOut: "mobile_money", recipientType: "mpesa_mobile_money" },
};

// Busha prices the payout fee only once a recipient exists, which a fan-out quote never has. These are the
// published flat fees (docs.busha.io fees page); the firm quote at createOrder carries the real ones.
// KES 330 is an upper bound: M-Pesa fees are tiered and usually lower, so Kenyan quotes err on the low side.
const ESTIMATED_PAYOUT_FEE_MINOR: Partial<Record<FiatCurrency, bigint>> = { NGN: 10_750n, KES: 33_000n };

const MPESA: Institution = { code: "MPESA", name: "M-Pesa", type: "mobile_money" };
const MPESA_NUMBER = /^\+254(7|1)\d{8}$/;
const FIAT_PAY_OUTS: ReadonlySet<unknown> = new Set(["bank_transfer", "mobile_money"]);

export type BushaOptions = {
  // Absent only with publicQuotes: the adapter then shows Busha's public prices and can never pay out.
  secretKey?: string;
  publicQuotes?: boolean;
  // Busha refunds a failed payout into our balance, not to the sender, so production payouts stay off until
  // someone handles those refunds.
  allowProduction?: boolean;
  webhookSecrets: readonly string[];
  environment: BushaEnvironment;
  deps: AdapterDeps;
  baseUrl?: string;
  maxConcurrent?: number;
};

export function createBushaAdapter(options: BushaOptions): ProviderAdapter {
  const secretKey = options.secretKey?.trim() ?? "";
  const quotesOnly = secretKey === "";
  if (quotesOnly && !options.publicQuotes) {
    throw new Error("Busha needs a secret key unless it runs in public quotes mode");
  }
  const now = () => (options.deps.now ?? (() => new Date()))().getTime();
  const webhookSecrets = options.webhookSecrets.map((secret) => secret.trim()).filter(Boolean);
  const bankNames = new Map<string, string>();
  const indicative = new Map<string, { quote: Promise<ProviderQuote>; at: number }>();
  const refundsAlerted = new Set<string>();
  const connection = {
    provider: "busha" as const,
    baseUrl: options.baseUrl ?? BUSHA_BASE_URL[options.environment],
    maxConcurrent: options.maxConcurrent ?? 4,
    ...(options.deps.fetch ? { fetch: options.deps.fetch } : {}),
  };
  const publicHttp = createProviderHttp(connection);
  const http = quotesOnly
    ? publicHttp
    : createProviderHttp({ ...connection, authHeaders: () => ({ Authorization: `Bearer ${secretKey}` }) });

  let networks = DEFAULT_NETWORKS[options.environment];
  let networksCheckedAt = Number.NEGATIVE_INFINITY;
  let capabilities = buildCapabilities();

  function buildCapabilities(): Capabilities {
    return {
      provider: "busha",
      custody: "per_quote_transfer",
      corridors: CORRIDORS,
      sources: Object.keys(networks).map((chain) => ({ asset: "USDC" as const, chain: chain as Chain })),
      limits: { NGN: SEND_LIMITS, KES: SEND_LIMITS },
      sandbox: options.environment === "sandbox",
      // A Busha quote lasts 3 minutes, too short to survive a 1Click hop.
      funding: quotesOnly ? { direct: false, hop: false } : { direct: true, hop: false },
    };
  }

  async function refreshNetworks(): Promise<void> {
    networksCheckedAt = now();
    const read = jsonReader("busha", "institutions");
    const response = await publicHttp.request({
      operation: "institutions",
      method: "GET",
      path: "/v1/currencies/USDC",
    });
    const data = read.object(read.object(response.body, "body").data, "data");
    const live: Networks = {};
    for (const entry of read.array(data.supported_networks, "supported_networks")) {
      const network = read.object(entry, "network");
      const code = read.string(network, "network");
      const chain = CHAIN_BY_NETWORK[code];
      const sells =
        network.status === "active" && network.deposit === true && network.is_ramp_sell_supported === true;
      if (chain && sells) live[chain] = code;
    }
    if (Object.keys(live).length === 0) return;
    networks = live;
    capabilities = buildCapabilities();
  }

  function requireKey(operation: "createOrder" | "getOrder" | "verifyAccount"): void {
    if (quotesOnly)
      throw new ProviderError("busha", operation, "not_supported", "public quotes mode has no key");
  }

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

  function alertRefund(transfer: JsonObject): void {
    const id = typeof transfer.id === "string" ? transfer.id : "unknown";
    if (refundsAlerted.has(id)) return;
    refundsAlerted.add(id);
    options.deps.alert({
      provider: "busha",
      kind: "custodial_refund",
      detail: `transfer ${id} refunded into the Busha balance`,
    });
  }

  function toStatus(status: string, transfer: JsonObject): OrderStatus | null {
    const payOut = objectOrEmpty(transfer.pay_out);
    const fiatReference =
      typeof payOut.session_id === "string" && payOut.session_id !== "" ? payOut.session_id : undefined;
    const paid: OrderStatus = fiatReference ? { status: "paid", fiatReference } : { status: "paid" };
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
      case "funds_delivered":
        return paid;
      // Busha also calls a plain crypto sale completed; only a fiat withdrawal means the recipient was paid.
      case "completed":
        return hasFiatPayOut(transfer, payOut) ? paid : { status: "processing" };
      case "funds_not_delivered":
      case "reverse_fund_conversion":
        return { status: "refunding" };
      // The refund lands in our Busha balance, not with the sender, so an operator still has to send it back.
      case "funds_refunded":
        alertRefund(transfer);
        return { status: "refunding" };
      case "cancelled":
      case "failed":
        return deposited(transfer)
          ? { status: "refunding" }
          : { status: "failed", code: "deposit_expired", retryable: true };
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
      sendUnits: read.units(data, "source_amount", ASSET_DECIMALS[asset], "up"),
      targetMinorUnits: read.units(data, "target_amount", FIAT_DECIMALS[currency], "down"),
      rate: read.string(read.object(data.rate, "rate"), "rate"),
      fees,
      expiresAt: read.date(data, "expires_at"),
    };
  }

  async function publicQuote(currency: FiatCurrency, network: string, requested: QuoteAmount) {
    const estimatedFee = ESTIMATED_PAYOUT_FEE_MINOR[currency] ?? 0n;
    const amount =
      requested.side === "send"
        ? { source_amount: toDecimalString(requested.units, ASSET_DECIMALS.USDC) }
        : { target_amount: toDecimalString(requested.minorUnits + estimatedFee, FIAT_DECIMALS[currency]) };
    const response = await publicHttp.request({
      operation: "quote",
      method: "POST",
      path: "/v1/quotes/unauthenticated",
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
    const result: ProviderQuote = {
      provider: "busha",
      providerQuoteId: quote.id,
      sendUnits: quote.sendUnits,
      receiveMinorUnits,
      rate: quote.rate,
      fees,
      expiresAt: quote.expiresAt,
    };
    return result;
  }

  function memoizedQuote(currency: FiatCurrency, network: string, requested: QuoteAmount) {
    const amount = requested.side === "send" ? `send:${requested.units}` : `receive:${requested.minorUnits}`;
    const key = `${currency}:${network}:${amount}`;
    const time = now();
    const cached = indicative.get(key);
    if (cached && time - cached.at < INDICATIVE_MEMO_MS) return cached.quote;
    for (const [stale, entry] of indicative)
      if (time - entry.at >= INDICATIVE_MEMO_MS) indicative.delete(stale);
    const quote = publicQuote(currency, network, requested);
    indicative.set(key, { quote, at: time });
    quote.catch(() => {
      if (indicative.get(key)?.quote === quote) indicative.delete(key);
    });
    return quote;
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

  async function answersSuccess(path: string, query?: Record<string, string>): Promise<boolean> {
    const response = await http.request({
      operation: "health",
      method: "GET",
      path,
      ...(query ? { query } : {}),
    });
    const body = response.body as { status?: unknown } | null;
    return body?.status === "success";
  }

  refreshNetworks().catch(() => undefined);

  return {
    id: "busha",

    capabilities() {
      if (now() - networksCheckedAt >= NETWORK_REFRESH_MS) refreshNetworks().catch(() => undefined);
      return capabilities;
    },

    // Fan-out quotes use Busha's public endpoint, which carries no recipient and so no fees; createOrder re-prices.
    async quote(request): Promise<ProviderQuote> {
      routeFor(request.corridor, "quote");
      const network = networkFor(request, "quote");
      return memoizedQuote(request.corridor.currency, network, request.amount);
    },

    async createOrder(request) {
      requireKey("createOrder");
      if (options.environment === "production" && !options.allowProduction) {
        throw new ProviderError(
          "busha",
          "createOrder",
          "not_supported",
          "production payouts are locked until custodial refunds are handled",
        );
      }
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
      if (firm.targetMinorUnits * BPS < request.quote.receiveMinorUnits * (BPS - QUOTE_TOLERANCE_BPS)) {
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
          units: read.units(transfer, "source_amount", ASSET_DECIMALS.USDC, "up"),
          validUntil,
        },
      };
    },

    async getOrder(lookup) {
      requireKey("getOrder");
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
      requireKey("verifyAccount");
      // Busha has no M-Pesa name lookup, so a well-formed number is all it can confirm; the sender types the name.
      if (check.country === "KE") {
        const valid =
          check.institutionCode === MPESA.code && MPESA_NUMBER.test(kenyanPhone(check.accountNumber));
        return valid ? { found: true, accountName: null } : { found: false };
      }
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

    // GET /health answers on both hosts but is not in Busha's public docs, so a documented read backs it up.
    async health() {
      if (await answersSuccess("/health").catch(() => false)) return { healthy: true };
      return { healthy: await answersSuccess("/v1/countries", { country: "NG" }) };
    },
  };
}

function objectOrEmpty(value: unknown): JsonObject {
  return typeof value === "object" && value !== null ? (value as JsonObject) : {};
}

function hasFiatPayOut(transfer: JsonObject, payOut: JsonObject): boolean {
  const stages = Array.isArray(transfer.stages) ? transfer.stages : [];
  return FIAT_PAY_OUTS.has(payOut.type) || stages.includes("withdrawal");
}

// A deposit leaves its transaction hash on pay_in; Busha's sample webhooks without one carry no deposit.
function deposited(transfer: JsonObject): boolean {
  const hash = objectOrEmpty(transfer.pay_in).blockchain_hash;
  return typeof hash === "string" && hash !== "";
}

function kenyanPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.startsWith("254")) return `+${digits}`;
  if (digits.startsWith("0")) return `+254${digits.slice(1)}`;
  return `+254${digits}`;
}
