// Every body below is copied from Paycrest's official docs (docs.paycrest.io/openapi-v2.yaml and llms-full.txt)
// or from a live unauthenticated public endpoint, as recorded in EXTERNAL_ADAPTERS/PAYCREST.md. Paycrest has no
// sandbox, so documented examples stand in for recordings until KYB clears and real orders can be captured.

export const RATES_SELL = {
  status: "success",
  message: "Rate fetched successfully",
  data: {
    sell: {
      rate: "1500.50",
      providerIds: ["AbCdEfGh", "IjKlMnOp", "QrStUvWx"],
      orderType: "regular",
      refundTimeoutMinutes: 60,
    },
  },
};

// openapi-v2.yaml POST /sender/orders 201 example "offrampSolana".
export const CREATE_ORDER = {
  status: "success",
  message: "Payment order created successfully",
  data: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    status: "initiated",
    orderType: "regular",
    timestamp: "2026-09-24T05:15:00Z",
    amount: "100",
    rate: "1650",
    senderFee: "4.9",
    senderFeePercent: "0",
    transactionFee: "0.1",
    reference: "invoice-123",
    providerAccount: {
      network: "solana",
      receiveAddress: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      validUntil: "2026-09-24T05:45:00Z",
      amountToTransfer: "105",
      currency: "USDC",
    },
    source: {
      type: "crypto",
      currency: "USDC",
      network: "solana",
      refundAddress: "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: {
        institution: "GTBINGLA",
        accountIdentifier: "1234567890",
        accountName: "John Doe",
        memo: "Payment",
      },
    },
  },
};

// No GET example is published; the GET schema is a superset of the create fields, so the create example is reused.
export const ORDER = CREATE_ORDER.data;

// llms-full.txt "Webhook Payload (v2)" example.
export const WEBHOOK_SETTLED_V2 = {
  event: "payment_order.settled",
  webhookVersion: "2",
  data: {
    id: "550e8400-e29b-41d4-a716-446655440000",
    direction: "offramp",
    amount: "100",
    amountInUsd: "100.00",
    amountPaid: "100",
    amountReturned: "0",
    percentSettled: "100",
    senderFee: "0.5",
    transactionFee: "0.01",
    rate: "1500.50",
    gatewayId: "0xabc123...",
    senderId: "sender-uuid",
    source: { type: "crypto", currency: "USDT", network: "base" },
    destination: {
      type: "fiat",
      currency: "NGN",
      recipient: {
        institution: "GTBINGLA",
        accountIdentifier: "1234567890",
        accountName: "John Doe",
        memo: "Payment",
      },
    },
    fromAddress: "0xsender...",
    reference: "payment-123",
    txHash: "0xtxhash...",
    status: "settled",
    timestamp: "2026-03-01T10:30:00Z",
    paymentReference: "100004261019223045000123456789",
  },
};

// Live GET https://api.paycrest.io/v2/institutions/KES on 2026-11-03 (excerpt).
export const INSTITUTIONS_KES = {
  status: "success",
  message: "OK",
  data: [
    { name: "Equity Bank", code: "EQBLKENA", type: "bank" },
    { name: "AIRTEL", code: "AIRTKEPC", type: "mobile_money" },
    { name: "M-PESA", code: "SAFAKEPC", type: "mobile_money" },
  ],
};

// llms-full.txt verify-account: data is the holder name, or "OK" when the rail confirms the account without a name.
export const VERIFY_NAME = { status: "success", data: "JOHN DOE" };
export const VERIFY_OK = { status: "success", data: "OK" };

// Live GET https://api.paycrest.io/health on 2026-11-03.
export const HEALTH = { live: "ok" };
