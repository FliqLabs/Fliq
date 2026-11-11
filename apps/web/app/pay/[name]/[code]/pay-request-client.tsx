"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { ApiError, fliqApi } from "../../../lib/fliq-api";

const TIMEOUT_MS = 8_000;
const FINAL_DEPOSIT_STATES = new Set(["landed", "refunded", "expired", "failed"]);

type DepositSource = {
  token: "usdc" | "usdt" | "btc";
  chain: string;
  group: "dollars" | "bitcoin" | "near";
  minimum: string;
  eta_seconds: number;
  direct: boolean;
  available: boolean;
  address: string | null;
};

type PublicRequest = {
  near_account: string;
  display_name: string | null;
  photo_url: string | null;
  amount: string;
  note: string;
  state: "open" | "paid" | "cancelled";
  sources: DepositSource[];
};

type Deposit = {
  deposit_id: string;
  state: "waiting" | "seen" | "underpaid" | "bridging" | "landed" | "refunded" | "expired" | "failed";
  token: string;
  chain: string;
  address: string;
  memo: string | null;
  minimum: string;
  lands: string;
  eta_seconds: number;
  reserved_until: string;
  landed: string | null;
};

const TOKENS: Record<string, string> = { usdc: "USDC", usdt: "Tether USDT", btc: "Bitcoin" };
const CHAINS: Record<string, string> = {
  base: "Base",
  solana: "Solana",
  tron: "Tron",
  arbitrum: "Arbitrum",
  ethereum: "Ethereum",
  polygon: "Polygon",
  bitcoin: "Bitcoin",
  near: "NEAR",
};

const DEPOSIT_STATUS: Record<Deposit["state"], string> = {
  waiting: "Waiting for your payment",
  seen: "Payment seen, confirming it",
  underpaid: "Less than the minimum arrived. Send the rest before the address expires, or it is refunded.",
  bridging: "Moving it into fliq",
  landed: "Paid. Thank you.",
  refunded: "This payment was refunded.",
  expired: "Nothing arrived before the address expired. Pick a network again to get a new one.",
  failed: "This payment could not be completed. fliq support has been told.",
};

function timeout(init?: RequestInit): RequestInit {
  return { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) };
}

function payPath(name: string, code: string) {
  return `pay/${encodeURIComponent(name)}/${encodeURIComponent(code)}`;
}

function sourceLabel(source: { token: string; chain: string }) {
  return `${TOKENS[source.token] ?? source.token.toUpperCase()} on ${CHAINS[source.chain] ?? source.chain}`;
}

function sourceKey(source: { token: string; chain: string }) {
  return `${source.token}:${source.chain}`;
}

function errorMessage(error: unknown) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof DOMException && error.name === "TimeoutError") return "fliq didn't answer in time. Try again.";
  return "Something went wrong. Try again.";
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <section className={`rounded-xl border border-[#303030] bg-[#141414] p-5 sm:p-6 ${className}`}>{children}</section>;
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#999]">{children}</p>;
}

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="shrink-0 rounded-full border border-[#303030] px-3 py-1.5 text-xs text-[#ccc] transition hover:border-[#4a4a4a] hover:text-white"
    >
      {copied ? "Copied" : "Copy"}
    </button>
  );
}

function AddressBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-4">
      <p className="text-xs text-[#777]">{label}</p>
      <div className="mt-2 flex items-center gap-3 rounded-lg border border-[#262626] bg-[#0f0f0f] px-4 py-3">
        <code className="min-w-0 flex-1 break-all font-mono text-sm text-white">{value}</code>
        <CopyButton value={value} />
      </div>
    </div>
  );
}

function Message({ title, body }: { title: string; body: string }) {
  return (
    <Card className="mx-auto max-w-xl text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-[#999]">{body}</p>
    </Card>
  );
}

function DepositPanel({ name, code, deposit }: { name: string; code: string; deposit: Deposit }) {
  const { data } = useQuery({
    queryKey: ["request-deposit", name, code, deposit.deposit_id],
    queryFn: () => fliqApi<Deposit>(`${payPath(name, code)}/deposits/${encodeURIComponent(deposit.deposit_id)}`, timeout()),
    initialData: deposit,
    refetchInterval: (query) => (FINAL_DEPOSIT_STATES.has(query.state.data?.state ?? "") ? false : 5_000),
    retry: false,
  });
  const current = data ?? deposit;
  const reservedUntil = new Date(current.reserved_until);

  return (
    <div className="mt-5 border-t border-[#262626] pt-5">
      <p className="text-sm font-medium text-white">Send {sourceLabel(current)} to</p>
      <AddressBox label="Address" value={current.address} />
      {current.memo && <AddressBox label="Memo, required with the transfer" value={current.memo} />}
      <p className="mt-4 text-xs leading-5 text-[#777]">
        Send at least {current.minimum} {TOKENS[current.token] ?? current.token.toUpperCase()}. Only {sourceLabel(current)}{" "}
        reaches this address.
        {!Number.isNaN(reservedUntil.getTime()) &&
          ` Watched until ${reservedUntil.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}.`}
      </p>
      <p
        role="status"
        className={`mt-4 rounded-lg px-4 py-3 text-sm ${current.state === "landed" ? "bg-[#32b35a]/10 text-[#5fd17f]" : FINAL_DEPOSIT_STATES.has(current.state) || current.state === "underpaid" ? "bg-[#e8a317]/10 text-[#e8a317]" : "bg-[#1a1a1a] text-[#ccc]"}`}
      >
        {DEPOSIT_STATUS[current.state] ?? "Checking the payment"}
        {current.state === "landed" && current.landed && ` $${current.landed} landed.`}
      </p>
    </div>
  );
}

function WalletOption({ name, code, request }: { name: string; code: string; request: PublicRequest }) {
  const [selected, setSelected] = useState<string | null>(null);
  const reserve = useMutation({
    mutationFn: (source: DepositSource) =>
      fliqApi<Deposit>(`${payPath(name, code)}/deposits`, timeout({ method: "POST", body: JSON.stringify({ token: source.token, chain: source.chain }) })),
  });
  const source = request.sources.find((item) => sourceKey(item) === selected);

  return (
    <Card>
      <Eyebrow>Pay from any wallet</Eyebrow>
      <p className="mt-2 text-sm text-[#999]">Pick the coin and network you are sending from. It lands as dollars in {request.display_name ?? name}&apos;s fliq.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        {request.sources.map((item) => {
          const key = sourceKey(item);
          const isSelected = key === selected;
          if (!item.available) {
            return (
              <span key={key} aria-disabled="true" className="inline-flex cursor-not-allowed items-center gap-2 rounded-full border border-[#262626] px-3.5 py-2 text-xs text-[#555]">
                {sourceLabel(item)}
                <span className="text-[9px] uppercase tracking-wider">Not available</span>
              </span>
            );
          }
          return (
            <button
              key={key}
              type="button"
              aria-pressed={isSelected}
              onClick={() => {
                setSelected(key);
                if (!item.direct) reserve.mutate(item);
                else reserve.reset();
              }}
              className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-xs transition ${isSelected ? "border-[#a594ff] bg-[#a594ff]/10 text-white" : "border-[#303030] text-[#ccc] hover:text-white"}`}
            >
              {sourceLabel(item)}
            </button>
          );
        })}
      </div>

      {source?.direct && source.address && (
        <div className="mt-5 border-t border-[#262626] pt-5">
          <p className="text-sm font-medium text-white">Send {sourceLabel(source)} to</p>
          <AddressBox label="NEAR account" value={source.address} />
          <p className="mt-4 text-xs leading-5 text-[#777]">Send at least {source.minimum} USDC. It arrives in about {source.eta_seconds} seconds.</p>
        </div>
      )}
      {source && !source.direct && reserve.isPending && <p className="mt-5 text-sm text-[#999]">Getting an address for {sourceLabel(source)}…</p>}
      {source && !source.direct && reserve.isError && (
        <p role="alert" className="mt-5 rounded-lg bg-[#e8a317]/10 px-4 py-3 text-sm text-[#e8a317]">
          {errorMessage(reserve.error)}
        </p>
      )}
      {source && !source.direct && reserve.data && <DepositPanel key={reserve.data.deposit_id} name={name} code={code} deposit={reserve.data} />}
    </Card>
  );
}

function FliqOption({ name, who }: { name: string; who: string }) {
  return (
    <Card>
      <Eyebrow>Pay with fliq</Eyebrow>
      <p className="mt-2 text-sm text-[#999]">
        Instant and free between fliq users. In the app, tap Transfer, then Send, and pay <span className="text-white">{name}</span>.
      </p>
      <a
        href="fliq://"
        className="mt-4 inline-flex h-11 w-full items-center justify-center rounded-full bg-white text-sm font-semibold text-black transition hover:bg-[#e6e6e6] sm:w-auto sm:px-8"
      >
        Open fliq
      </a>
      <p className="mt-3 text-xs text-[#777]">No fliq yet? Pay {who} from any wallet below.</p>
    </Card>
  );
}

export function PayRequestClient({ name, code }: { name: string; code: string }) {
  const { data: request, error, isPending, refetch, isFetching } = useQuery({
    queryKey: ["public-request", name, code],
    queryFn: () => fliqApi<PublicRequest>(payPath(name, code), timeout()),
    refetchInterval: (query) => (query.state.data?.state === "open" ? 10_000 : false),
    retry: false,
  });

  if (isPending) return <Message title="Loading the request" body="One moment." />;
  if (error) {
    if (error instanceof ApiError && error.status === 404) {
      return <Message title="This link doesn't work" body="The request doesn't exist or was removed. Ask the sender for a new link." />;
    }
    return (
      <div className="mx-auto max-w-xl text-center">
        <Message title="Couldn't load this request" body={errorMessage(error)} />
        <button type="button" onClick={() => refetch()} disabled={isFetching} className="mt-4 text-sm text-[#a594ff] hover:text-white">
          {isFetching ? "Trying again…" : "Try again"}
        </button>
      </div>
    );
  }

  const who = request.display_name ?? name;
  return (
    <div className="mx-auto max-w-xl">
      <Card className="text-center">
        <Eyebrow>Payment request</Eyebrow>
        <p className="mt-4 text-sm text-[#999]">
          <span className="text-white">{who}</span> · {request.near_account}
        </p>
        <p className="mt-3 text-5xl font-semibold tracking-tight tabular-nums sm:text-6xl">${request.amount}</p>
        {request.note && <p className="mt-3 text-sm text-[#ccc]">{request.note}</p>}
        {request.state !== "open" && (
          <p
            role="status"
            className={`mt-5 inline-flex rounded-full px-3 py-1 text-xs ${request.state === "paid" ? "bg-[#32b35a]/10 text-[#5fd17f]" : "bg-[#e8a317]/10 text-[#e8a317]"}`}
          >
            {request.state === "paid" ? "Already paid" : "This request was cancelled"}
          </p>
        )}
      </Card>

      {request.state === "open" && (
        <div className="mt-3 grid gap-3">
          <FliqOption name={name} who={who} />
          <WalletOption name={name} code={code} request={request} />
        </div>
      )}

      <p className="mt-6 text-center text-[11px] leading-5 text-[#777]">
        fliq never shows {who}&apos;s balance or bank details. Payments land in their fliq vault as USDC.
      </p>
    </div>
  );
}
