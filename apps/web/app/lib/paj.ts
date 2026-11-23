import { useEffect, useState } from "react";
import type { ActivityItem, DepositSource, VaultDeposit } from "./wallet-api";

export type PajSession = { token: string; expiresAt: string; contact?: string };
export type PajQuote = { fiatAmount: number; amount: number; rate: number };
export type PajOrder = {
  id: string;
  fiatAmount: number;
  amount: number;
  rate: number;
  accountNumber?: string | null;
  accountName?: string | null;
  bank?: string | null;
  status: "INIT" | "PAID" | "COMPLETED" | "FAILED" | "CANCELLED" | string;
  signature?: string | null;
};

export class PajOrderUncertainError extends Error {
  constructor() {
    super("Paj could not confirm the bank order. Do not retry this order; contact support if you need help.");
    this.name = "PajOrderUncertainError";
  }
}

class PajHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
    this.name = "PajHttpError";
  }
}

const PAJ_BASE = "https://api.paj.cash";
const PAJ_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const decimal = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

export function decimalParts(value: string) {
  const trimmed = value.trim();
  if (!decimal.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return { whole: whole.replace(/^0+(?=\d)/, "") || "0", fraction };
}

export function compareDecimals(left: string, right: string) {
  const a = decimalParts(left);
  const b = decimalParts(right);
  if (!a || !b) return null;
  const fractionLength = Math.max(a.fraction.length, b.fraction.length);
  const aa = BigInt(a.whole + a.fraction.padEnd(fractionLength, "0"));
  const bb = BigInt(b.whole + b.fraction.padEnd(fractionLength, "0"));
  return aa === bb ? 0 : aa < bb ? -1 : 1;
}

export function isPositiveDecimal(value: string) {
  return compareDecimals(value, "0") === 1;
}

export function parseNaira(value: string) {
  const cleaned = value.trim();
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)$/.test(cleaned)) return "";
  const digits = cleaned.replace(/,/g, "");
  const normalized = digits.replace(/^0+(?=\d)/, "") || "0";
  return normalized && normalized.length <= 15 && Number.isSafeInteger(Number(normalized)) ? normalized : "";
}

export function formatNaira(value: string) {
  const parts = decimalParts(value);
  if (!parts) return "₦—";
  const fraction = parts.fraction.replace(/0+$/, "");
  const whole = parts.whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `₦${whole}${fraction ? `.${fraction}` : ""}`;
}

export function decimalText(value: number, decimals = 6) {
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = String(value);
  const parts = decimalParts(text);
  if (!parts || parts.fraction.length > decimals) return null;
  return `${parts.whole}.${parts.fraction.padEnd(decimals, "0")}`.replace(/\.0+$/, "");
}

export function usdcAmountAtLeastMinimum(value: number, minimum: string) {
  const amount = decimalText(value);
  return amount && compareDecimals(amount, minimum) !== -1 ? amount : null;
}

export function isCompleteBankDetails(order: Pick<PajOrder, "bank" | "accountName" | "accountNumber">) {
  return Boolean(order.bank?.trim() && order.accountName?.trim() && /^\d{10}$/.test(order.accountNumber?.trim() ?? ""));
}

function pajError(body: unknown) {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join("; ");
  return typeof message === "string" ? message : "Paj didn't answer. Try again.";
}

async function pajRequest<T>(path: string, session: PajSession, init?: RequestInit) {
  const expiresAt = new Date(session.expiresAt).getTime();
  if (!session.token || !Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error("Your bank session expired. Confirm your email again.");
  const response = await fetch(`${PAJ_BASE}${path}`, {
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${session.token}`, ...init?.headers },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new PajHttpError(pajError(body), response.status);
  return body as T;
}

export const pajApi = {
  quote: (naira: string, session: PajSession) =>
    pajRequest<PajQuote>(`/pub/rates/onramp-value?currency=NGN&fiatAmount=${encodeURIComponent(naira)}&mint=${PAJ_MINT}`, session),
  // webhookURL is where Paj reports the order's status to the fliq API.
  order: async (naira: string, recipient: string, session: PajSession, webhookURL?: string | null) => {
    try {
      return await pajRequest<PajOrder>("/pub/onramp", session, {
        method: "POST",
        body: JSON.stringify({ fiatAmount: Number(naira), currency: "NGN", recipient, mint: PAJ_MINT, chain: "SOLANA", ...(webhookURL ? { webhookURL } : {}) }),
      });
    } catch (error) {
      // A timeout or 5xx may mean Paj created the order before the response was lost. Never retry it blindly.
      if (error instanceof PajHttpError && error.status >= 400 && error.status < 500) throw error;
      throw new PajOrderUncertainError();
    }
  },
  status: (id: string, session: PajSession) => pajRequest<{ order: PajOrder }>(`/pub/transactions/${encodeURIComponent(id)}`, session),
};

export type BankDepositRecord = {
  depositId: string;
  naira: string;
  usdc: string;
  startedAt: string;
  status?: ActivityItem["status"];
};

const BANK_KEY = "fliq.bank-deposits";
const bankEvent = "fliq-bank-deposits-changed";

export function bankStorageKey(owner: string | null | undefined) {
  return owner ? `${BANK_KEY}:${encodeURIComponent(owner)}` : null;
}

export function readBankDeposits(owner: string | null | undefined): BankDepositRecord[] {
  if (typeof window === "undefined") return [];
  const key = bankStorageKey(owner);
  if (!key) return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.depositId === "string") : [];
  } catch {
    return [];
  }
}

export function recordBankDeposit(record: BankDepositRecord, owner: string | null | undefined) {
  if (typeof window === "undefined") return;
  const key = bankStorageKey(owner);
  if (!key) return;
  const records = [record, ...readBankDeposits(owner).filter((item) => item.depositId !== record.depositId)].slice(0, 30);
  window.localStorage.setItem(key, JSON.stringify(records));
  window.dispatchEvent(new Event(bankEvent));
}

export function useBankDeposits(owner: string | null | undefined) {
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null);
  const [records, setRecords] = useState<BankDepositRecord[]>([]);
  useEffect(() => {
    const refresh = () => { setLoadedOwner(owner ?? null); setRecords(readBankDeposits(owner)); };
    if (!owner) { refresh(); return; }
    const refreshStatuses = async () => {
      const current = readBankDeposits(owner);
      const updates = await Promise.all(current.map(async (record) => {
        try {
          const response = await fetch(`/api/fliq/deposits/${encodeURIComponent(record.depositId)}`, { credentials: "same-origin" });
          if (!response.ok) return record;
          const deposit = await response.json() as { state?: string };
          const status: ActivityItem["status"] = deposit.state === "landed" ? "received" : deposit.state === "refunded" ? "refunded" : deposit.state === "expired" ? "expired" : deposit.state === "failed" ? "failed" : "pending";
          return { ...record, status };
        } catch {
          return record;
        }
      }));
      if (updates.some((item, index) => item.status !== current[index]?.status)) {
        const key = bankStorageKey(owner);
        if (key) window.localStorage.setItem(key, JSON.stringify(updates));
        refresh();
      }
    };
    refresh();
    void refreshStatuses();
    const timer = window.setInterval(() => void refreshStatuses(), 8_000);
    window.addEventListener(bankEvent, refresh);
    return () => { window.clearInterval(timer); window.removeEventListener(bankEvent, refresh); };
  }, [owner]);
  return loadedOwner === (owner ?? null) ? records : [];
}

export function bankActivityItem(record: BankDepositRecord, status: ActivityItem["status"] = record.status ?? "pending"): ActivityItem {
  return {
    activity_id: `bank-${record.depositId}`,
    kind: "deposit",
    status,
    at: record.startedAt,
    party: { name: "From your bank", near_account: null, institution: null, account_last4: null, photo_url: null },
    provider: null,
    agent: null,
    local: { amount: record.naira, currency: "NGN" },
    usd: record.usdc,
    token: "USDC on Solana",
    seconds: null,
    reason: null,
    ref_id: record.depositId,
  };
}

export function asBankActivity(item: ActivityItem, record: BankDepositRecord): ActivityItem {
  return { ...bankActivityItem(record, item.status), ...item, party: { ...item.party, name: "From your bank" }, provider: null, local: { amount: record.naira, currency: "NGN" }, usd: item.usd ?? record.usdc };
}

export function isBankSource(source: DepositSource) {
  return source.token === "usdc" && source.chain === "solana" && source.group === "dollars" && source.available && !source.direct;
}

export function depositIsFinal(deposit: VaultDeposit) {
  return ["landed", "refunded", "expired", "failed"].includes(deposit.state);
}
