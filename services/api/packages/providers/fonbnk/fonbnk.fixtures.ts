// Bodies copied from docs.fonbnk.com (Merchant API v2), fetched 2026-11-02; see EXTERNAL_ADAPTERS/FONBNK.md.
// Sandbox-only fields are trimmed. Values are the docs' own, including their historical timestamps.

// server-to-server/integration-guide/flow-examples/crypto-to-fiat.md
export const QUOTED_AT = new Date("2025-12-01T13:30:28.208Z");

export const QUOTE = {
  quoteId: "692d9874a60e2135463730cf",
  quoteExpiresAt: "2025-12-01T14:00:28.208Z",
  deposit: {
    paymentChannel: "crypto",
    currencyType: "crypto",
    currencyCode: "POLYGON_USDT",
    currencyDetails: {
      network: "POLYGON",
      asset: "USDT",
      contractAddress: "0x3b3a06b48119c035a2e86afdb69d9ad930643b3d",
    },
    cashout: {
      amountBeforeFees: 21.272315,
      amountAfterFees: 21.272315,
      amountBeforeFeesUsd: 21.272315,
      amountAfterFeesUsd: 21.272315,
      chargedFees: [],
      chargedFeesUsd: [],
      totalChargedFees: 0,
      totalChargedFeesUsd: 0,
      exchangeRate: 1,
      exchangeRateAfterFees: 1,
      chargedFeesPerRecipient: {},
      chargedFeesPerRecipientUsd: {},
      feeSettings: [],
    },
    fieldsToCreateOrder: [
      { key: "blockchainWalletAddress", type: "string", label: "Your wallet address", required: false },
    ],
    transferType: "manual",
  },
  payout: {
    paymentChannel: "bank",
    currencyType: "fiat",
    currencyCode: "NGN",
    currencyDetails: { countryIsoCode: "NG" },
    cashout: {
      amountBeforeFees: 31088,
      amountAfterFees: 30000,
      amountBeforeFeesUsd: 21.272315,
      amountAfterFeesUsd: 20.527839,
      chargedFees: [
        { id: "service_fee", type: "percentage", recipient: "platform", amount: 777.2 },
        { id: "merchant_fee", type: "percentage", recipient: "merchant", amount: 310.88 },
      ],
      chargedFeesUsd: [
        { id: "service_fee", type: "percentage", recipient: "platform", amount: 0.531808 },
        { id: "merchant_fee", type: "percentage", recipient: "merchant", amount: 0.212723 },
      ],
      totalChargedFees: 1088.08,
      totalChargedFeesUsd: 0.744531,
      exchangeRate: 1461.43,
      exchangeRateAfterFees: 1514.4312,
      chargedFeesPerRecipient: { platform: 777.2, merchant: 310.88 },
      chargedFeesPerRecipientUsd: { platform: 0.531808, merchant: 0.212723 },
      feeSettings: [
        { id: "service_fee", recipient: "platform", type: "percentage", value: 2.5, min: 0, max: "Infinity" },
        { id: "merchant_fee", recipient: "merchant", type: "percentage", value: 1, min: 0, max: "Infinity" },
      ],
    },
    fieldsToCreateOrder: [
      { key: "phoneNumber", label: "Phone Number", required: true, type: "phone" },
      {
        key: "bankCode",
        label: "Bank name",
        required: true,
        type: "enum",
        options: [
          { label: "Sandbox Bank", value: "1" },
          { label: "Sandbox Bank 2", value: "2" },
          { label: "Sandbox Bank 3", value: "3" },
        ],
      },
      { key: "bankAccountNumber", label: "Bank Account Number", required: true, type: "string" },
    ],
  },
};

// Same page: the create-order response for that quote.
export const CREATE_ORDER = {
  quoteUsed: true,
  order: {
    _id: "692d98b0a60e21354637311a",
    countryIsoCode: "NG",
    userId: "686671f07730d8d1a9b2260a",
    userEmail: "someuser@example.com",
    status: "deposit_awaiting",
    deposit: {
      paymentChannel: "crypto",
      currencyType: "crypto",
      currencyCode: "POLYGON_USDT",
      currencyDetails: {
        network: "POLYGON",
        asset: "USDT",
        contractAddress: "0x3b3a06b48119c035a2e86afdb69d9ad930643b3d",
      },
      providedFieldsToCreateOrder: { blockchainWalletAddress: "0x5b7ae3c6c87f4a3f94b35c77233b13191ebfad20" },
      transferInstructions: {
        type: "manual",
        instructionsText:
          "Please send the exact amount of crypto to the address below. Make sure to send only USDT on the Polygon network. Sending any other assets or using a different network may result in loss of funds.",
        transferDetails: [
          {
            id: "recipientWalletAddress",
            label: "Wallet address to send",
            value: "0xdc9cbad0c43f912a66cd44cd22a15c04368e659f",
          },
          {
            id: "senderWalletAddress",
            label: "Your wallet address",
            value: "0x5b7ae3c6c87f4a3f94b35c77233b13191ebfad20",
          },
          { id: "amountToSend", label: "Amount to send", value: "21.272315" },
          {
            id: "cryptoTransactionRequestAdditionalData",
            label: "Crypto transaction additional data",
            value: "",
          },
        ],
        fieldsToConfirmOrder: [
          { key: "blockchainTransactionHash", type: "string", label: "Transaction hash", required: true },
        ],
      },
    },
    payout: {
      paymentChannel: "bank",
      currencyType: "fiat",
      currencyCode: "NGN",
      currencyDetails: { countryIsoCode: "NG" },
      providedFieldsToCreateOrder: {
        phoneNumber: "2348012345678",
        bankCode: "1",
        bankAccountNumber: "1234567890",
      },
    },
    statusChangeLogs: [],
    createdAt: "2025-12-01T13:31:28.372Z",
    updatedAt: "2025-12-01T13:31:28.372Z",
    expiresAt: "2025-12-01T14:01:28.156Z",
  },
};

// server-to-server/api-endpoints/confirm-order.md: the transaction hash from its request example.
export const CONFIRM_HASH = "0xe168c39bf7165c0eaa88e4df1e21e987666e44f11f2bea6f9be1c145f382dade";

// server-to-server/webhooks.md: the docs' only payload (an on-ramp into the merchant balance).
export const WEBHOOK_PAYOUT_SUCCESSFUL = {
  event: "order-status-change",
  data: {
    order: {
      _id: "68df90a2372f378356ef75c1",
      userId: "68df8fcb372f378356ef7568",
      userEmail: "someuser@example.com",
      merchantOrderParams: "01K6MMKBKC8CX4SMJAR49DX5RZ",
      countryIsoCode: "NG",
      flow: "regular",
      type: "on_ramp",
      source: "api",
      status: "payout_successful",
      deposit: {
        paymentChannel: "bank",
        currencyType: "fiat",
        currencyCode: "NGN",
        currencyDetails: { countryIsoCode: "NG" },
        cashout: {
          exchangeRate: 1460.2,
          exchangeRateAfterFees: 1505.2969,
          amountBeforeFees: 15054,
          amountAfterFees: 14603,
          amountBeforeFeesUsd: 10.309547,
          amountAfterFeesUsd: 10.000685,
        },
      },
      payout: {
        paymentChannel: "merchant_balance",
        currencyType: "merchant_balance",
        currencyCode: "USD",
        currencyDetails: { merchantName: "Your company" },
        cashout: {
          exchangeRate: 1,
          exchangeRateAfterFees: 1,
          amountBeforeFees: 10,
          amountAfterFees: 10,
          amountBeforeFeesUsd: 10,
          amountAfterFeesUsd: 10,
        },
      },
      createdAt: "2025-10-03T08:56:43.212Z",
      updatedAt: "2025-10-03T08:57:03.247Z",
    },
    userKyc: {
      passedKycType: "basic",
      passedKycHash: "a5f0c1e4d2b34f7a9c1e0f6b8d2a4c31",
      latestKycType: "basic",
      latestKycStatus: "approved",
    },
  },
};

// server-to-server/api-endpoints/get-available-currencies.md (trimmed to two entries).
export const CURRENCIES = [
  {
    currencyType: "fiat",
    currencyCode: "KES",
    paymentChannels: [
      {
        name: "M-PESA",
        type: "mobile_money",
        transferTypes: ["stk_push", "otp_stk_push"],
        isDepositAllowed: true,
        isPayoutAllowed: true,
        carriers: [{ code: "ke_safaricom", name: "Safaricom Kenya" }],
      },
      {
        name: "Bank transfer",
        type: "bank",
        transferTypes: [],
        isDepositAllowed: false,
        isPayoutAllowed: true,
      },
    ],
    currencyDetails: { countryIsoCode: "KE" },
    pairs: ["crypto", "merchant_balance"],
  },
  {
    currencyType: "crypto",
    currencyCode: "POLYGON_USDT",
    paymentChannels: [
      {
        name: "Crypto",
        type: "crypto",
        transferTypes: ["manual"],
        isDepositAllowed: true,
        isPayoutAllowed: true,
      },
    ],
    currencyDetails: {
      network: "POLYGON",
      asset: "USDT",
      contractAddress: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    },
    pairs: ["fiat", "merchant_balance"],
  },
];

// server-to-server/errors.md: the envelope, with the get-order "not available" code.
export const ORDER_NOT_AVAILABLE = { message: "Order not available", errorCode: "ORDER_NOT_AVAILABLE" };

// server-to-server/errors.md example.
export const AMOUNT_BELOW_MINIMUM = {
  message:
    "The deposit amount is below the minimum of 1494 NGN. Call GET /api/v2/order-limits for the amount limits of this corridor.",
  errorCode: "AMOUNT_BELOW_MINIMUM",
  details: { leg: "deposit", field: "deposit.amount", min: 1494, max: 747367, currencyCode: "NGN" },
};
