export type ProviderId = "paycrest" | "bitnob" | "busha" | "fonbnk" | "transfi" | "mock";

export type Country = "NG" | "KE" | "GH" | "ID" | "PH";
export type FiatCurrency = "NGN" | "KES" | "GHS" | "IDR" | "PHP";
export type PayoutType = "bank" | "mobile_money";
export type Asset = "USDC" | "USDT";
export type Chain =
  | "base"
  | "polygon"
  | "ethereum"
  | "arbitrum"
  | "bnb"
  | "celo"
  | "solana"
  | "starknet"
  | "tron"
  | "stellar"
  | "near"
  | "simulated";

export type CustodyModel =
  | "per_order_address"
  | "prefunded_balance"
  | "per_quote_transfer"
  | "one_time_address";

export type Corridor = { country: Country; currency: FiatCurrency; payoutType: PayoutType };

export type SourceAsset = { asset: Asset; chain: Chain };

// "send" limits are in asset base units, "receive" limits in fiat minor units; providers publish either.
export type Limits = { side: "send" | "receive"; min: bigint; max: bigint };

export type Capabilities = {
  provider: ProviderId;
  custody: CustodyModel;
  corridors: Corridor[];
  sources: SourceAsset[];
  limits: Partial<Record<FiatCurrency, Limits>>;
  // Sandbox orders settle on test networks, so real funds must never be routed to them.
  sandbox?: boolean;
  // How a payout may fund this provider: straight from the sender's chain, or through a 1Click hop. Absent means both.
  funding?: { direct: boolean; hop: boolean };
};

export type QuoteAmount = { side: "send"; units: bigint } | { side: "receive"; minorUnits: bigint };

export type QuoteRequest = {
  quoteId: string;
  corridor: Corridor;
  source: SourceAsset;
  amount: QuoteAmount;
};

export type Fee = {
  kind: "provider" | "network";
  amount: bigint;
  unit: Asset | FiatCurrency;
};

export type ProviderQuote = {
  provider: ProviderId;
  providerQuoteId?: string;
  sendUnits: bigint;
  receiveMinorUnits: bigint;
  rate: string;
  fees: Fee[];
  estimatedSettleSeconds?: number;
  expiresAt: Date;
};

export type Recipient = {
  institutionCode: string;
  accountNumber: string;
  accountName: string;
  phone?: string;
};

export type CreateOrderRequest = {
  payoutId: string;
  quote: ProviderQuote;
  corridor: Corridor;
  source: SourceAsset;
  recipient: Recipient;
  refundAddress: string;
  // A stable pseudonym for the paying user, for providers that keep a profile per end user. Never the user id itself.
  sender?: { pseudonym: string };
};

export type Funding =
  | {
      kind: "deposit_address";
      chain: Chain;
      asset: Asset;
      address: string;
      units: bigint;
      validUntil?: Date;
      memo?: string;
    }
  | { kind: "balance_debit"; asset: Asset; units: bigint };

export type CreatedOrder = { providerOrderId: string; reference: string; funding: Funding };

export type OrderStatus =
  | { status: "awaiting_deposit" }
  | { status: "deposit_received" }
  | { status: "processing" }
  | { status: "paid"; fiatReference?: string }
  | { status: "refunding" }
  | { status: "refunded"; refundTxHash?: string }
  | { status: "failed"; code: string; retryable: boolean };

export type OrderSnapshot = { providerOrderId: string; reference?: string } & OrderStatus;

export type OrderLookup = { providerOrderId: string } | { reference: string };

export type AccountCheck = { institutionCode: string; accountNumber: string; country: Country };

// accountName is null when the rail confirms the account exists but returns no name (e.g. Paycrest "OK").
export type AccountVerification = { found: true; accountName: string | null } | { found: false };

export type Institution = { code: string; name: string; type: PayoutType };

export type InboundWebhook = { headers: Record<string, string | undefined>; rawBody: string };

export type WebhookEvent = {
  eventId: string;
  providerOrderId?: string;
  reference?: string;
  order: OrderStatus;
};

export type Health = { healthy: boolean };

export interface ProviderAdapter {
  readonly id: ProviderId;
  capabilities(): Capabilities;
  quote(request: QuoteRequest): Promise<ProviderQuote>;
  createOrder(request: CreateOrderRequest): Promise<CreatedOrder>;
  getOrder(lookup: OrderLookup): Promise<OrderSnapshot | null>;
  verifyAccount(check: AccountCheck): Promise<AccountVerification>;
  institutions(country: Country): Promise<Institution[]>;
  parseWebhook(webhook: InboundWebhook): WebhookEvent;
  health(): Promise<Health>;
  // Providers that only match a deposit once told its transaction hash. Safe to call again for the same order.
  confirmFunding?(providerOrderId: string, txHash: string): Promise<OrderSnapshot>;
  // The balance fliq holds at the provider, in asset base units, for providers that can hold funds for us.
  balance?(asset: Asset): Promise<bigint>;
}

export type ProviderAlert = {
  provider: ProviderId;
  // custodial_refund: the provider returned a failed payout's funds to fliq's balance there, so an operator owes the sender.
  kind: "unmappable_status" | "invalid_signature" | "custodial_refund";
  detail: string;
};

export type AdapterDeps = {
  fetch?: typeof fetch;
  alert: (alert: ProviderAlert) => void;
  now?: () => Date;
};
