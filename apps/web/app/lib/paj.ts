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
  if (!response.ok) throw new Error(pajError(body));
  return body as T;
}

export const pajApi = {
  quote: (naira: string, session: PajSession) =>
    pajRequest<PajQuote>(`/pub/rates/onramp-value?currency=NGN&fiatAmount=${encodeURIComponent(naira)}&mint=${PAJ_MINT}`, session),
  order: (naira: string, recipient: string, session: PajSession) =>
    pajRequest<PajOrder>("/pub/onramp", session, {
      method: "POST",
      body: JSON.stringify({ fiatAmount: Number(naira), currency: "NGN", recipient, mint: PAJ_MINT, chain: "SOLANA" }),
    }),
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

export function readBankDeposits(): BankDepositRecord[] {
  if (typeof window === "undefined") return [];
  try {
    const value = JSON.parse(window.localStorage.getItem(BANK_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item) => item && typeof item.depositId === "string") : [];
  } catch {
    return [];
  }
}

export function recordBankDeposit(record: BankDepositRecord) {
  if (typeof window === "undefined") return;
  const records = [record, ...readBankDeposits().filter((item) => item.depositId !== record.depositId)].slice(0, 30);
  window.localStorage.setItem(BANK_KEY, JSON.stringify(records));
  window.dispatchEvent(new Event(bankEvent));
}

export function useBankDeposits() {
  const [records, setRecords] = useState<BankDepositRecord[]>([]);
  useEffect(() => {
    const refresh = () => setRecords(readBankDeposits());
    const refreshStatuses = async () => {
      const current = readBankDeposits();
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
        window.localStorage.setItem(BANK_KEY, JSON.stringify(updates));
        refresh();
      }
    };
    refresh();
    void refreshStatuses();
    const timer = window.setInterval(() => void refreshStatuses(), 8_000);
    window.addEventListener(bankEvent, refresh);
    return () => { window.clearInterval(timer); window.removeEventListener(bankEvent, refresh); };
  }, []);
  return records;
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
