// Every body below is copied from Bitnob's official OpenAPI file
// (bitnob.dev/api-collections/swagger/bitnob-api-v2.openapi.json) or its payout webhook page. The on-chain Ghana
// bodies are the OpenAPI's "usdt_onchain_to_ghs_mobile_money" quote and "onchain_awaiting_deposit" initialize.

export const WHOAMI = {
  success: true,
  message: "Authenticated",
  data: {
    active: true,
    active_company_id: "7a3f909c-1208-42d5-927a-583c41281d8a",
    auth_method: "hmac",
    client_id: "86f1b05e-2e35-40bf-a85d-fd3de44d216b",
    client_name: "vaden travels",
    environment: "sandbox",
    permissions: null,
  },
  timestamp: "2026-06-19T10:39:49.945108267Z",
};

export const QUOTE_ONCHAIN_GHS = {
  data: {
    payout: {
      amount: "98.881974",
      btc_amount: "0.00145415",
      cent_amount: "150000",
      cent_fees: "0",
      chain: "CHAIN_TYPE_TRON",
      company_id: "019a3b5c-1f0e-7d2c-8a9b-4c5d6e7f8a90",
      country: "GH",
      created_at: "2026-10-30T09:15:02.481Z",
      exchange_rate: {
        btc_rate: "68000",
        currency: "ghs",
        effective_rate: "15.1696000729111658",
        rate: "15.2",
      },
      expires_at: "2026-10-30T09:31:02.481Z",
      fee_currency: "USD",
      fees: "0",
      from_asset: "USDT",
      id: "019a3b5d-0c3f-7e51-8f2a-6b7c8d9e0f12",
      quote_id: "QT2_100483",
      reference: "payout_ref_20261030_0008",
      sat_amount: "145415",
      settlement_amount: "1500",
      source: "ONCHAIN",
      source_fee: "0",
      status: "QUOTE",
      to_currency: "GHS",
      total_amount: "98.881974",
      trip: { quote_at: "2026-10-30T09:15:02.481Z" },
      updated_at: "2026-10-30T09:15:02.481Z",
    },
  },
  message: "Quote created successfully",
  success: true,
  timestamp: "2026-10-30T09:15:02.481Z",
};

// The OpenAPI's "usdt_to_ngn_bank" quote, the only example whose fee is priced at quote time.
export const QUOTE_WITH_FEE = {
  data: {
    payout: {
      amount: "100",
      btc_amount: "0.00147059",
      cent_amount: "14970000",
      cent_fees: "500000",
      company_id: "019a3b5c-1f0e-7d2c-8a9b-4c5d6e7f8a90",
      country: "NG",
      created_at: "2026-10-30T09:15:02.481Z",
      exchange_rate: { btc_rate: "68000", currency: "ngn", effective_rate: "1497", rate: "1500" },
      expires_at: "2026-10-30T09:31:02.481Z",
      fee_currency: "USD",
      fees: "0.5",
      from_asset: "USDT",
      id: "019a3b5c-8e21-7a4c-9b3d-2f6e8a1c4d70",
      payment_reason: "Supplier invoice 0042",
      quote_id: "QT2_100482",
      reference: "payout_ref_20261030_0007",
      sat_amount: "147059",
      settlement_amount: "149700",
      source: "OFFCHAIN",
      source_fee: "0.5",
      status: "QUOTE",
      to_currency: "NGN",
      total_amount: "100.5",
      trip: { quote_at: "2026-10-30T09:15:02.481Z" },
      updated_at: "2026-10-30T09:15:02.481Z",
    },
  },
  message: "Quote created successfully",
  success: true,
  timestamp: "2026-10-30T09:15:02.481Z",
};

export const INITIALIZE_ONCHAIN = {
  data: {
    data: null,
    payout: {
      address: "TExampleSandboxDeposit000000000002",
      amount: "98.881974",
      beneficiary: {
        account_name: "Kwame Mensah",
        account_number: "0240000001",
        country: "GH",
        destination_type: "mobile_money",
        network: "mtn",
      },
      btc_amount: "0.001454",
      cent_fees: "0",
      chain: "CHAIN_TYPE_TRON",
      company_id: "",
      country: "",
      created_at: null,
      deposit_amount: "98.881974",
      exchange_rate: {
        btc_rate: "68000",
        currency: "",
        effective_rate: "15.1696000729111658",
        rate: "15.2",
      },
      expires_at: "2026-10-30T09:31:02Z",
      fee_currency: "USD",
      fees: "0",
      from_asset: "USDT",
      id: "019a3b5d-0c3f-7e51-8f2a-6b7c8d9e0f12",
      quote_id: "QT2_100483",
      reference: "payout_ref_20261030_0008",
      sat_amount: "145415",
      settlement_amount: "1500",
      source: "SOURCE_UNSET",
      source_fee: "0",
      status: "PENDING_ADDRESS_DEPOSIT",
      to_currency: "GHS",
      total_amount: "98.881974",
      updated_at: null,
    },
  },
  message: "Payout initialized successfully",
  success: true,
  timestamp: "2026-10-30T09:15:02.481Z",
};

// The stored record behind INITIALIZE_ONCHAIN, from the OpenAPI's GET /api/payouts/quotes/{quoteId} example.
export const ONCHAIN_PAYOUT = {
  address: "TExampleSandboxDeposit000000000002",
  amount: "98.881974",
  beneficiary: {
    account_name: "Kwame Mensah",
    account_number: "0240000001",
    country: "GH",
    destination_type: "mobile_money",
    network: "mtn",
  },
  btc_amount: "0.00145415",
  cent_amount: "150000",
  cent_fees: "0",
  chain: "CHAIN_TYPE_TRON",
  company_id: "019a3b5c-1f0e-7d2c-8a9b-4c5d6e7f8a90",
  country: "GH",
  created_at: "2026-10-30T09:15:02.481Z",
  exchange_rate: {
    btc_rate: "68000",
    currency: "ghs",
    effective_rate: "15.1696000729111658",
    rate: "15.2",
  },
  expires_at: "2026-10-30T09:31:02.481Z",
  fee_currency: "USD",
  fees: "0",
  from_asset: "USDT",
  id: "019a3b5d-0c3f-7e51-8f2a-6b7c8d9e0f12",
  quote_id: "QT2_100483",
  reference: "payout_ref_20261030_0008",
  sat_amount: "145415",
  settlement_amount: "1500",
  source: "ONCHAIN",
  source_fee: "0",
  status: "PENDING_ADDRESS_DEPOSIT",
  to_currency: "GHS",
  total_amount: "98.881974",
  trip: {
    initialized_at: "2026-10-30T09:16:40.127Z",
    quote_at: "2026-10-30T09:15:02.481Z",
  },
  updated_at: "2026-10-30T09:16:40.127Z",
};

export const PAYOUT = {
  data: { payout: ONCHAIN_PAYOUT },
  message: "Payout retrieved successfully",
  success: true,
  timestamp: "2026-10-30T09:15:02.481Z",
};

// A completed payout with its settlement id, trimmed from the get-by-reference example in EXTERNAL_ADAPTERS/BITNOB.md.
export const PAYOUT_SUCCESS = {
  success: true,
  message: "Payout retrieved successfully",
  data: {
    payout: {
      id: "01a15f0a-02ed-7859-9a5f-1c4c67e95389",
      quote_id: "QT2_21053554",
      company_id: "7a3f909c-1208-42d5-927a-583c41281d8a",
      status: "SUCCESS",
      source: "OFFCHAIN",
      from_asset: "USDT",
      to_currency: "NGN",
      amount: "0.739331",
      settlement_amount: "1000",
      cent_fees: "0",
      fees: "0",
      fee_currency: "USD",
      source_fee: "0",
      total_amount: "0.739331",
      reference: "spec-po-1792595852",
      provider_settlement_id: "sandbox_txn_bfc22197-4be8-4f42-b682-a2e73b027b02",
      country: "NG",
      created_at: "2026-10-21T15:17:34.067610Z",
      updated_at: "2026-10-21T15:17:36.192422Z",
    },
  },
  timestamp: "2026-10-21T15:17:36.504504334Z",
};

// GET /api/payouts, shaped like the OpenAPI's "first_page" and "empty" examples.
export const PAYOUT_LIST = {
  data: { has_more: false, items: [ONCHAIN_PAYOUT], limit: 50, offset: 0, total_count: 1 },
  message: "Payouts retrieved successfully",
  success: true,
  timestamp: "2026-10-30T09:15:02.481Z",
};

export const PAYOUT_LIST_EMPTY = {
  data: { has_more: false, items: [], limit: 50, offset: 0, total_count: 0 },
  message: "Payouts retrieved successfully",
  success: true,
  timestamp: "2026-10-30T09:15:02.481Z",
};

export const NOT_FOUND = {
  type: "https://api.bitnob.com/errors/NOT_FOUND",
  title: "Resource Not Found",
  status: 404,
  detail: "payout with ID 'doc-x' was not found",
  code: "NOT_FOUND",
  correlation_id: "req_01a15f05-9ce6-7453-937d-073f94b0f597",
  timestamp: "2026-10-21T15:12:45.81270336Z",
};

export const BALANCE_USDT = {
  success: true,
  message: "Account balance retrieved successfully",
  data: {
    account_number: "3968048558",
    available_balance: "5017200",
    company_id: "7a3f909c-1208-42d5-927a-583c41281d8a",
    currency: "USDT",
    pending_balance: "0",
    total_balance: "5017200",
  },
  timestamp: "2026-06-19T10:39:51.424374223Z",
};

export const LOOKUP = {
  data: {
    account_name: "KWAME MENSAH",
    account_number: "0240000001",
    bank_code: "MTN",
    bank_name: "MTN Mobile Money",
    country: "GH",
    is_verified: true,
  },
  message: "Beneficiary lookup completed",
  success: true,
  timestamp: "2026-10-30T09:15:02.481Z",
};

export const LOOKUP_FAILED = {
  code: "VALIDATION_ERROR",
  correlation_id: "req_019a3b5c-7d1e-7f20-8a4b-3c5d6e7f8091",
  detail: "Unable to verify account details. Please check the information and try again.",
  extensions: { country: "NG" },
  request_id: "req_019a3b5c-7d1e-7f20-8a4b-3c5d6e7f8091",
  status: 400,
  timestamp: "2026-10-30T09:15:02Z",
  title: "Validation Error",
  type: "https://api.bitnob.com/errors/VALIDATION_ERROR",
};

export const LOOKUP_ROUTE_DISABLED = {
  code: "VALIDATION_ERROR",
  correlation_id: "req_019a3b5c-7d1e-7f20-8a4b-3c5d6e7f8091",
  detail: "Payouts to KE are temporarily unavailable.",
  extensions: { country: "KE", reason: "route_disabled" },
  request_id: "req_019a3b5c-7d1e-7f20-8a4b-3c5d6e7f8091",
  status: 400,
  timestamp: "2026-10-30T09:15:02Z",
  title: "Validation Error",
  type: "https://api.bitnob.com/errors/VALIDATION_ERROR",
};

export const BANKS_NG = {
  success: true,
  message: "Banks retrieved successfully",
  data: {
    banks: [
      { bank_name: "78 FINANCE COMPANY LIMITED", bank_code: "110072" },
      { bank_name: "9JAPAY MICROFINANCE BANK", bank_code: "090629" },
    ],
  },
};

// bitnob.dev/api-reference/payouts/webhooks.md, "payouts.withdrawal.success".
export const WEBHOOK_SUCCESS = {
  event: "payouts.withdrawal.success",
  event_id: "d9c4758ub-5e93-4cdf-bb123-frt474865",
  data: {
    id: "019f812d-ed2c-7f17-a2e9-12435e670813",
    quote_id: "QT2_21434859",
    company_id: "9876543-6c68-477b-bd95-769nn698",
    reference: "76543-1234-4304-869j-3a98e85f0812",
    status: "success",
    from_asset: "usdt",
    to_currency: "ngn",
    amount: "100.988948",
    settlement_amount: "140174.8",
    fees: "0",
    beneficiary: { country: "ng", bank_code: "100004", account_number: "****3001" },
    created_at: "2026-07-20T20:18:18.541002Z",
    updated_at: "2026-07-20T20:18:39.515031203Z",
    completed_at: "2026-07-20T20:18:39.515031203Z",
  },
};

// bitnob.dev/docs/payouts/webhook-payout.md, "payouts.withdrawal.failed".
export const WEBHOOK_FAILED = {
  event: "payouts.withdrawal.failed",
  event_id: "3f2a9c1e-7b44-4d10-9a55-6e1f0c2b7d11",
  data: {
    id: "019f8140-22aa-7c31-8d10-5a2b3c4d5e6f",
    quote_id: "QT2_21435102",
    company_id: "00000000-0000-4000-8000-000000000001",
    reference: "7b1e02e4-5678-467a-b91b-3a18dc000111",
    status: "failed",
    from_asset: "usdt",
    to_currency: "ngn",
    amount: "1.801875",
    settlement_amount: "2500",
    fees: "0",
    fee_currency: "USD",
    source_fee: "0",
    total_amount: "1.801875",
    beneficiary: { country: "NG", bank_code: "100004", account_number: "****4000" },
    failure_reason: "The payout could not be delivered. Your funds have been returned.",
    created_at: "2026-07-21T06:02:11.40112Z",
    updated_at: "2026-07-21T06:03:02.77310418Z",
    completed_at: "2026-07-21T06:03:02.77310418Z",
  },
};
