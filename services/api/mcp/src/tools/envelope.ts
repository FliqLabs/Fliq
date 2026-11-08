export type EnvelopeStatus =
  | "ok"
  | "not_found"
  | "name_required"
  | "awaiting_deposit"
  | "awaiting_approval"
  | "pending"
  | "paid"
  | "refused"
  | "blocked"
  | "invalid_input"
  | "error";

// Every tool answers in this shape, so a model can always repeat summary and find the provider and receipt.
export interface Envelope<T = unknown> {
  status: EnvelopeStatus;
  summary: string;
  provider_of_record: string | null;
  refund_address: string | null;
  receipt_link: string | null;
  data: T;
}

const FAILED: ReadonlySet<EnvelopeStatus> = new Set(["refused", "blocked", "invalid_input", "error"]);

export function isFailure(envelope: Envelope): boolean {
  return FAILED.has(envelope.status);
}

export function envelope<T>(
  status: EnvelopeStatus,
  summary: string,
  data: T,
  extra: Partial<Pick<Envelope, "provider_of_record" | "refund_address" | "receipt_link">> = {},
): Envelope<T> {
  return {
    status,
    summary,
    provider_of_record: extra.provider_of_record ?? null,
    refund_address: extra.refund_address ?? null,
    receipt_link: extra.receipt_link ?? null,
    data,
  };
}

export function money(units: number, currency: string): string {
  return `${new Intl.NumberFormat("en-US").format(units)} ${currency.toUpperCase()}`;
}
