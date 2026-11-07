// Bodies from docs.transfi.com (API v3), fetched 2026-11-07; see EXTERNAL_ADAPTERS/TRANSFI.md.
// "Verbatim" bodies are the docs' own. The docs publish no IDR or PHP off-ramp example, so the bodies marked
// "schema-shaped" follow the documented fields with our test values; replace them with sandbox recordings.

// reference/list-payment-methods.md, example "No payment methods for currency" (verbatim).
export const NO_PAYMENT_METHODS = {
  status: "failure",
  error: {
    message: "No payment methods configured for currency XAF, direction deposit, userType business.",
    code: "NO_PAYMENT_METHODS_AVAILABLE",
  },
  errorId: "c4ebed63-ad1c-4a59-996f-c29185bc1f29",
  timestamp: "2026-04-13T10:10:48.852Z",
};

// Schema-shaped (reference/list-payment-methods.md, headlessMode=true). Codes gcash (Migration guide) and
// bjb, bjb_syr (Payout Bank Code Update) are documented; paymaya, bdo and ovo, names, limits and fields are ours.
export const PAYMENT_METHODS_PHP = {
  status: "success",
  data: [
    {
      name: "GCash",
      paymentCode: "gcash",
      paymentType: "local_wallet",
      logoUrl: "https://common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/gcash.svg",
      minAmount: 1,
      maxAmount: 50000,
      additionalDetails: { phone: { type: "string" } },
    },
    {
      name: "Maya",
      paymentCode: "paymaya",
      paymentType: "local_wallet",
      logoUrl: "https://common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/paymaya.svg",
      minAmount: 1,
      maxAmount: 50000,
      additionalDetails: { phone: { type: "string" } },
    },
    {
      name: "BDO Unibank",
      paymentCode: "bdo",
      paymentType: "bank_transfer",
      logoUrl: "https://common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/bdo.svg",
      minAmount: 100,
      maxAmount: 500000,
      additionalDetails: { accountNumber: { type: "string" }, accountName: { type: "string" } },
    },
  ],
  pagination: { total: 3, pages: 1, currentPage: 1, limit: 100, hasNext: false, hasPrev: false },
};

export const PAYMENT_METHODS_IDR_PAGE_1 = {
  status: "success",
  data: [
    {
      name: "Bank BJB",
      paymentCode: "bjb",
      paymentType: "bank_transfer",
      logoUrl: "https://common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/bjb.svg",
      minAmount: 10000,
      maxAmount: 100000000,
      additionalDetails: { accountNumber: { type: "string" }, accountName: { type: "string" } },
    },
    {
      name: "Card",
      paymentCode: "visa",
      paymentType: "card",
      logoUrl: "https://common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/visa.svg",
      minAmount: 10000,
      maxAmount: 100000000,
    },
  ],
  pagination: { total: 4, pages: 2, currentPage: 1, limit: 2, hasNext: true, hasPrev: false },
};

export const PAYMENT_METHODS_IDR_PAGE_2 = {
  status: "success",
  data: [
    {
      name: "Bank BJB Syariah",
      paymentCode: "bjb_syr",
      paymentType: "bank_transfer",
      logoUrl: "https://common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/bjb_syr.svg",
      minAmount: 10000,
      maxAmount: 100000000,
      additionalDetails: { firstName: { type: "string" }, lastName: { type: "string" } },
    },
    {
      name: "OVO",
      paymentCode: "ovo",
      paymentType: "local_wallet",
      logoUrl: "https://common-payment-methods-logo.s3.ap-southeast-1.amazonaws.com/ovo.svg",
      minAmount: 10000,
      maxAmount: 20000000,
      additionalDetails: { phoneNumber: { type: "string" } },
    },
  ],
  pagination: { total: 4, pages: 2, currentPage: 2, limit: 2, hasNext: false, hasPrev: true },
};

// Schema-shaped (reference/get-exchange-rates.md). Fee in fiat on the gross amount, as in the off-ramp webhook
// sample: gross 1010 PHP x 0.017 = 17.17 USDC sent, 10 PHP fee, 1000 PHP received.
export const QUOTED_AT = new Date("2026-11-07T09:00:00.000Z");

export const QUOTE_PHP = {
  status: "success",
  data: {
    sourceCurrency: "USDCPOLYGON",
    sourceAmount: 17.17,
    sourceAmountInUsd: 17.17,
    sourceCurrencyType: "crypto",
    destinationCurrency: "PHP",
    destinationAmount: 1000,
    destinationAmountInUsd: 17,
    destinationCurrencyType: "fiat",
    conversionRate: 0.017,
    minLimit: 100,
    maxLimit: 50000,
    orderType: "offramp",
    direction: "reverse",
    processingFee: 10,
    processingFeeRate: 0.0099,
    customerFee: "0",
    customerFeeRate: 0,
    rrFeeRate: "0",
    discount: "0",
    discountRate: "0",
    additionalFee: 0,
    fixedFee: {
      totalFixedFees: 0,
      totalFixedTfFees: 0,
      totalFixedCxFees: 0,
      fixedFeesCurrency: "",
      fixedFeeDetails: { baseFeeFixedRate: 0, tfFeeFixedRate: 0, cxFeeFixedRate: 0, currency: "" },
    },
    totalFee: 10,
    feeMode: "percentage",
  },
};

// reference/get-exchange-rates.md, example "payin" (verbatim): published without the success envelope.
export const QUOTE_PAYIN_UNWRAPPED = {
  sourceCurrency: "EUR",
  sourceAmount: 250,
  sourceAmountInUsd: 293.3,
  sourceCurrencyType: "fiat",
  destinationCurrency: "USDC",
  destinationAmount: 290.362431,
  destinationAmountInUsd: 290.36,
  destinationCurrencyType: "crypto",
  conversionRate: 0.852382630283,
  minLimit: 22,
  maxLimit: 85238.26,
  orderType: "payin",
  direction: "forward",
  processingFee: 2.5,
  processingFeeRate: 0.01,
  customerFee: "0",
  customerFeeRate: 0,
  rrFeeRate: "0",
  discount: "0",
  discountRate: "0",
  additionalFee: 0,
  fixedFee: {
    totalFixedFees: 0,
    totalFixedTfFees: 0,
    totalFixedCxFees: 0,
    fixedFeesCurrency: "",
    fixedFeeDetails: { baseFeeFixedRate: 0, tfFeeFixedRate: 0, cxFeeFixedRate: 0, currency: "" },
  },
  totalFee: 2.5,
  feeMode: "percentage",
};

// reference/get-order.md, example "Initiated Order" (verbatim).
export const ORDER_INITIATED = {
  status: "success",
  data: {
    id: "OR-2603061122114241024",
    status: "initiated",
    type: "gaming",
    purposeCode: "personal",
    purposeCodeReason: "Converting crypto to fiat for personal expenses and bill payments",
    source: { currency: "IDR", amount: "171729" },
    destination: { currency: "USDC", amount: "171729" },
    userId: "UX-250910053447199",
    senderName: { firstName: "Test", lastName: "User" },
    mid: "SAH5F0_SHGASJ_NA",
  },
};

// reference/get-order.md, example "Failed Order" (verbatim).
export const ORDER_FAILED = {
  status: "success",
  data: {
    id: "OR-2604090713034795598",
    status: "fund_failed",
    type: "gaming",
    purposeCode: "expense_or_medical_reimbursement",
    source: { currency: "AED", amount: "51" },
    destination: { currency: "USDC", amount: "12.932634" },
    userId: "UX-260409071207010480",
    senderName: { firstName: "Test_Customer" },
    mid: "SAAE88_SPGINX_NA",
    partnerContext: {
      testfield1: "1234",
      testfield2: "5678",
      testfield3: 123,
      testfield4: "13 USD",
      testfield7: "#!*++!@%@!@%",
    },
    fees: {
      feeMode: "percentage",
      fixedFee: {
        totalFixedFees: 0,
        totalFixedTfFees: 0,
        totalFixedCxFees: 0,
        fixedFeesCurrency: "AED",
        fixedFeeDetails: { baseFeeFixedRate: 0, tfFeeFixedRate: 0, cxFeeFixedRate: 0, currency: "" },
      },
      networkFee: 0,
      processingFee: 2.3,
      rrFee: "0.005",
    },
    failureCode: "DECLINED_BY_BANK_SUSPECTED_FRAUD",
    failureMessage: "Transaction was declined by the bank",
  },
};

// reference/get-order.md, 400 example "transfer_not_found" (verbatim).
export const TRANSFER_NOT_FOUND = {
  status: "failure",
  error: {
    message: "Transfer not found",
    code: "VALIDATION_ERROR",
    context: { details: [{ code: "TRANSFER_NOT_FOUND", message: "Transfer not found" }] },
  },
  errorId: "057eb61a-728d-4609-92cf-5ef712ceae58",
};

// Schema-shaped: reference/create-order.md response plus the off-ramp fields the Migration guide names
// (data.walletAddress, data.cryptoCurrency, data.cryptoNetwork, data.cryptoAmount). The order id is the
// Initiated Order example's so the read-back matches; the address is a test value.
export const CREATE_ORDER_OFFRAMP = {
  status: "success",
  data: {
    flow: "OFFRAMP",
    orderId: ORDER_INITIATED.data.id,
    walletAddress: "0x4f6a9c2be1d07a35c8e2f1b6d9a0c3e7f5b8d241",
    cryptoCurrency: "USDCPOLYGON",
    cryptoNetwork: "polygon",
    cryptoAmount: 17.17,
    quoteHistory: {
      refreshCount: 0,
      orderCreationQuote: {
        isRefreshed: false,
        usedQuotes: {
          ...QUOTE_PHP.data,
          rateType: "live",
          quoteId: "QUOTE-1c459c8e-6d66-4982-aade-a3626f12ff49",
        },
      },
    },
  },
  traceId: "18c56011-810a-4d55-9f33-23dc590fc6ba",
};

// reference/create-order.md, 400 example "partner_id_already_used" (verbatim).
export const PARTNER_ID_ALREADY_USED = {
  status: "failure",
  error: {
    message: "Transfer Creation failed",
    code: "VALIDATION_ERROR",
    context: {
      details: [{ code: "PARTNER_ID_ALREADY_USED", message: "Partner ID already used in another order" }],
    },
  },
  errorId: "5a1f2c3d-1111-4b2c-8e9f-000000000003",
  traceId: "5a1f2c3d-1111-4b2c-8e9f-000000000003",
};

// reference/cancel-orders.md, example "Order Successfully Cancelled" (verbatim).
export const ORDER_CANCELLED = {
  status: "success",
  data: { orderId: "OR-2606161304198836944", status: "cancelled", message: "Order cancelled successfully" },
  traceId: "386cffec-ec5d-4602-aa44-78114f5f62ab",
};

// reference/list-mids.md, example "List of MIDs" (verbatim).
export const LIST_MIDS = {
  status: "success",
  data: [
    { mid: "SABCDEF_SCT8YW_NA", name: "transfi checkout", status: "active", level: "merchant" },
    { mid: "SABCDEF_SDE35Y_NA", name: "transfi bizpay", status: "active", level: "merchant" },
    {
      mid: "SABCDEF_SCT8YW_SSTODU",
      name: "transfi checkout submerchant",
      status: "active",
      level: "sub_merchant",
    },
  ],
  pagination: { total: 10, pages: 2, currentPage: 1, limit: 5, hasNext: true, hasPrev: false },
};

// docs/webhook-events-offramp.md, sample "Fund Settled" (verbatim).
export const WEBHOOK_FUND_SETTLED = {
  eventId: "EV-260824111425459",
  entityId: "OR-260824111423413832397538943",
  entityType: "order",
  status: "fund_settled",
  mid: "ABCDEF_NA_NA",
  user: {
    userId: "UX-251207074635111",
    firstName: "sumanth",
    lastName: "dev",
    country: "IN",
    createdAt: "2025-12-07T07:46:36.062Z",
  },
  order: {
    orderId: "OR-260824111423413832397538943",
    type: "sell",
    fiatTicker: "AED",
    cryptoTicker: "USDC",
    cryptoNetwork: "",
    fiatAmount: 200,
    cryptoAmount: 61.754114,
    paymentType: "bank_transfer",
    txnHash: "",
    walletAddress: "",
    destinationWalletAddress: "",
    createdAt: "2026-08-24T11:14:23.730Z",
    customerOrderId: "OR-260824111423413832397538943",
    failureCode: "",
    failureMessage: "",
    bankTxnId: [] as string[],
    quoteHistory: {
      refreshCount: 0,
      orderCreationQuote: {
        isRefreshed: false,
        usedQuotes: {
          sourceCurrency: "USDC",
          sourceAmount: 61.754114,
          sourceAmountInUsd: 61.74,
          sourceCurrencyType: "crypto",
          destinationCurrency: "AED",
          destinationAmount: 200,
          destinationAmountInUsd: 55.57,
          destinationCurrencyType: "fiat",
          conversionRate: 0.2778935667639294,
          processingFee: 22.22,
          processingFeeRate: 0.1,
          customerFee: 0,
          customerFeeRate: 0,
          discount: 0,
          discountRate: 0,
          additionalFee: 0,
          fixedFee: {
            totalFixedFees: 0,
            totalFixedTfFees: 0,
            totalFixedCxFees: 0,
            fixedFeesCurrency: "",
            fixedFeeDetails: { baseFeeFixedRate: 0, tfFeeFixedRate: 0, cxFeeFixedRate: 0, currency: "" },
          },
          totalFee: 22.22,
          feeMode: "percentage",
          rateType: "live",
          quoteId: "QUOTE-8b75217b-6b2c-422c-b808-500d4950cfb5",
          networkFee: 0,
        },
      },
    },
  },
  createdAt: "2026-08-24T11:14:25.311Z",
};
