// Every body below is copied from Bitnob's official OpenAPI file
// (bitnob.dev/api-collections/swagger/bitnob-api-v2.openapi.json) or its payout webhook page, as recorded in
// EXTERNAL_ADAPTERS/BITNOB.md. Bitnob's published examples are all NGN; the adapter is corridor-agnostic, so tests
// run them through an NG bank corridor until sandbox recordings for Ghana exist.

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

export const QUOTE = {
  success: true,
  message: "Quote created successfully",
  data: {
    payout: {
      id: "019f2f22-2dad-792b-900d-ccc1c3731874",
      quote_id: "QT2_21015643",
      company_id: "7a3f909c-1208-42d5-927a-583c41281d8a",
      status: "QUOTE",
      source: "OFFCHAIN",
      from_asset: "USDT",
      to_currency: "NGN",
      sat_amount: "1144",
      btc_amount: "0.00001144",
      cent_amount: "100000",
      amount: "0.724761",
      settlement_amount: "1000",
      cent_fees: "0",
      fees: "0",
      exchange_rate: {
        rate: "1382.5294",
        btc_rate: "63327.05",
        currency: "ngn",
        effective_rate: "1379.7651915597003702",
      },
      trip: { quote_at: "2026-07-04T21:56:36.909598538Z" },
      payment_reason: "Invoice payment",
      reference: "your-unique-ref-123",
      country: "NG",
      expires_at: "2026-07-04T22:12:36.909609058Z",
      created_at: "2026-07-04T21:56:36.911340825Z",
      updated_at: "2026-07-04T21:56:36.911340825Z",
    },
  },
  timestamp: "2026-07-04T21:56:36.919134356Z",
};

export const INITIALIZE = {
  success: true,
  message: "Payout initialized successfully",
  data: {
    payout: {
      id: "019f2f22-2dad-792b-900d-ccc1c3731874",
      quote_id: "QT2_21015643",
      company_id: "",
      status: "INITIATED",
      source: "SOURCE_UNSET",
      from_asset: "USDT",
      to_currency: "NGN",
      sat_amount: "1144",
      btc_amount: "0.000011",
      amount: "0.724761",
      settlement_amount: "1000.000000",
      cent_fees: "0",
      fees: "0.000000",
      exchange_rate: {
        rate: "1382.529400",
        btc_rate: "63327.050000",
        currency: "",
        effective_rate: "1379.7651915597003702",
      },
      beneficiary: {
        account_name: "OKEY JOY CHIDIMMA",
        account_number: "0123456789",
        bank_code: "058",
        country: "NG",
        destination_type: "bank",
      },
      payment_reason: "vendor_payment",
      reference: "your-unique-ref-123",
      country: "",
      expires_at: "2026-07-04T22:12:36Z",
      created_at: null,
      updated_at: null,
    },
    data: null,
  },
  timestamp: "2026-07-04T21:56:37.105232508Z",
};

const SETTLED_PAYOUT = {
  id: "01a15f0a-02ed-7859-9a5f-1c4c67e95389",
  quote_id: "QT2_21053554",
  company_id: "7a3f909c-1208-42d5-927a-583c41281d8a",
  source: "OFFCHAIN",
  from_asset: "USDT",
  to_currency: "NGN",
  sat_amount: "874",
  btc_amount: "0.00000874",
  cent_amount: "100000",
  amount: "0.739331",
  settlement_amount: "1000",
  cent_fees: "0",
  fees: "0",
  fee_currency: "USD",
  source_fee: "0",
  total_amount: "0.739331",
  exchange_rate: {
    rate: "1355.284",
    btc_rate: "84598.45",
    currency: "ngn",
    effective_rate: "1352.5741514964204125",
  },
  beneficiary: {
    account_name: "OKEY JOY CHIDIMMA",
    account_number: "0123456789",
    bank_code: "058",
    country: "NG",
    destination_type: "bank",
  },
  payment_reason: "vendor_payment",
  reference: "spec-po-1792595852",
  callback_url: "https://example.com/webhooks/payouts",
  provider_settlement_id: "sandbox_txn_bfc22197-4be8-4f42-b682-a2e73b027b02",
  country: "NG",
  expires_at: "2026-10-21T15:33:34.064912Z",
  created_at: "2026-10-21T15:17:34.067610Z",
};

export const FINALIZE = {
  success: true,
  message: "Payout finalized successfully",
  data: {
    payout: {
      ...SETTLED_PAYOUT,
      status: "PENDING",
      trip: {
        quote_at: "2026-10-21T15:17:34.061521360Z",
        initialized_at: "2026-10-21T15:17:35.545013408Z",
      },
      updated_at: "2026-10-21T15:17:36.075770398Z",
    },
  },
  timestamp: "2026-10-21T15:17:36.079883541Z",
};

export const BY_REFERENCE = {
  success: true,
  message: "Payout retrieved successfully",
  data: {
    payout: {
      ...SETTLED_PAYOUT,
      status: "SUCCESS",
      trip: {
        quote_at: "2026-10-21T15:17:34.061521360Z",
        initialized_at: "2026-10-21T15:17:35.545013408Z",
        processing_start: "2026-10-21T15:17:36.082427922Z",
        completion_time: "2026-10-21T15:17:36.192422808Z",
      },
      updated_at: "2026-10-21T15:17:36.192422Z",
    },
  },
  timestamp: "2026-10-21T15:17:36.504504334Z",
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
  success: true,
  message: "Beneficiary lookup completed",
  data: {
    account_name: "CHIAMAKA JENNIFER EZEOBI",
    account_number: "1421795566",
    bank_code: "000014",
    bank_name: "ACCESS BANK",
    country: "NG",
    is_verified: true,
  },
  timestamp: "2026-06-19T10:47:03.950149804Z",
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
