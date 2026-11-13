import health from "../../../../spec/fixtures/health.json";
import rate from "../../../../spec/fixtures/rate.usdc-ngn.json";
import quote from "../../../../spec/fixtures/quote.usdc-ngn-50.json";
import account from "../../../../spec/fixtures/verify.gtbank-0123456789.json";
import payout from "../../../../spec/fixtures/payout.created.json";
import settled from "../../../../spec/fixtures/payout.settled.json";
import institutions from "../../../../spec/fixtures/institutions.ng.json";
import payouts from "../../../../spec/fixtures/payouts.list.json";

export const playgroundFixtures = {
  settled,
  "GET /v1/health": health,
  "GET /v1/rates/usdc/ngn": rate,
  "POST /v1/quote": quote,
  "POST /v1/accounts/verify": account,
  "POST /v1/institutions/verify": account,
  "GET /v1/institutions": institutions,
  "POST /v1/payouts": payout,
  "GET /v1/payouts": payouts,
  [`GET /v1/payouts/${settled.payout_id}`]: settled,
};
