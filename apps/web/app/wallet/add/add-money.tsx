"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../components/app/icons";
import { QrCode } from "../../components/app/qr-code";
import { Chip, Drawer, Logo, Notice, Spinner, Toggle, useCopy, useToast } from "../../components/app/ui";
import { chain, tokenLogo } from "../../lib/assets";
import { cleanAmount, formatUsd } from "../../lib/money";
import { walletApi, type DepositSource, type PaymentRequest, type VaultDeposit } from "../../lib/wallet-api";
import { keys, useDepositSources, useMe, useRequests } from "../../lib/wallet-queries";

const DEPOSIT_POLL_MS = 3_000;
const FINAL_DEPOSIT = new Set(["landed", "refunded", "expired", "failed"]);

function eta(seconds: number) {
  return seconds >= 120 ? `about ${Math.round(seconds / 60)} min` : `about ${seconds} seconds`;
}

function sourceLabel(source: DepositSource) {
  return `${source.token.toUpperCase()} on ${chain(source.chain).name}`;
}

function Tile({ source, onOpen }: { source: DepositSource; onOpen: () => void }) {
  const detail = source.direct
    ? "Your vault address · instant"
    : source.token === "btc"
      ? `Lands as dollars · ${eta(source.eta_seconds)}`
      : `${eta(source.eta_seconds).replace("about ", "About ")}${Number(source.minimum) > 1 ? ` · min $${Number(source.minimum)}` : ""}`;
  return (
    <button type="button" className="tile" onClick={onOpen} disabled={!source.available}>
      <div className="top">
        <Logo src={tokenLogo(source.token)} badge={source.token === "btc" ? null : chain(source.chain).logo} />
        <Icon name="chevR" size={18} />
      </div>
      <div>
        <b>{sourceLabel(source)}</b>
        <span>{source.available ? detail : "Paused for now"}</span>
      </div>
    </button>
  );
}

function DepositProgress({ deposit }: { deposit: VaultDeposit }) {
  switch (deposit.state) {
    case "waiting":
      return <Notice icon="spin">Watching {chain(deposit.chain).name} for your deposit. You can close this, it will still land.</Notice>;
    case "seen":
    case "bridging":
      return (
        <Notice icon="spin">
          {deposit.received ? `${deposit.received} ${deposit.token.toUpperCase()} arrived.` : "Your deposit arrived."} Moving it into your vault through NEAR
          Intents.
        </Notice>
      );
    case "landed":
      return (
        <Notice tone="good" icon="check">
          {formatUsd(deposit.landed ?? deposit.lands)} landed in your vault{deposit.seconds ? ` in ${deposit.seconds} seconds` : ""}.
        </Notice>
      );
    case "underpaid":
      return <Notice tone="warn">Less than the {deposit.minimum} minimum arrived. It goes back to your NEAR account.</Notice>;
    case "refunded":
      return <Notice tone="warn">This deposit could not be completed, so it went back to your NEAR account.</Notice>;
    default:
      return <Notice tone="bad">This address expired before anything arrived. Get a new one to try again.</Notice>;
  }
}

function DepositDrawer({ source, onClose }: { source: DepositSource; onClose: () => void }) {
  const me = useMe();
  const copy = useCopy();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState(source.token === "btc" ? "0.001" : String(Math.max(100, Number(source.minimum))));
  const [debounced, setDebounced] = useState(amount);
  const [depositId, setDepositId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(amount), 400);
    return () => clearTimeout(timer);
  }, [amount]);

  const estimate = useQuery({
    queryKey: ["deposit-estimate", source.token, source.chain, debounced],
    queryFn: () => walletApi.depositEstimate(source, debounced),
    enabled: !source.direct && Number(debounced) > 0,
    retry: false,
  });
  const create = useMutation({
    mutationFn: () => walletApi.createDeposit(source, amount),
    onSuccess: (deposit) => setDepositId(deposit.deposit_id),
  });
  const deposit = useQuery({
    queryKey: ["deposit", depositId],
    queryFn: () => walletApi.deposit(depositId!),
    enabled: Boolean(depositId),
    initialData: create.data,
    refetchInterval: (query) => (query.state.data && FINAL_DEPOSIT.has(query.state.data.state) ? false : DEPOSIT_POLL_MS),
  });
  const landed = deposit.data?.state === "landed";

  useEffect(() => {
    if (!landed) return;
    queryClient.invalidateQueries({ queryKey: keys.vault });
    queryClient.invalidateQueries({ queryKey: ["activity"] });
    toast(`${formatUsd(deposit.data?.landed ?? deposit.data?.lands ?? "0")} landed in your vault`);
  }, [landed, deposit.data?.landed, deposit.data?.lands, queryClient, toast]);

  const address = source.direct ? (source.address ?? me.data?.near_account ?? null) : (deposit.data?.address ?? null);
  const belowMinimum = Number(amount) > 0 && Number(amount) < Number(source.minimum);

  return (
    <Drawer
      title={`Add from ${chain(source.chain).name}`}
      onClose={onClose}
      footer={
        address || source.direct ? (
          <button type="button" className="btn ink lg" onClick={onClose}>
            {landed ? "Done" : "Close"}
          </button>
        ) : (
          <>
            <button type="button" className="btn line lg" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn ink lg" disabled={!Number(amount) || belowMinimum || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? "Getting address" : "Get deposit address"}
            </button>
          </>
        )
      }
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <Logo src={tokenLogo(source.token)} badge={source.token === "btc" ? null : chain(source.chain).logo} />
        <div>
          <b>{sourceLabel(source)}</b>
          <div className="muted" style={{ fontSize: 12.5 }}>
            {source.direct ? "Already on NEAR, lands in about 2 seconds" : `Arrives as USDC in your vault in ${eta(source.eta_seconds)}`}
          </div>
        </div>
      </div>

      {!source.direct && !address && (
        <>
          <div className="field">
            <label htmlFor="dep-amount">How much will you send? ({source.token.toUpperCase()})</label>
            <input className="inp num" id="dep-amount" inputMode="decimal" value={amount} onChange={(event) => setAmount(cleanAmount(event.target.value))} />
            {belowMinimum && <span className="err">The minimum is {source.minimum}.</span>}
          </div>
          {estimate.data && (
            <dl className="kv card" style={{ margin: 0 }}>
              <div>
                <dt>If you send</dt>
                <dd>
                  {estimate.data.amount} {source.token.toUpperCase()}
                </dd>
              </div>
              <div>
                <dt>Network and bridge fee</dt>
                <dd>{Number(estimate.data.fee) ? formatUsd(estimate.data.fee) : "None"}</dd>
              </div>
              <div>
                <dt>Lands in your vault</dt>
                <dd>{formatUsd(estimate.data.lands)}</dd>
              </div>
            </dl>
          )}
          {estimate.isError && <Notice tone="bad">{estimate.error.message}</Notice>}
          {create.isError && <Notice tone="bad">{create.error.message}</Notice>}
        </>
      )}

      {address && (
        <>
          <QrCode value={address} label={`${sourceLabel(source)} deposit address`} />
          <div className="field">
            <span className="flabel">{source.direct ? "Your vault address" : `Your ${chain(source.chain).name} deposit address`}</span>
            <div className="addr">
              <span>{address}</span>
              <button type="button" className="iconbtn" style={{ width: 30, height: 30 }} onClick={() => copy(address, "Address copied")} aria-label="Copy address">
                <Icon name="copy" size={16} />
              </button>
            </div>
          </div>
          {deposit.data?.memo && (
            <div className="field">
              <span className="flabel">Memo, required</span>
              <div className="addr">
                <span>{deposit.data.memo}</span>
              </div>
            </div>
          )}
          <Notice tone="warn">
            Only send {source.token.toUpperCase()} on {chain(source.chain).name} to this address.
            {Number(source.minimum) > 1 ? ` The minimum is ${source.minimum}.` : ""} Anything else can be lost.
          </Notice>
          {deposit.data && <DepositProgress deposit={deposit.data} />}
          {deposit.data && !FINAL_DEPOSIT.has(deposit.data.state) && (
            <p className="hint" style={{ margin: 0 }}>
              This address is yours until {new Date(deposit.data.reserved_until).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}.
            </p>
          )}
        </>
      )}
    </Drawer>
  );
}

function RequestRow({ request }: { request: PaymentRequest }) {
  const copy = useCopy();
  const queryClient = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => walletApi.cancelRequest(request.request_id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys.requests }),
  });
  return (
    <div className="row" style={{ alignItems: "flex-start" }}>
      <span className="av sm">
        <span className="ph">
          <Icon name="link" size={16} />
        </span>
      </span>
      <div className="t">
        <b>
          {formatUsd(request.amount)} · {request.note}
        </b>
        <span className="mono" style={{ fontSize: 12 }}>
          {request.link.replace(/^https?:\/\//, "")}
        </span>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
        {request.state === "paid" ? (
          <Chip tone="good">Paid {request.paid ? formatUsd(request.paid.landed) : ""}</Chip>
        ) : request.state === "cancelled" ? (
          <Chip>Cancelled</Chip>
        ) : (
          <>
            <button type="button" className="btn line sm" onClick={() => copy(request.link, "Link copied")}>
              <Icon name="copy" size={14} />
              Copy
            </button>
            <button type="button" className="btn ghost sm" disabled={cancel.isPending} onClick={() => cancel.mutate()}>
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function Requests() {
  const requests = useRequests();
  const queryClient = useQueryClient();
  const copy = useCopy();
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [cashOut, setCashOut] = useState(false);
  const create = useMutation({
    mutationFn: () => walletApi.createRequest({ amount, note: note.trim(), cash_out_on_arrival: cashOut }),
    onSuccess: (request) => {
      setAmount("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: keys.requests });
      copy(request.link, "Request link created and copied");
    },
  });
  const list = requests.data?.items ?? [];
  return (
    <section className="card" id="request">
      <div className="card-h">
        <h2>Ask someone to pay you</h2>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: 20, padding: "16px 20px 20px" }}>
        <form
          className="stack"
          style={{ gap: 12 }}
          onSubmit={(event) => {
            event.preventDefault();
            create.mutate();
          }}
        >
          <div className="grid2">
            <div className="field">
              <label htmlFor="rq-amt">Amount (USD)</label>
              <input className="inp num" id="rq-amt" inputMode="decimal" placeholder="1,200.00" value={amount} onChange={(event) => setAmount(cleanAmount(event.target.value))} />
            </div>
            <div className="field">
              <label htmlFor="rq-note">What it&apos;s for</label>
              <input className="inp" id="rq-note" placeholder="Brand film, October" value={note} maxLength={80} onChange={(event) => setNote(event.target.value)} />
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <Toggle checked={cashOut} onChange={setCashOut} label="Cash out to my bank when it arrives" />
            <span style={{ fontSize: 13.5 }}>Cash out to my bank when it arrives</span>
          </div>
          {create.isError && <Notice tone="bad">{create.error.message}</Notice>}
          <button type="submit" className="btn ink" style={{ alignSelf: "flex-start" }} disabled={!Number(amount) || !note.trim() || create.isPending}>
            <Icon name="link" size={17} />
            {create.isPending ? "Creating" : "Create link"}
          </button>
        </form>
        <div>
          {requests.isPending ? (
            <div className="empty">
              <Spinner />
            </div>
          ) : list.length ? (
            <div className="rows" style={{ padding: 0, margin: "0 -12px" }}>
              {list.map((request) => (
                <RequestRow key={request.request_id} request={request} />
              ))}
            </div>
          ) : (
            <Notice>The payer gets a page with your name and the amount, and can pay in USDC or USDT from any chain. You see it in Activity the moment it lands.</Notice>
          )}
        </div>
      </div>
    </section>
  );
}

export function AddMoney() {
  const sources = useDepositSources();
  const [open, setOpen] = useState<DepositSource | null>(null);
  const all = sources.data?.sources ?? [];
  const dollars = all.filter((source) => source.group === "dollars");
  const other = all.filter((source) => source.group !== "dollars");
  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Add money</h1>
          <p>Bring dollars from any wallet or exchange. Everything arrives as USDC in your vault, ready to send.</p>
        </div>
      </div>
      {sources.isPending && <Notice icon="spin">Loading the ways to add money</Notice>}
      {sources.isError && <Notice tone="bad">{sources.error.message}</Notice>}
      {dollars.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="sec-title">Digital dollars</h2>
          <div className="tiles">
            {dollars.map((source) => (
              <Tile key={`${source.token}-${source.chain}`} source={source} onOpen={() => setOpen(source)} />
            ))}
          </div>
        </section>
      )}
      {other.length > 0 && (
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 className="sec-title">Bitcoin and NEAR</h2>
          <div className="tiles">
            {other.map((source) => (
              <Tile key={`${source.token}-${source.chain}`} source={source} onOpen={() => setOpen(source)} />
            ))}
          </div>
        </section>
      )}
      <Requests />
      {open && <DepositDrawer source={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
