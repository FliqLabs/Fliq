"use client";

/* eslint-disable @next/next/no-img-element -- provider logo is a tiny fixed image */

import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../../components/app/icons";
import { BigMoney, Chip, Notice, PageState, useCopy } from "../../../components/app/ui";
import { PROVIDERS } from "../../../lib/assets";
import { formatMoney, formatRate, formatUsd, fromMinorUnits, toCurrency } from "../../../lib/money";
import { explorerTxUrl } from "../../../lib/near-explorer";
import { isFinal, outcomeOf, progress } from "../../../lib/payout-progress";
import { walletApi, type Institution } from "../../../lib/wallet-api";
import { keys, useInstitutions } from "../../../lib/wallet-queries";

const POLL_MS = 2_000;

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function timeOf(at: string | null) {
  return at ? new Date(at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "";
}

function useBankName(code: string) {
  const ng = useInstitutions("ng");
  const ke = useInstitutions("ke");
  const all: Institution[] = [...(ng.data?.items ?? []), ...(ke.data?.items ?? [])];
  return all.find((item) => item.code === code)?.name ?? "the bank";
}

export function PayoutTracker({ payoutId }: { payoutId: string }) {
  const queryClient = useQueryClient();
  const copy = useCopy();
  const payout = useQuery({
    queryKey: ["payout", payoutId],
    queryFn: () => walletApi.payout(payoutId),
    refetchInterval: (query) => (query.state.data && isFinal(query.state.data.state) ? false : POLL_MS),
  });
  const [now, setNow] = useState(() => Date.now());
  const final = payout.data ? isFinal(payout.data.state) : false;
  const bank = useBankName(payout.data?.account.bank ?? "");

  useEffect(() => {
    if (final) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [final]);

  useEffect(() => {
    if (!final) return;
    queryClient.invalidateQueries({ queryKey: keys.vault });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
  }, [final, queryClient]);

  if (payout.isPending) return <PageState message="Finding this payout" />;
  if (payout.isError) return <PageState message={payout.error.message} action={<Link className="btn line" href="/wallet/activity">Open activity</Link>} />;

  const p = payout.data;
  const currency = toCurrency(p.currency);
  const provider = PROVIDERS[p.provider];
  const outcome = outcomeOf(p.state);
  const steps = progress(p, { provider: provider.name, bank });
  const started = p.history[0]?.at ? new Date(p.history[0].at).getTime() : now;
  const seconds = p.seconds ?? Math.max(0, Math.round((now - started) / 1000));

  const hero =
    outcome === "paid" ? (
      <div className="paid-hero">
        <div className="okc">
          <Icon name="check" size={32} />
        </div>
        <div className="big">
          <BigMoney value={p.receive} currency={currency} />
        </div>
        <div>
          <b>
            landed in {p.account_name}&apos;s {bank} account
          </b>
          <div className="muted" style={{ fontSize: 13 }}>
            {seconds} seconds{p.settlement_name ? ` · their alert shows ${p.settlement_name}` : ""}
          </div>
        </div>
      </div>
    ) : (
      <div className="paid-hero">
        {outcome !== "moving" && (
          <div
            className="okc"
            style={{
              background: `var(--${outcome === "refunded" ? "warn" : "bad"}-soft)`,
              color: `var(--${outcome === "refunded" ? "warn" : "bad"})`,
            }}
          >
            <Icon name={outcome === "refunded" ? "refresh" : "x"} size={28} />
          </div>
        )}
        <div className="big">
          <BigMoney value={p.receive} currency={currency} />
        </div>
        <div className="muted">
          {outcome === "moving"
            ? `on its way to ${p.account_name} · ${clock(seconds)}`
            : outcome === "refunded"
              ? `did not reach ${p.account_name}. ${formatUsd(p.refund?.amount ?? p.amount)} is back in your vault.`
              : `did not reach ${p.account_name}`}
        </div>
      </div>
    );

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>{outcome === "paid" ? "Paid" : outcome === "moving" ? "Sending" : outcome === "refunded" ? "Refunded" : "Stopped"}</h1>
        </div>
        <span className="mono muted">{p.payout_id}</span>
      </div>
      <div style={{ maxWidth: 720, width: "100%", display: "flex", flexDirection: "column", gap: 16 }}>
        <section className="card">
          {hero}
          <dl className="kv" style={{ margin: 0 }}>
            <div>
              <dt>Sent</dt>
              <dd>{formatUsd(p.amount)}</dd>
            </div>
            <div>
              <dt>Rate after fees</dt>
              <dd>$1 = {formatRate(p.rate, currency)}</dd>
            </div>
            <div>
              <dt>Fees</dt>
              <dd>{formatMoney(fromMinorUnits(p.fees.total), currency)}</dd>
            </div>
            <div>
              <dt>Paid out by</dt>
              <dd style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "flex-end" }}>
                {provider.logo && <img src={provider.logo} alt="" style={{ width: 18, height: 18, borderRadius: "50%" }} />}
                {provider.name}
              </dd>
            </div>
            {p.bank_reference && (
              <div>
                <dt>{currency === "NGN" ? "NIP session" : "Reference"}</dt>
                <dd className="mono">{p.bank_reference}</dd>
              </div>
            )}
          </dl>
          {outcome === "paid" && (
            <div style={{ display: "flex", gap: 10, padding: "16px 20px 20px", flexWrap: "wrap" }}>
              {p.vault_receipt && (
                <a className="btn line" style={{ flex: 1 }} href={explorerTxUrl(p.vault_receipt)} target="_blank" rel="noopener noreferrer">
                  <Icon name="shield" size={17} />
                  Verify on NEAR
                </a>
              )}
              {p.bank_reference && (
                <button type="button" className="btn line" style={{ flex: 1 }} onClick={() => copy(p.bank_reference!, "Bank reference copied")}>
                  <Icon name="copy" size={17} />
                  Copy reference
                </button>
              )}
            </div>
          )}
        </section>
        {p.agent && <Notice icon="bot">Requested by {p.agent.name}, inside the limits your vault holds.</Notice>}
        <section className="card">
          <div className="card-h">
            <h2>{outcome === "moving" ? "Live status" : "What happened"}</h2>
            <Chip tone="good">
              <Icon name="shield" size={13} />
              Non-custodial
            </Chip>
          </div>
          <div className="track">
            {steps.map((step) => (
              <div key={step.key} className={`tstep ${step.state === "bad" ? "wait" : step.state}`}>
                <span className="tdot" style={step.state === "bad" ? { background: "var(--bad-soft)", color: "var(--bad)" } : undefined}>
                  {step.state === "done" ? <Icon name="check" size={15} /> : step.state === "now" ? <Icon name="clock" size={15} /> : step.state === "bad" ? <Icon name="x" size={15} /> : null}
                </span>
                <div>
                  <b>{step.title}</b>
                  <span>{step.detail}</span>
                </div>
                <time>{timeOf(step.at)}</time>
              </div>
            ))}
          </div>
        </section>
        <div style={{ display: "flex", gap: 10 }}>
          {final ? (
            <>
              <Link className="btn line lg" style={{ flex: 1 }} href="/wallet/send">
                Send again
              </Link>
              <Link className="btn ink lg" style={{ flex: 1 }} href="/wallet">
                Done
              </Link>
            </>
          ) : (
            <Link className="btn line lg block" href="/wallet">
              Back to home, keep tracking
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
