import type { components } from "@fliq/spec";

type Schemas = components["schemas"];
// The generator marks fields with a default as required; the API fills them in when they are left out.
type WithDefaults<T, K extends keyof T> = Omit<T, K> & Partial<Pick<T, K>>;

export type ProviderId = Schemas["ProviderId"];
export type Rate = Schemas["Rate"];
export type QuoteRequest = WithDefaults<Schemas["QuoteRequest"], "payout_type" | "mode" | "preference">;
export type Quote = Schemas["Quote"];
export type Route = Schemas["Route"];
export type Fees = Schemas["Fees"];
export type Account = Schemas["Account"];
export type AccountLookup = WithDefaults<Schemas["AccountLookup"], "country">;
export type VerifiedAccount = Schemas["VerifiedAccount"];
export type Institution = Schemas["Institution"];
export type InstitutionList = Schemas["InstitutionList"];
export type PayoutCountry = Schemas["PayoutCountry"];
export type PayoutRequest = Schemas["PayoutRequest"];
export type Payout = Schemas["Payout"];
export type PayoutState = Schemas["PayoutState"];
export type PayoutDisplayStatus = Schemas["PayoutDisplayStatus"];
export type PayoutSummary = Schemas["PayoutSummary"];
export type PayoutList = Schemas["PayoutList"];
export type PayoutStats = Schemas["PayoutStats"];
export type StateChange = Schemas["StateChange"];
export type Refusal = Schemas["Refusal"];
export type ErrorBody = Schemas["ErrorBody"];
export type ErrorResponse = Schemas["Error"];
export type RelayResult = Schemas["RelayResult"];
export type WebhookEvent = Schemas["WebhookEvent"];
export type WebhookEventType = Schemas["WebhookEventType"];
