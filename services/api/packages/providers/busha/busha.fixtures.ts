// Every body below is copied from Busha's official docs (docs.busha.io and the bushaHQ/openapi spec) or from a live
// unauthenticated call, as recorded in EXTERNAL_ADAPTERS/BUSHA.md. They stand in for sandbox recordings until we
// have keys.

// guides/payouts/process-payouts.md: a payout quote with a recipient.
export const QUOTE = {
  status: "success",
  message: "Created quote successfully",
  data: {
    id: "QUO_mprvCPMCfm3K2qSnzbWj7",
    profile_id: "BUS_tg6yujbZ1nMu5BLQkPGGO",
    source_currency: "USDT",
    target_currency: "NGN",
    source_amount: "100",
    target_amount: "168876",
    rate: {
      product: "USDTNGN",
      rate: "1690.76",
      side: "sell",
      type: "FIXED",
      source_currency: "USDT",
      target_currency: "NGN",
    },
    fees: [{ amount: { amount: "200", currency: "NGN" }, name: "Fees", type: "FIXED" }],
    pay_out: {
      recipient_details: {
        account_name: "SOSANYA DICKSON OLUMIDE",
        account_number: "2109328188",
        bank_name: "UNITED BANK FOR AFRICA",
        country: "NG",
      },
      recipient_id: "677bbf9c7cf061f2b784555a",
      type: "bank_transfer",
    },
    reference: "QUO_mprvCPMCfm3K2qSnzbWj7",
    status: "pending",
    expires_at: "2025-02-20T10:31:19.540025003Z",
    created_at: "2025-02-20T10:28:19.540025003Z",
    updated_at: "2025-02-20T10:28:19.540025003Z",
  },
};

export const QUOTED_AT = new Date(QUOTE.data.created_at);

// examples/crypto-to-fiat.md: transfer with a deposit address.
export const TRANSFER = {
  status: "success",
  message: "Created transfer successfully",
  data: {
    id: "TRF_6qPeJdrePrj6",
    profile_id: "BUS_CQr0jPzGGzmn1uW5W7OVs",
    quote_id: "QUO_KfCZEaXJD10W",
    description: "Sold USDT",
    sub_description: "For NGN",
    source_currency: "USDT",
    target_currency: "NGN",
    source_amount: "100",
    target_amount: "147386",
    trade: "sell",
    rate: {
      product: "USDTNGN",
      rate: "1473.86",
      side: "sell",
      type: "FIXED",
      source_currency: "USDT",
      target_currency: "NGN",
    },
    fees: [],
    pay_in: {
      address: "TDbX2dG8s9fLNg4YBGPsoAHFzzYgY5df57",
      expires_at: "2026-01-23T12:08:54.983548Z",
      network: "TRX",
      type: "address",
    },
    status: "pending",
    timeline: { total_steps: 0, current_step: 0, transfer_status: "", events: [] },
    created_at: "2026-01-23T11:08:54.912314446Z",
    updated_at: "2026-01-23T11:08:54.912314516Z",
  },
};

// [GH] RecipientCreate-2025-07-11 response example "ngn".
export const RECIPIENT_NGN = {
  status: "success",
  message: "Recipient created successfully",
  data: {
    id: "687560e1255ff9424db5e4c5",
    profile_id: "aa909417-099c-429a-9d74-89e9b5e8891c",
    account_name: "INU JOHN",
    account_number: "2134211381",
    active: true,
    bank_code: "000004",
    bank_name: "9 PAYMENT SOLUTIONS BANK",
    category: "bank",
    country_code: "NG",
    currency: "NGN",
    object: "recipients",
    owned_by_customer: true,
    type: "ngn_bank",
  },
};

// Live sandbox GET /v1/banks?currency=NGN on 2026-11-02, shortened.
export const BANKS_NGN = {
  status: "success",
  message: "Fetched Banks successfully",
  data: [
    { name: "9 Payment Solutions Bank", code: "120001", currency: "NGN" },
    { name: "Abbey Mortgage Bank", code: "070010", currency: "NGN" },
    { name: "Access Bank", code: "000014", currency: "NGN" },
  ],
};

// Busha publishes no example response; shape from [GH] ResolveBankAccountResp, values from the docs request example.
export const RESOLVED_ACCOUNT = {
  status: "success",
  data: {
    country_id: "NG",
    currency_id: "NGN",
    channel: "bank_transfer",
    bank_code: "000013",
    account_number: "0123456789",
    account_name: "John Doe",
  },
};

// guides/webhooks/webhook-events.md: transfer.funds_delivered.
export const WEBHOOK_DELIVERED = {
  business_id: "BUS_5asfnvrY9UuXBun4GWqNW",
  event: "transfer.funds_delivered",
  data: {
    id: "TRF_BuIVXa89aFC3",
    profile_id: "BUS_5asfnvrY9UuXBun4GWqNW",
    quote_id: "QUO_VJOBEK5ycGVM",
    stages: ["conversion", "withdrawal"],
    category: "sell",
    description: "Sold USDC",
    sub_description: "For NGN",
    source_currency: "USDC",
    target_currency: "NGN",
    source_amount: "0.4430943",
    target_amount: "500",
    trade: "sell",
    rate: {
      product: "USDCNGN",
      rate: "1371.04",
      side: "sell",
      type: "FIXED",
      source_currency: "USDC",
      target_currency: "NGN",
    },
    fees: [
      { amount: { amount: "100", currency: "NGN" }, name: "Fees", type: "FIXED" },
      { amount: { amount: "7.5", currency: "NGN" }, name: "VAT on Fee (7.5%)", type: "FIXED" },
    ],
    pay_out: {
      recipient_details: {
        account_name: "ABDULAZEEZ  ABDULAZEEZ ADESHIN",
        account_number: "0453699151",
        bank_code: "000013",
        bank_name: "Guaranty Trust Bank",
      },
      recipient_id: "68cbd12c0dd5c496d6fcb181",
      type: "bank_transfer",
      session_id: "090405260508143512664405513864",
    },
    status: "funds_delivered",
    timeline: { total_steps: 0, current_step: 0, transfer_status: "", events: [] },
    created_at: "2026-05-08T13:33:52.23489Z",
    updated_at: "2026-05-08T13:35:14.54597Z",
  },
};

// guides/webhooks/webhook-events.md: transfer.funds_not_delivered.
export const WEBHOOK_NOT_DELIVERED = {
  business_id: "BUS_CQr0jPzGGzmn1uW5W7OVs",
  event: "transfer.funds_not_delivered",
  data: {
    id: "TRF_notDelivered789",
    profile_id: "BUS_CQr0jPzGGzmn1uW5W7OVs",
    source_currency: "NGN",
    target_currency: "NGN",
    source_amount: "5000",
    target_amount: "5000",
    status: "funds_not_delivered",
    pay_out: {
      type: "bank_transfer",
      recipient_details: {
        account_name: "John Doe",
        account_number: "0123456789",
        bank_name: "First Bank of Nigeria",
      },
    },
    error: { code: "invalid_account", message: "Bank account details are invalid or account is closed" },
    created_at: "2025-12-05T14:20:00.000000Z",
    updated_at: "2025-12-05T14:25:00.000000Z",
  },
};

// Live GET /health on both hosts, 2026-11-02.
export const HEALTH = { status: "success", message: "health check passed" };

// Live production POST /v1/quotes/unauthenticated (no key), 2026-11-10. A public quote has no recipient, so no fees.
export const PUBLIC_QUOTE = {
  status: "success",
  message: "Created quote successfully",
  data: {
    id: "QUO_p7eILbKu9tWc",
    profile_id: "",
    source_currency: "USDC",
    target_currency: "NGN",
    source_amount: "100",
    target_amount: "137253",
    rate: {
      product: "USDCNGN",
      rate: "1372.53",
      rate_explained: "1 USDC = 1,372.53 NGN",
      side: "sell",
      type: "FIXED",
      source_currency: "USDC",
      target_currency: "NGN",
    },
    fees: [],
    pay_in: { network: "SOL", type: "address" },
    pay_out: { type: "balance" },
    reference: "QUO_p7eILbKu9tWc",
    status: "pending",
    expires_at: "2026-11-10T08:02:13.130786279Z",
    created_at: "2026-11-10T07:59:13.129942355Z",
    updated_at: "2026-11-10T07:59:13.129942355Z",
  },
};

export const PUBLIC_QUOTED_AT = new Date(PUBLIC_QUOTE.data.created_at);

// Live production POST /v1/quotes/unauthenticated for a KES target, 2026-11-10: source_amount has 8 decimals.
export const PUBLIC_QUOTE_KES_TARGET = {
  status: "success",
  message: "Created quote successfully",
  data: {
    id: "QUO_tVpRVEvkRIjK",
    profile_id: "",
    source_currency: "USDC",
    target_currency: "KES",
    source_amount: "38.74767514",
    target_amount: "5000",
    rate: {
      product: "USDCKES",
      rate: "129.04",
      rate_explained: "1 USDC = 129.04 KES",
      side: "sell",
      type: "FIXED",
      source_currency: "USDC",
      target_currency: "KES",
    },
    fees: [],
    pay_in: { network: "SOL", type: "address" },
    pay_out: { type: "balance" },
    reference: "QUO_tVpRVEvkRIjK",
    status: "pending",
    expires_at: "2026-11-10T07:58:17.396377789Z",
    created_at: "2026-11-10T07:55:17.395411134Z",
    updated_at: "2026-11-10T07:55:17.395411134Z",
  },
};

// Live production GET /v1/currencies/USDC (no key), 2026-11-10, shortened to the network list.
export const CURRENCY_USDC = {
  status: "success",
  message: "Fetched currency successfully",
  data: {
    code: "USDC",
    supported_networks: [
      {
        network: "POL",
        status: "active",
        deposit: true,
        is_ramp_sell_supported: false,
        min_deposit_amount: "2",
      },
      {
        network: "SOL",
        status: "active",
        deposit: true,
        is_ramp_sell_supported: true,
        min_deposit_amount: "2",
      },
      {
        network: "XLM",
        status: "active",
        deposit: true,
        is_ramp_sell_supported: false,
        min_deposit_amount: "2",
      },
      {
        network: "BASE",
        status: "active",
        deposit: true,
        is_ramp_sell_supported: false,
        min_deposit_amount: "2",
      },
    ],
    is_ramp_sell_supported: true,
  },
};

// Live production GET /v1/countries?country=NG, 2026-11-10, shortened.
export const COUNTRIES_NG = {
  status: "success",
  message: "Fetched countries successfully",
  data: [
    {
      id: "NG",
      name: "Nigeria",
      calling_code: "+234",
      currency: { code: "NGN", name: "Naira", symbol: "NGN" },
    },
  ],
};
