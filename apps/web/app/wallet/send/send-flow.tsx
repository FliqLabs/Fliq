"use client";

/* eslint-disable @next/next/no-img-element -- provider and flag images are tiny fixed images */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { signInWithPasskey } from "../../auth/passkey";
import { Icon } from "../../components/app/icons";
import { Avatar, BigMoney, Modal, Notice, PageState, Spinner } from "../../components/app/ui";
import { bankLogo, PROVIDERS } from "../../lib/assets";
import { NoDeviceKeyError, signAndRelay } from "../../lib/device-signer";
import { vaultTransfer } from "../../lib/near-delegate";
import { explorerTxUrl } from "../../lib/near-explorer";
import {
  CURRENCIES,
  cleanAmount,
  formatMoney,
  formatRate,
  formatUsd,
  fromMinorUnits,
  toTokenUnits,
  type LocalCurrency,
} from "../../lib/money";
import { forgetNumber, rememberNumber, savedNumber } from "../../lib/saved-accounts";
import { walletApi, type Person, type RankedQuote, type Recipient, type RelayResult } from "../../lib/wallet-api";
import { keys, useInstitutions, useMe, usePasskeys, useRateBoard, useRecentPeople, useRecipients, useVault } from "../../lib/wallet-queries";
import { bestRoute } from "../home";
import { AddRecipientDrawer } from "../recipient-drawer";

type Target =
  | { kind: "bank"; recipient: Recipient; currency: LocalCurrency; payoutType: "bank" | "mobile_money" }
  | { kind: "fliq"; person: Person };

type Step = "who" | "amount" | "review" | "done";

const FLIQ_NAME = /^[a-z0-9][a-z0-9-]{1,30}(\.fliq\.near|\.near|\.testnet)?$/;

function Steps({ step }: { step: Step }) {
  const order: Step[] = ["who", "amount", "review", "done"];
  const index = order.indexOf(step);
  return (
    <div className="steps">
      {["Recipient", "Amount", "Review", "Sending"].map((name, position) => (
        <span key={name} className={position === index ? "on" : position < index ? "done" : ""}>
          <i>{position < index ? <Icon name="check" size={12} /> : position + 1}</i>
          {name}
        </span>
      ))}
    </div>
  );
}

function useRecipientCurrency() {
  const kenya = useInstitutions("ke");
  const nigeria = useInstitutions("ng");
  return (recipient: Recipient) => {
    const ke = kenya.data?.items.find((item) => item.code === recipient.bank.code);
    const ng = nigeria.data?.items.find((item) => item.code === recipient.bank.code);
    const institution = ke ?? ng;
    return {
      currency: (ke ? "KES" : "NGN") as LocalCurrency,
      payoutType: institution?.type ?? (ke ? "mobile_money" : "bank"),
    };
  };
}

function targetName(target: Target) {
  return target.kind === "bank" ? target.recipient.account_name : (target.person.display_name ?? target.person.near_account);
}

function targetSub(target: Target) {
  return target.kind === "bank"
    ? `${target.recipient.bank.name} ••${target.recipient.account_last4} · ${CURRENCIES[target.currency].country}`
    : `${target.person.near_account} · fliq account`;
}

function TargetAvatar({ target, size }: { target: Target; size?: "sm" | "xs" }) {
  return target.kind === "bank" ? (
    <Avatar
      name={target.recipient.account_name}
      badge={bankLogo(target.recipient.bank.logo_key, target.recipient.bank.code, target.recipient.bank.name)}
      size={size}
    />
  ) : (
    <Avatar name={targetName(target)} photo={target.person.photo_url} badge="/landing/tokens/near.webp" size={size} />
  );
}

function WhoStep({ onPick }: { onPick: (target: Target) => void }) {
  const recipients = useRecipients();
  const people = useRecentPeople();
  const currencyOf = useRecipientCurrency();
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState(false);
  const needle = query.trim().toLowerCase();
  const lookup = useQuery({
    queryKey: ["person", needle],
    queryFn: () => walletApi.person(needle),
    enabled: FLIQ_NAME.test(needle),
    retry: false,
  });
  const saved = (recipients.data?.items ?? []).filter(
    (item) => !needle || item.account_name.toLowerCase().includes(needle) || item.bank.name.toLowerCase().includes(needle),
  );
  const recent = (people.data?.items ?? []).filter(
    (person) => !needle || person.near_account.includes(needle) || (person.display_name ?? "").toLowerCase().includes(needle),
  );
  const found = lookup.data && !recent.some((person) => person.near_account === lookup.data.near_account) ? lookup.data : null;

  return (
    <div className="stack">
      <label className="search">
        <Icon name="search" size={18} />
        <input
          id="who-q"
          placeholder="Name, bank or fliq name"
          value={query}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <section className="card">
        <div className="rows">
          {recipients.isPending && (
            <div className="empty">
              <Spinner />
            </div>
          )}
          {saved.map((recipient) => (
            <button
              type="button"
              key={recipient.recipient_id}
              className="row"
              onClick={() => onPick({ kind: "bank", recipient, ...currencyOf(recipient) })}
            >
              <Avatar
                name={recipient.account_name}
                badge={bankLogo(recipient.bank.logo_key, recipient.bank.code, recipient.bank.name)}
              />
              <div className="t">
                <b>
                  {recipient.account_name}
                  {recipient.own && (
                    <span className="chip" style={{ marginLeft: 6 }}>
                      You
                    </span>
                  )}
                </b>
                <span>
                  {recipient.bank.name} ••{recipient.account_last4} · {CURRENCIES[currencyOf(recipient).currency].country}
                </span>
              </div>
              <Icon name="chevR" size={18} />
            </button>
          ))}
          {[...recent, ...(found ? [found] : [])].map((person) => (
            <button type="button" key={person.near_account} className="row" onClick={() => onPick({ kind: "fliq", person })}>
              <Avatar name={person.display_name ?? person.near_account} photo={person.photo_url} badge="/landing/tokens/near.webp" />
              <div className="t">
                <b>{person.display_name ?? person.near_account}</b>
                <span>{person.near_account} · fliq account</span>
              </div>
              <Icon name="chevR" size={18} />
            </button>
          ))}
          {recipients.isSuccess && saved.length === 0 && recent.length === 0 && !found && (
            <div className="empty">
              {needle ? (lookup.isFetching ? "Looking for that fliq name" : `No one matches "${query}".`) : "No saved recipients yet."}
            </div>
          )}
        </div>
      </section>
      <button type="button" className="btn line lg block" onClick={() => setAdding(true)}>
        <Icon name="plus" size={18} />
        New bank or mobile money account
      </button>
      <p className="hint" style={{ textAlign: "center" }}>
        Paying someone on fliq? Type their fliq name. It lands in their vault instantly and costs nothing.
      </p>
      {adding && (
        <AddRecipientDrawer
          cta="Save and continue"
          onClose={() => setAdding(false)}
          onSaved={({ recipient, currency }) => {
            setAdding(false);
            onPick({ kind: "bank", recipient, currency, payoutType: CURRENCIES[currency].payoutType });
          }}
        />
      )}
    </div>
  );
}

function amountError(amount: string, available: number | null) {
  const value = Number(amount);
  if (!amount || !(value > 0)) return "Enter an amount.";
  if (value < 1) return "The minimum is $1.00.";
  if (available != null && value > available + 1e-9) return `You have ${formatUsd(available)}. Add money or send less.`;
  return null;
}

function Summary({
  target,
  amount,
  quote,
  holdLeft,
}: {
  target: Target;
  amount: string;
  quote: RankedQuote | null;
  holdLeft: number | null;
}) {
  const board = useRateBoard(target.kind === "bank" ? target.currency : "ngn", target.kind === "bank");
  const usd = Number(amount) || 0;
  if (target.kind === "fliq") {
    return (
      <section className="card sum">
        <div className="who">
          <TargetAvatar target={target} size="xs" /> {targetName(target)} receives
        </div>
        <div className="big">
          <BigMoney value={usd} currency="USD" />
        </div>
        <div className="eta">instantly, in their fliq vault</div>
        <dl className="kv" style={{ margin: 0 }}>
          <div>
            <dt>You send</dt>
            <dd>{formatUsd(usd)}</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>Free</dd>
          </div>
          <div>
            <dt>To</dt>
            <dd>{target.person.near_account}</dd>
          </div>
        </dl>
      </section>
    );
  }
  const best = bestRoute(board.data);
  const currency = target.currency;
  const rate = quote?.rate ?? best?.rate ?? null;
  const receive = quote ? quote.receive : rate ? Math.floor(usd * rate) : null;
  const fee = quote ? fromMinorUnits(quote.fees.total) : best?.rate_before_fees && best.rate ? usd * (best.rate_before_fees - best.rate) : null;
  const provider = quote?.provider ?? best?.provider ?? null;
  const info = provider ? PROVIDERS[provider] : null;
  const onTime = quote?.routes.find((route) => route.routed)?.on_time_percent ?? best?.on_time_percent;
  return (
    <section className="card sum">
      <div className="who">
        <img src={CURRENCIES[currency].flag} alt="" />
        {targetName(target)} receives
      </div>
      <div className="big">{receive == null ? <span className="muted">···</span> : <BigMoney value={receive} currency={currency} />}</div>
      <div className="eta">
        {quote?.eta_seconds ? `in about ${quote.eta_seconds} seconds` : quote ? "Rate locked" : "Estimate at today's best rate"}
      </div>
      <dl className="kv" style={{ margin: 0 }}>
        <div>
          <dt>You send</dt>
          <dd>{formatUsd(usd)}</dd>
        </div>
        <div>
          <dt>Rate after fees</dt>
          <dd>{rate ? `$1 = ${formatRate(rate, currency)}` : "···"}</dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd>{fee == null ? "···" : formatMoney(fee, currency)}</dd>
        </div>
        <div>
          <dt>Route</dt>
          <dd>
            <span style={{ color: "var(--accent)" }}>Best of {quote?.best_of ?? board.data?.providers.length ?? 4}</span>
            {quote?.saving_vs_next ? (
              <span style={{ color: "var(--good)", fontSize: 12 }}> +{formatMoney(quote.saving_vs_next, currency)}</span>
            ) : null}
          </dd>
        </div>
      </dl>
      {info && (
        <div className="paidby">
          {info.logo && <img src={info.logo} alt="" />}
          <div style={{ minWidth: 0 }}>
            <b>Paid out by {info.name}</b>
            <span>Licensed{onTime ? ` · ${onTime}% on time` : ""}</span>
          </div>
        </div>
      )}
      <div style={{ padding: "0 20px 16px" }}>
        <span className="badge-cust">
          <Icon name="shield" size={15} />
          {quote?.routes.find((route) => route.routed)?.via_intents
            ? "Crosses chains through NEAR Intents · fliq never holds your money"
            : "Direct provider · fliq never holds your money"}
        </span>
      </div>
      {quote && holdLeft != null && (
        <div className="hold">
          <div>
            <span>Rate held for</span>
            <b>
              {Math.floor(holdLeft / 60)}:{String(holdLeft % 60).padStart(2, "0")}
            </b>
          </div>
          <div className="bar">
            <i style={{ width: `${(holdLeft / quote.expires_in) * 100}%` }} />
          </div>
        </div>
      )}
    </section>
  );
}

function AccountNumberCheck({ recipient, value, onChange }: { recipient: Recipient; value: string; onChange: (value: string) => void }) {
  const matches = value.length >= 4 && value.endsWith(recipient.account_last4);
  return (
    <div className="field" style={{ padding: "0 24px 18px" }}>
      <label htmlFor="acct-confirm">Full account number, ending {recipient.account_last4}</label>
      <input
        className="inp num"
        id="acct-confirm"
        inputMode="numeric"
        autoComplete="off"
        value={value}
        maxLength={13}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))}
      />
      <span className={value && !matches ? "err" : "hint"}>
        {value && !matches
          ? `That number does not end in ${recipient.account_last4}.`
          : "Needed once on this browser. It stays on this device."}
      </span>
    </div>
  );
}

export function SendFlow() {
  const params = useSearchParams();
  const router = useRouter();
  const queryClient = useQueryClient();
  const me = useMe();
  const vault = useVault();
  const passkeys = usePasskeys();
  const recipients = useRecipients();
  const people = useRecentPeople();
  const currencyOf = useRecipientCurrency();

  const [target, setTarget] = useState<Target | null>(null);
  const [step, setStep] = useState<Step>("who");
  const [amount, setAmount] = useState("50");
  const [number, setNumber] = useState("");
  const [quotedAt, setQuotedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [approving, setApproving] = useState(false);
  const [transfer, setTransfer] = useState<RelayResult | null>(null);
  const idempotency = useRef<string>("");
  const prefilled = useRef(false);

  const toId = params.get("to");
  const personId = params.get("person");
  useEffect(() => {
    if (prefilled.current) return;
    if (toId && recipients.data) {
      const recipient = recipients.data.items.find((item) => item.recipient_id === toId);
      if (recipient) {
        prefilled.current = true;
        pick({ kind: "bank", recipient, ...currencyOf(recipient) });
      }
    }
    if (personId && people.data) {
      const person = people.data.items.find((item) => item.near_account === personId);
      if (person) {
        prefilled.current = true;
        pick({ kind: "fliq", person });
      }
    }
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const quote = useMutation({
    mutationFn: () => {
      if (target?.kind !== "bank") throw new Error("Only bank payouts are quoted.");
      return walletApi.quote({ currency: target.currency, amount, payout_type: target.payoutType });
    },
    onSuccess: () => {
      setQuotedAt(Date.now());
      idempotency.current = crypto.randomUUID();
    },
  });

  const available = vault.data ? Number(vault.data.available) : null;
  const error = amountError(amount, available);
  const accountNumber = target?.kind === "bank" ? (savedNumber(target.recipient.recipient_id) ?? number) : "";
  const numberOk = target?.kind !== "bank" || (accountNumber.length >= 6 && accountNumber.endsWith(target.recipient.account_last4));
  const holdLeft = quote.data ? Math.max(0, quote.data.expires_in - Math.floor((now - quotedAt) / 1000)) : null;
  const expired = holdLeft === 0;

  function pick(next: Target) {
    setTarget(next);
    setNumber("");
    quote.reset();
    setStep("amount");
  }

  const pay = useMutation({
    mutationFn: async () => {
      if (!target || !me.data) throw new Error("Sign in again to send.");
      if (passkeys.data?.items.length && typeof window !== "undefined" && window.PublicKeyCredential) {
        await signInWithPasskey("login");
      }
      if (target.kind === "fliq") {
        if (!me.data.vault) throw new Error("Your vault is not set up yet.");
        const result = await signAndRelay(me.data, (signer) =>
          vaultTransfer(signer, me.data.vault!, target.person.near_account, toTokenUnits(amount)),
        );
        return { kind: "transfer" as const, result };
      }
      const payout = await walletApi.createPayout(
        { quote_id: quote.data!.quote_id, account: { bank: target.recipient.bank.code, number: accountNumber } },
        idempotency.current,
      );
      rememberNumber(target.recipient.recipient_id, accountNumber);
      return { kind: "payout" as const, payout };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: keys.vault });
      queryClient.invalidateQueries({ queryKey: ["activity"] });
      if (result.kind === "payout") {
        router.push(`/wallet/payouts/${encodeURIComponent(result.payout.payout_id)}`);
        return;
      }
      setApproving(false);
      setTransfer(result.result);
      setStep("done");
    },
    onError: (failure) => {
      if (target?.kind === "bank" && /account/i.test(failure.message)) forgetNumber(target.recipient.recipient_id);
    },
  });

  const title = useMemo(
    () => ({ who: "Who are you paying?", amount: "How much?", review: "Check and approve", done: "Paid" })[step],
    [step],
  );

  if (me.isPending) return <PageState message="Opening your wallet" />;

  let body: ReactNode;
  if (step === "who" || !target) {
    body = <WhoStep onPick={pick} />;
  } else if (step === "amount") {
    body = (
      <>
        <section className="card">
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "16px 20px", borderBottom: "1px solid var(--line)" }}>
            <TargetAvatar target={target} size="sm" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <b>{targetName(target)}</b>
              <div className="muted" style={{ fontSize: 12.5 }}>
                {targetSub(target)}
              </div>
            </div>
            <button type="button" className="btn ghost sm" onClick={() => setStep("who")}>
              Change
            </button>
          </div>
          <label className="amtbox" htmlFor="amt">
            <span className="cs">$</span>
            <input
              id="amt"
              inputMode="decimal"
              autoComplete="off"
              aria-label="Amount in US dollars"
              value={amount}
              onChange={(event) => setAmount(cleanAmount(event.target.value))}
              autoFocus
            />
          </label>
          <div style={{ padding: "0 24px 14px" }}>
            {error ? <span className="err">{error}</span> : <span className="hint">From your vault · {available == null ? "···" : formatUsd(available)} available</span>}
          </div>
          <div className="quick">
            {[20, 50, 100].map((value) => (
              <button type="button" key={value} onClick={() => setAmount(String(value))}>
                ${value}
              </button>
            ))}
            {available != null && available > 0 && (
              <button type="button" onClick={() => setAmount(available.toFixed(2))}>
                All · {formatUsd(available)}
              </button>
            )}
          </div>
          {target.kind === "bank" && !savedNumber(target.recipient.recipient_id) && (
            <AccountNumberCheck recipient={target.recipient} value={number} onChange={setNumber} />
          )}
        </section>
        <div style={{ display: "flex", gap: 10 }}>
          <button type="button" className="btn line lg" onClick={() => setStep("who")}>
            Back
          </button>
          <button
            type="button"
            className="btn ink lg"
            style={{ flex: 1 }}
            disabled={Boolean(error) || !numberOk}
            onClick={() => {
              setStep("review");
              if (target.kind === "bank") quote.mutate();
            }}
          >
            Review
          </button>
        </div>
      </>
    );
  } else if (step === "review") {
    body =
      target.kind === "fliq" ? (
        <section className="card pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <Notice tone="good" icon="zap">
            Both of you are on fliq, so this moves vault to vault on NEAR. No bank, no provider, no fee.
          </Notice>
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn line lg" onClick={() => setStep("amount")}>
              Back
            </button>
            <button type="button" className="btn ink lg" style={{ flex: 1 }} onClick={() => setApproving(true)}>
              <Icon name="finger" size={18} />
              Approve
            </button>
          </div>
        </section>
      ) : quote.isPending ? (
        <section className="card pad" style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <Spinner />
          <div>
            <b>Comparing every provider</b>
            <div className="muted" style={{ fontSize: 13 }}>
              After every fee, for {formatUsd(amount)}
            </div>
          </div>
        </section>
      ) : quote.isError ? (
        <>
          <Notice tone="bad">{quote.error.message}</Notice>
          <button type="button" className="btn ink lg block" onClick={() => quote.mutate()}>
            <Icon name="refresh" size={18} />
            Try again
          </button>
        </>
      ) : quote.data ? (
        <>
          <section className="card">
            <div className="card-h" style={{ paddingBottom: 4 }}>
              <h2>Routes for {formatUsd(amount)}</h2>
              <span className="muted" style={{ fontSize: 12.5 }}>
                Sorted by what lands after every fee
              </span>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "14px 16px 16px" }}>
              {[...quote.data.routes]
                .sort((a, b) => Number(b.status === "live") - Number(a.status === "live") || (b.receive ?? 0) - (a.receive ?? 0))
                .map((route) => {
                  const off = route.status !== "live";
                  const info = PROVIDERS[route.provider];
                  return (
                    <div key={route.provider} className={`route ${off ? "off" : ""}`} aria-current={route.routed ? "true" : undefined}>
                      {info.logo ? <img src={info.logo} alt="" /> : <span className="av"><span className="ph"><Icon name="bank" size={18} /></span></span>}
                      <div className="t">
                        <b>{info.name}</b>
                        <span>
                          {off
                            ? route.status === "paused"
                              ? "Paused after failed payouts"
                              : "Price is too old, so it was skipped"
                            : [
                                route.eta_seconds ? `About ${route.eta_seconds}s` : null,
                                route.on_time_percent ? `${route.on_time_percent}% on time` : null,
                                route.fee != null ? `fee ${formatMoney(fromMinorUnits(route.fee), target.currency)}` : null,
                                route.via_intents ? "via NEAR Intents" : null,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                        </span>
                      </div>
                      <div className="r">
                        {off ? (
                          <span className="muted">{route.status === "paused" ? "Paused" : "Skipped"}</span>
                        ) : (
                          <>
                            <b>{route.receive != null ? formatMoney(route.receive, target.currency) : route.rate ? formatRate(route.rate, target.currency) : ""}</b>
                            {route.routed ? (
                              <span style={{ color: "var(--good)" }}>Best</span>
                            ) : route.less_than_best ? (
                              <span className="muted">{formatMoney(route.less_than_best, target.currency)} less</span>
                            ) : null}
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
            </div>
          </section>
          {expired ? (
            <>
              <Notice tone="warn" icon="clock">
                This rate expired. Get a new one before you approve.
              </Notice>
              <button type="button" className="btn ink lg block" onClick={() => quote.mutate()}>
                <Icon name="refresh" size={18} />
                Get a new rate
              </button>
            </>
          ) : (
            <div style={{ display: "flex", gap: 10 }}>
              <button type="button" className="btn line lg" onClick={() => setStep("amount")}>
                Back
              </button>
              <button type="button" className="btn ink lg" style={{ flex: 1 }} onClick={() => setApproving(true)}>
                <Icon name="finger" size={18} />
                {passkeys.data?.items.length ? "Approve with passkey" : "Approve"}
              </button>
            </div>
          )}
        </>
      ) : null;
  } else {
    body = (
      <section className="card">
        <div className="paid-hero">
          <div className="okc">
            <Icon name="check" size={32} />
          </div>
          <div className="big">
            <BigMoney value={amount} currency="USD" />
          </div>
          <div>
            <b>landed in {targetName(target)}&apos;s fliq vault</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, padding: "0 20px 20px", flexWrap: "wrap" }}>
          {transfer?.tx_hash && (
            <a className="btn line" style={{ flex: 1 }} href={explorerTxUrl(transfer.tx_hash)} target="_blank" rel="noopener noreferrer">
              <Icon name="shield" size={17} />
              Verify on NEAR
            </a>
          )}
          <Link className="btn ink" style={{ flex: 1 }} href="/wallet">
            Done
          </Link>
        </div>
      </section>
    );
  }

  const showSummary = target && (step === "amount" || step === "review");
  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>{title}</h1>
        </div>
        <Steps step={step} />
      </div>
      {showSummary ? (
        <div className="cols">
          <div className="stack">{body}</div>
          <aside>
            <Summary target={target} amount={amount} quote={target.kind === "bank" && step === "review" ? (quote.data ?? null) : null} holdLeft={holdLeft} />
          </aside>
        </div>
      ) : (
        <div style={{ maxWidth: 720, width: "100%" }}>{body}</div>
      )}
      {approving && target && (
        <Modal onClose={() => !pay.isPending && setApproving(false)} locked={pay.isPending} label="Approve this payment">
          <div className="pk">
            <div className={`pk-ic ${pay.isPending ? "busy" : ""}`}>
              <Icon name="finger" size={40} />
            </div>
            <h2>{pay.isPending ? "Approving" : passkeys.data?.items.length ? "Approve with your passkey" : "Approve this payment"}</h2>
            <p>
              Send <b style={{ color: "var(--fg)" }}>{formatUsd(amount)}</b> so <b style={{ color: "var(--fg)" }}>{targetName(target)}</b> gets{" "}
              <b style={{ color: "var(--fg)" }}>
                {target.kind === "bank" && quote.data ? formatMoney(quote.data.receive, target.currency) : formatUsd(amount)}
              </b>
              .
            </p>
            {pay.isError && (
              <Notice tone="bad">
                {pay.error.message}
                {pay.error instanceof NoDeviceKeyError && (
                  <>
                    {" "}
                    <Link className="link" href="/wallet/account#device">
                      Restore it
                    </Link>
                  </>
                )}
              </Notice>
            )}
            {pay.isPending ? (
              <Spinner />
            ) : (
              <div className="row2" style={{ width: "100%" }}>
                <button type="button" className="btn line lg" onClick={() => setApproving(false)}>
                  Cancel
                </button>
                <button type="button" className="btn ink lg" onClick={() => pay.mutate()} disabled={target.kind === "bank" && expired}>
                  {passkeys.data?.items.length ? "Use passkey" : "Send"}
                </button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}

