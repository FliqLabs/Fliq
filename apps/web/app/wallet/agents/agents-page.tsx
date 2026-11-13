"use client";

/* eslint-disable @next/next/no-img-element -- agent logo is a tiny fixed image */

import Link from "next/link";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Icon } from "../../components/app/icons";
import { BigMoney, Chip, ConfirmModal, Modal, Notice, Spinner, Toggle, useToast } from "../../components/app/ui";
import { hasDeviceKey, signAndRelay } from "../../lib/device-signer";
import { formatMoney, toCurrency } from "../../lib/money";
import { stepAction } from "../../lib/near-delegate";
import { walletApi, type Agent, type AgentChange, type ActivityItem, type User } from "../../lib/wallet-api";
import { keys, useActivity, useAgents, useMe } from "../../lib/wallet-queries";
import { ActivityRow, ReceiptDrawer } from "../activity-ui";

type Currency = "NGN" | "KES";

/** Each change comes back as vault calls this browser signs, in order. The relayer creates accounts itself. */
async function applyChange(user: User, change: AgentChange) {
  for (const step of change.steps.filter((item) => item.kind === "function_call")) {
    await signAndRelay(user, (signer) => stepAction(signer, step));
  }
  return change.agent;
}

function AgentLogo({ agent }: { agent: Agent }) {
  return agent.name.toLowerCase().includes("claude") ? (
    <img src="/app/claude.webp" alt="" />
  ) : (
    <span className="ph">
      <Icon name="bot" size={22} />
    </span>
  );
}

function LimitsForm({
  initial,
  submitLabel,
  busy,
  error,
  withIdentity,
  onSubmit,
  onClose,
  title,
}: {
  initial: { name: string; publicKey: string; daily: string; perPayout: string; currency: Currency; savedOnly: boolean };
  submitLabel: string;
  busy: boolean;
  error?: string | null;
  withIdentity?: boolean;
  onSubmit: (values: typeof initial) => void;
  onClose: () => void;
  title: string;
}) {
  const [values, setValues] = useState(initial);
  const set = (patch: Partial<typeof initial>) => setValues((current) => ({ ...current, ...patch }));
  const valid =
    Number(values.daily) > 0 &&
    Number(values.perPayout) > 0 &&
    Number(values.perPayout) <= Number(values.daily) &&
    (!withIdentity || (values.name.trim() && /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(values.publicKey.trim())));
  return (
    <Modal onClose={onClose} locked={busy} label={title}>
      <form
        className="modal-b"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid) onSubmit(values);
        }}
      >
        <h2>{title}</h2>
        <p>Your vault checks these on every request. Saving signs the change with this browser&apos;s key.</p>
        {withIdentity && (
          <>
            <div className="field">
              <label htmlFor="agent-name">Name</label>
              <input className="inp" id="agent-name" value={values.name} placeholder="Claude" onChange={(event) => set({ name: event.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="agent-key">Agent&apos;s public key</label>
              <input
                className="inp mono"
                id="agent-key"
                value={values.publicKey}
                placeholder="ed25519:…"
                onChange={(event) => set({ publicKey: event.target.value })}
              />
              <span className="hint">Your agent shows this when you add the fliq MCP server or SDK.</span>
            </div>
          </>
        )}
        <div className="grid2">
          <div className="field">
            <label htmlFor="lim-per">Per payout</label>
            <input className="inp num" id="lim-per" inputMode="numeric" value={values.perPayout} onChange={(event) => set({ perPayout: event.target.value.replace(/\D/g, "") })} />
          </div>
          <div className="field">
            <label htmlFor="lim-day">Per day</label>
            <input className="inp num" id="lim-day" inputMode="numeric" value={values.daily} onChange={(event) => set({ daily: event.target.value.replace(/\D/g, "") })} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="lim-cur">Pays in</label>
          <select className="inp" id="lim-cur" value={values.currency} onChange={(event) => set({ currency: event.target.value as Currency })}>
            <option value="NGN">Nigerian naira (NGN)</option>
            <option value="KES">Kenyan shilling (KES)</option>
          </select>
        </div>
        {Number(values.perPayout) > Number(values.daily) && <span className="err">One payout cannot be more than the daily limit.</span>}
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Toggle checked={values.savedOnly} onChange={(savedOnly) => set({ savedOnly })} label="Only pay saved recipients" />
          <span>Only pay saved recipients</span>
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
        <div className="row2">
          <button type="button" className="btn line lg" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn ink lg" disabled={!valid || busy}>
            {busy ? <Spinner /> : submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function limitsOf(values: { daily: string; perPayout: string; currency: Currency; savedOnly: boolean }) {
  return {
    daily_cap: { amount: values.daily, currency: values.currency },
    per_payout_cap: { amount: values.perPayout, currency: values.currency },
    currencies: [values.currency],
    saved_accounts_only: values.savedOnly,
  };
}

function AgentCard({ agent, requests, canSign }: { agent: Agent; requests: ActivityItem[]; canSign: boolean }) {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [open, setOpen] = useState<ActivityItem | null>(null);
  const currency = toCurrency(agent.daily_cap.currency);
  const spent = Number(agent.spent_today.amount);
  const cap = Number(agent.daily_cap.amount);
  const pending = agent.state === "pending";

  const update = useMutation({
    mutationFn: async (values: Parameters<typeof limitsOf>[0]) =>
      applyChange(me.data!, await walletApi.updateAgent(agent.agent_id, limitsOf(values))),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.agents });
      setEditing(false);
      toast(`${agent.name}'s limits saved to your vault`);
    },
  });
  const revoke = useMutation({
    mutationFn: async () => applyChange(me.data!, await walletApi.revokeAgent(agent.agent_id)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.agents });
      setRevoking(false);
      toast(`${agent.name}'s key revoked`);
    },
  });

  return (
    <section className="card agent">
      <div>
        <div className="who">
          <AgentLogo agent={agent} />
          <div style={{ minWidth: 0 }}>
            <b>{agent.name}</b>
            <div className="muted" style={{ fontSize: 12.5 }}>
              Connected {new Date(agent.connected_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · key expires{" "}
              {new Date(agent.expires_at).toLocaleDateString("en-GB", { month: "short", year: "numeric" })}
            </div>
          </div>
          <span style={{ marginLeft: "auto" }}>
            <Chip tone={pending ? "sand" : "good"} dot>
              {pending ? "Waiting for your approval" : "Active"}
            </Chip>
          </span>
        </div>
        <div className="spent">
          <div className="muted" style={{ fontSize: 13, marginBottom: 6 }}>
            Spent today
          </div>
          <div className="big">
            <BigMoney value={spent} currency={currency} />
          </div>
          <div className="muted num" style={{ marginTop: 6, fontSize: 13 }}>
            of {formatMoney(cap, currency)} a day
          </div>
        </div>
        <div className="bar">
          <i style={{ width: `${cap ? Math.min(100, (spent / cap) * 100) : 0}%` }} />
        </div>
        <div className="limits">
          <div>
            <span>Per payout</span>
            <b>{formatMoney(agent.per_payout_cap.amount, toCurrency(agent.per_payout_cap.currency))}</b>
          </div>
          <div>
            <span>Pays</span>
            <b>{agent.currencies.join(", ")} only</b>
          </div>
          <div>
            <span>Recipients</span>
            <b>{agent.saved_accounts_only ? "Saved only" : "Anyone"}</b>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button type="button" className="btn line sm" disabled={!canSign} onClick={() => setEditing(true)}>
            {pending ? "Approve limits" : "Change limits"}
          </button>
          <button type="button" className="btn danger sm" disabled={!canSign} onClick={() => setRevoking(true)}>
            Revoke key
          </button>
        </div>
      </div>
      <div>
        <h2 className="sec-title">Recent requests</h2>
        <div className="rows" style={{ padding: "8px 0 0", margin: "0 -12px" }}>
          {requests.length ? requests.map((item) => <ActivityRow key={item.activity_id} item={item} onOpen={setOpen} />) : <div className="empty">No requests yet.</div>}
        </div>
        <div className="muted mono" style={{ marginTop: 12, fontSize: 11.5, overflowWrap: "anywhere" }}>
          {agent.public_key}
        </div>
      </div>
      {editing && (
        <LimitsForm
          title={`${agent.name}'s limits`}
          submitLabel="Save to vault"
          busy={update.isPending}
          error={update.error?.message}
          initial={{
            name: agent.name,
            publicKey: agent.public_key,
            daily: agent.daily_cap.amount,
            perPayout: agent.per_payout_cap.amount,
            currency: (agent.daily_cap.currency === "KES" ? "KES" : "NGN") as Currency,
            savedOnly: agent.saved_accounts_only,
          }}
          onSubmit={(values) => update.mutate(values)}
          onClose={() => setEditing(false)}
        />
      )}
      {revoking && (
        <ConfirmModal
          title={`Revoke ${agent.name}'s key?`}
          text={`${agent.name} will not be able to ask your vault for payments. Its history stays in Activity.`}
          cta="Revoke key"
          danger
          busy={revoke.isPending}
          error={revoke.error?.message}
          onConfirm={() => revoke.mutate()}
          onClose={() => setRevoking(false)}
        />
      )}
      {open && <ReceiptDrawer item={open} onClose={() => setOpen(null)} />}
    </section>
  );
}

export function AgentsPage() {
  const me = useMe();
  const agents = useAgents();
  const activity = useActivity("agents");
  const toast = useToast();
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const device = useQuery({
    queryKey: ["device-key", me.data?.user_id],
    queryFn: () => hasDeviceKey(me.data!),
    enabled: me.isSuccess,
  });
  const canSign = device.data === true;
  const connect = useMutation({
    mutationFn: async (values: { name: string; publicKey: string; daily: string; perPayout: string; currency: Currency; savedOnly: boolean }) =>
      applyChange(
        me.data!,
        await walletApi.connectAgent({ name: values.name.trim(), public_key: values.publicKey.trim(), ...limitsOf(values) }),
      ),
    onSuccess: (agent) => {
      queryClient.invalidateQueries({ queryKey: keys.agents });
      setConnecting(false);
      toast(`${agent.name} is connected`);
    },
  });
  const list = (agents.data?.agents ?? []).filter((agent) => agent.state !== "revoked");

  return (
    <div className="page">
      <div className="head">
        <div>
          <h1>Agents</h1>
          <p>Agents can ask your vault to pay. They never hold a key that can move your money on their own.</p>
        </div>
        <div className="acts">
          <button type="button" className="btn ink" disabled={!canSign} onClick={() => setConnecting(true)}>
            <Icon name="plus" size={17} />
            Connect an agent
          </button>
        </div>
      </div>
      <div className="enforced">
        <Icon name="shield" size={18} />
        <span>
          Limits are checked by your vault contract{me.data?.vault ? (
            <>
              , <b>{me.data.vault}</b>,
            </>
          ) : null}{" "}
          on every request. fliq&apos;s servers cannot raise them.
        </span>
      </div>
      {device.isSuccess && !canSign && (
        <Notice tone="warn" icon="key">
          This browser cannot sign changes to your vault yet.{" "}
          <Link className="link" href="/wallet/account#device">
            Restore your key with your recovery code
          </Link>{" "}
          to change limits or connect an agent here.
        </Notice>
      )}
      {agents.isPending && (
        <div className="empty">
          <Spinner />
        </div>
      )}
      {agents.isError && <Notice tone="bad">{agents.error.message}</Notice>}
      {agents.isSuccess && list.length === 0 && (
        <section className="card pad">
          <p className="muted" style={{ margin: 0 }}>
            No agents yet. Connect Claude, ChatGPT or your own agent with the fliq MCP server, and set what it may spend.
          </p>
        </section>
      )}
      {list.map((agent) => (
        <AgentCard
          key={agent.agent_id}
          agent={agent}
          canSign={canSign}
          requests={(activity.data?.items ?? []).filter((item) => item.agent?.agent_id === agent.agent_id).slice(0, 3)}
        />
      ))}
      {connecting && (
        <LimitsForm
          title="Connect an agent"
          submitLabel="Connect and sign"
          withIdentity
          busy={connect.isPending}
          error={connect.error?.message}
          initial={{ name: "", publicKey: "", daily: "150000", perPayout: "50000", currency: "NGN", savedOnly: true }}
          onSubmit={(values) => connect.mutate(values)}
          onClose={() => setConnecting(false)}
        />
      )}
    </div>
  );
}
