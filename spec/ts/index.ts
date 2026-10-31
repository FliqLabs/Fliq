import type { components, paths } from "./openapi";

export type { components, paths };

type Schemas = components["schemas"];

export type Rate = Schemas["Rate"];
export type Quote = Schemas["Quote"];
export type QuoteRequest = Schemas["QuoteRequest"];
export type Route = Schemas["Route"];
export type Account = Schemas["Account"];
export type VerifiedAccount = Schemas["VerifiedAccount"];
export type PayoutRequest = Schemas["PayoutRequest"];
export type Payout = Schemas["Payout"];
export type PayoutState = Schemas["PayoutState"];
export type Refusal = Schemas["Refusal"];
export type ApiError = Schemas["Error"];
