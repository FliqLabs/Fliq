"use client";

import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { CopyButton } from "../../components/copy-button";
import { useKybDecision } from "../go-live/kyb-state";

export type BackendKey = { key_id: string; environment: "test" | "live"; masked: string; created_at: string };
type ManagedKey = BackendKey & {
  name: string;
  preview: boolean;
  actor?: "server" | "agent";
  perPayout?: string;
  daily?: string;
  corridors?: string[];
  revoked?: boolean;
};
type KeyDraft = {
  name: string;
  environment: "test" | "live";
  actor: "server" | "agent";
  perPayout: string;
  daily: string;
  corridors: string[];
};
type DialogState =
  | { action: "new" }
  | { action: "roll" | "revoke" | "limits"; key: ManagedKey }
  | { action: "created"; key: ManagedKey; secret: string };
const buttonClass =
  "cursor-pointer rounded-lg border border-[#e6e6e6] bg-white px-3.5 py-2.5 text-[13px] font-semibold transition-colors hover:bg-zinc-50 focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-40";
const primaryClass =
  "cursor-pointer rounded-lg bg-[#111] px-4 py-3 text-[13px] font-semibold text-white transition-colors hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40";
const fieldClass =
  "mt-2 w-full rounded-lg border border-[#e6e6e6] px-3 py-2.5 text-sm font-normal outline-none focus:border-zinc-950 focus:ring-1 focus:ring-zinc-950";
const supportedCorridors = ["USDC → NGN bank", "USDC → KES M-Pesa", "USDT → NGN bank"];

function positiveMinor(value: string) {
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  const minor = BigInt(whole) * BigInt(100) + BigInt(fraction.padEnd(2, "0"));
  return minor > BigInt(0) ? minor : null;
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      aria-labelledby="key-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className="fixed inset-0 m-auto max-h-[calc(100dvh-48px)] w-[520px] max-w-[calc(100%_-_32px)] overflow-y-auto rounded-2xl bg-white p-6 text-zinc-950 shadow-[0_24px_64px_#0004] backdrop:bg-[#0a0a0a6b]"
    >
      <div className="mb-4 flex items-start justify-between gap-4">
        <h2 id="key-dialog-title" className="text-lg font-semibold tracking-tight">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close dialog"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-lg text-lg text-zinc-500 hover:bg-zinc-100"
        >
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}

function KeyForm({
  initial,
  liveAllowed,
  onCancel,
  onSubmit,
  limitsOnly = false,
}: {
  initial: KeyDraft;
  liveAllowed: boolean;
  onCancel: () => void;
  onSubmit: (draft: KeyDraft) => void;
  limitsOnly?: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [error, setError] = useState("");
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const perPayout = positiveMinor(draft.perPayout);
    const daily = positiveMinor(draft.daily);
    if (
      !draft.name.trim() ||
      !perPayout ||
      !daily ||
      perPayout > daily ||
      draft.corridors.length === 0 ||
      (draft.environment === "live" && !liveAllowed)
    ) {
      setError(
        "Enter a name, at least one corridor, and positive caps with the per-payout cap no greater than the daily cap. Live previews require simulated approval.",
      );
      return;
    }
    onSubmit({ ...draft, name: draft.name.trim() });
  }
  return (
    <form onSubmit={submit} className="space-y-[18px]">
      <p className="text-[13px] leading-5 text-[#6b6b6b]">
        A key is a spending limit with a name. In production, the vault contract enforces its caps on chain.
      </p>
      <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
        Sandbox design preview. This creates a local, non-working preview token. It cannot authenticate API
        calls or move money.
      </p>
      {!limitsOnly && (
        <>
          <label className="block text-[13px] font-semibold">
            Name
            <input
              required
              maxLength={80}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              placeholder="Payroll runner"
              className={fieldClass}
            />
            <span className="mt-1.5 block text-xs font-normal text-[#6b6b6b]">
              Shows on receipts and webhooks created with this key.
            </span>
          </label>
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold">Environment</legend>
            <div className="flex flex-wrap gap-2">
              {(["test", "live"] as const).map((environment) => (
                <label key={environment} className="cursor-pointer">
                  <input
                    type="radio"
                    name="key-environment"
                    checked={draft.environment === environment}
                    onChange={() => setDraft({ ...draft, environment })}
                    disabled={environment === "live" && !liveAllowed}
                    className="peer sr-only"
                  />
                  <span className="inline-block rounded-lg border border-zinc-200 px-3 py-2 text-[13px] peer-checked:border-zinc-950 peer-checked:bg-zinc-950 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-40">
                    {environment === "test" ? "Sandbox" : "Live (after KYB)"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-2 text-[13px] font-semibold">Who uses it</legend>
            <div className="flex gap-2">
              {(["server", "agent"] as const).map((actor) => (
                <label key={actor} className="cursor-pointer">
                  <input
                    type="radio"
                    name="key-actor"
                    checked={draft.actor === actor}
                    onChange={() => setDraft({ ...draft, actor })}
                    className="peer sr-only"
                  />
                  <span className="inline-block rounded-lg border border-zinc-200 px-3 py-2 text-[13px] peer-checked:border-zinc-950 peer-checked:bg-zinc-950 peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2">
                    {actor === "server" ? "Your server" : "An AI agent (MCP)"}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        </>
      )}
      <div className="grid grid-cols-2 gap-4">
        <label className="text-[13px] font-semibold">
          Per-payout cap (NGN)
          <input
            required
            inputMode="decimal"
            value={draft.perPayout}
            onChange={(event) => setDraft({ ...draft, perPayout: event.target.value })}
            className={fieldClass}
          />
        </label>
        <label className="text-[13px] font-semibold">
          Daily cap (NGN)
          <input
            required
            inputMode="decimal"
            value={draft.daily}
            onChange={(event) => setDraft({ ...draft, daily: event.target.value })}
            className={fieldClass}
          />
        </label>
      </div>
      <fieldset>
        <legend className="mb-2 text-[13px] font-semibold">Corridors</legend>
        <div className="space-y-2.5">
          {supportedCorridors.map((corridor) => (
            <label key={corridor} className="flex cursor-pointer items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={draft.corridors.includes(corridor)}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    corridors: event.target.checked
                      ? [...draft.corridors, corridor]
                      : draft.corridors.filter((value) => value !== corridor),
                  })
                }
                className="size-4 accent-zinc-950"
              />
              {corridor}
            </label>
          ))}
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-xs leading-5 text-red-700">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-zinc-100 pt-4">
        <button type="button" onClick={onCancel} className={buttonClass}>
          Cancel
        </button>
        <button type="submit" className={primaryClass}>
          {limitsOnly ? "Save preview limits" : "Create key · preview"}
        </button>
      </div>
    </form>
  );
}

export function KeyManagement({
  backendKeys,
  userId,
  initialAction,
  initialEnvironment = "test",
  onDetailChange,
}: {
  backendKeys: BackendKey[];
  userId: string;
  initialAction?: "new";
  initialEnvironment?: "test" | "live";
  onDetailChange: (open: boolean) => void;
}) {
  const client = useQueryClient();
  const { decision } = useKybDecision(userId);
  const queryKey = ["preview-api-keys", userId];
  const { data: previewKeys = [] } = useQuery<ManagedKey[]>({
    queryKey,
    initialData: [],
    queryFn: skipToken,
    enabled: false,
    gcTime: Infinity,
  });
  const createdKey = useQuery<{ key_id: string; key: string }>({
    queryKey: ["created-sandbox-key", userId],
    queryFn: skipToken,
    enabled: false,
  });
  const [dialog, setDialog] = useState<DialogState | null>(initialAction ? { action: initialAction } : null);
  const [detail, setDetail] = useState<ManagedKey | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState("");
  const keys: ManagedKey[] = [
    ...backendKeys.map((key) => ({
      ...key,
      name: key.environment === "test" ? "Default test key" : "Live key",
      preview: false,
    })),
    ...previewKeys,
  ];
  const currentDetail = detail ? (keys.find((key) => key.key_id === detail.key_id) ?? detail) : null;
  const close = () => {
    setDialog(null);
    setConfirmation("");
  };
  const showDetail = (key: ManagedKey | null) => {
    setDetail(key);
    onDetailChange(Boolean(key));
  };
  function savePreview(key: ManagedKey) {
    client.setQueryData<ManagedKey[]>(queryKey, (current = []) => [
      ...current.filter((value) => value.key_id !== key.key_id),
      key,
    ]);
  }
  function createKey(draft: KeyDraft, previous?: ManagedKey) {
    const secret = `preview_only_${draft.environment}_${Array.from(crypto.getRandomValues(new Uint8Array(18)), (value) => value.toString(16).padStart(2, "0")).join("")}`;
    const key: ManagedKey = {
      ...draft,
      key_id: previous?.preview ? previous.key_id : crypto.randomUUID(),
      created_at: new Date().toISOString(),
      masked: `${secret.slice(0, 20)}…${secret.slice(-4)}`,
      preview: true,
    };
    savePreview(key);
    setDialog({ action: "created", key, secret });
  }
  function draftFor(key?: ManagedKey): KeyDraft {
    return {
      name: key?.name ?? "",
      environment: key?.environment ?? initialEnvironment,
      actor: key?.actor ?? "server",
      perPayout: key?.perPayout ?? "",
      daily: key?.daily ?? "",
      corridors: key?.corridors ?? [],
    };
  }
  function openAction(action: "roll" | "revoke" | "limits", key: ManagedKey) {
    setConfirmation("");
    setDialog({ action, key });
  }

  return (
    <>
      {currentDetail ? (
        <section className="space-y-6">
          <button
            type="button"
            onClick={() => showDetail(null)}
            className="cursor-pointer text-xs font-semibold text-zinc-500 hover:text-zinc-950"
          >
            API keys / {currentDetail.name} · Back to keys
          </button>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold">{currentDetail.name}</h1>
              <p className="mt-2 text-[13px] text-zinc-500">
                {currentDetail.actor === "agent"
                  ? "Agent key"
                  : currentDetail.actor === "server"
                    ? "Server key"
                    : "Workspace key"}{" "}
                · {currentDetail.preview ? "Local preview" : "Workspace key"} · {currentDetail.masked}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => openAction("limits", currentDetail)}
                className={buttonClass}
              >
                Change limits
              </button>
              <button
                type="button"
                disabled={currentDetail.revoked}
                onClick={() => openAction("roll", currentDetail)}
                className={buttonClass}
              >
                Roll
              </button>
              <button
                type="button"
                disabled={currentDetail.revoked}
                onClick={() => openAction("revoke", currentDetail)}
                className={`${buttonClass} text-red-600`}
              >
                Revoke
              </button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            {[
              ["Spent today", "—", "Usage API not connected"],
              [
                "Per-payout cap",
                currentDetail.perPayout ? `₦${currentDetail.perPayout}` : "—",
                currentDetail.preview ? "Preview limit" : "Not returned by the API",
              ],
              ["Requests, 7 days", "—", "No request telemetry available"],
              ["Rate limit", "—", "Not returned by the API"],
            ].map(([label, value, hint]) => (
              <div key={label} className="rounded-xl border border-[#e6e6e6] p-4">
                <p className="text-xs text-zinc-500">{label}</p>
                <p className="my-2 text-2xl font-semibold">{value}</p>
                <p className="text-xs text-zinc-500">{hint}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <section className="rounded-xl border border-[#e6e6e6] p-5">
              <h2 className="text-sm font-bold">Requests from this key</h2>
              <div className="mt-4 grid grid-cols-3 border-y border-zinc-100 py-3 text-xs font-semibold text-zinc-500">
                <span>Time</span>
                <span>Call</span>
                <span>Result</span>
              </div>
              <p className="py-12 text-center text-sm text-zinc-500">
                Request history is not available from the current API.
              </p>
            </section>
            <section className="rounded-xl border border-[#e6e6e6] p-5">
              <h2 className="text-sm font-bold">What this key can do</h2>
              <dl className="mt-4 space-y-4 text-[13px]">
                {[
                  ["Environment", currentDetail.environment === "test" ? "Sandbox" : "Live"],
                  ["Corridors", currentDetail.corridors?.join(" · ") || "Not available"],
                  ["Per payout", currentDetail.perPayout ? `₦${currentDetail.perPayout}` : "Not available"],
                  ["Per day", currentDetail.daily ? `₦${currentDetail.daily}` : "Not available"],
                  ["Status", currentDetail.revoked ? "Revoked in preview" : "Active"],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[90px_1fr] gap-3">
                    <dt className="text-zinc-500">{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-5 text-xs leading-5 text-zinc-500">
                Production caps live in the vault contract. Preview changes do not sign a transaction or
                change a real key.
              </p>
              <Link
                href="/docs/agents"
                className="mt-5 inline-block rounded-lg bg-zinc-950 px-4 py-2.5 text-xs font-semibold text-white"
              >
                Open MCP config
              </Link>
            </section>
          </div>
        </section>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm leading-6 text-[#6b6b6b]">
              Sandbox keys start with <code>rt_test_</code>. Live keys start with <code>rt_live_</code> and
              need KYB.
            </p>
            <button
              type="button"
              onClick={() => setDialog({ action: "new" })}
              className="cursor-pointer rounded-lg bg-blue-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-blue-700"
            >
              New key
            </button>
          </div>
          <p className="mb-4 rounded-lg bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-800">
            Key management preview. New, Roll and Revoke simulate the design in this browser session. They do
            not create or change backend credentials.
          </p>
          <section
            aria-label="Your workspace API keys"
            className="overflow-hidden rounded-xl border border-[#e6e6e6]"
          >
            {keys.length === 0 && <p className="p-6 text-sm text-zinc-500">No active workspace keys.</p>}
            {keys.map((key) => (
              <div
                key={key.key_id}
                className={`grid items-center gap-4 border-b border-[#e6e6e6] px-[18px] py-4 last:border-b-0 xl:grid-cols-[230px_minmax(180px,1fr)_auto] ${key.revoked ? "opacity-60" : ""}`}
              >
                <div>
                  <button
                    type="button"
                    onClick={() => showDetail(key)}
                    className="cursor-pointer text-left text-sm font-bold hover:underline"
                  >
                    {key.name}
                  </button>
                  <p className="mt-1.5 text-xs text-[#6b6b6b]">
                    Made{" "}
                    {new Date(key.created_at).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      timeZone: "Africa/Lagos",
                    })}
                    {key.preview ? " · Local preview" : ""}
                  </p>
                </div>
                <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-[#f6f6f6] px-3 py-2.5">
                  <code className="truncate text-[13px]">{key.masked}</code>
                  {createdKey.data?.key_id === key.key_id ? (
                    <CopyButton text={createdKey.data.key} />
                  ) : (
                    <span className="text-[10px] text-zinc-500">Shown once</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className={`rounded-md px-2.5 py-1 text-xs font-bold ${key.revoked ? "bg-red-50 text-red-700" : key.environment === "test" ? "bg-[#fff3d6] text-[#8a5a00]" : "bg-emerald-50 text-emerald-700"}`}
                  >
                    {key.revoked
                      ? "Revoked"
                      : key.environment === "test"
                        ? "Sandbox"
                        : key.preview
                          ? "Live preview"
                          : "Live"}
                  </span>
                  <button
                    type="button"
                    disabled={key.revoked}
                    onClick={() => openAction("roll", key)}
                    className={buttonClass}
                  >
                    Roll
                  </button>
                  <button
                    type="button"
                    disabled={key.revoked}
                    onClick={() => openAction("revoke", key)}
                    className={`${buttonClass} text-red-600`}
                  >
                    Revoke
                  </button>
                </div>
              </div>
            ))}
            {!keys.some((key) => key.environment === "live" && !key.revoked) && (
              <div className="flex items-center justify-between gap-4 border-t border-zinc-100 px-[18px] py-4">
                <div>
                  <h2 className="text-sm font-bold">Live key</h2>
                  <p className="mt-1.5 text-xs text-zinc-500">
                    {decision.status === "approved"
                      ? "Simulated approval complete · preview available"
                      : "Not yet · Create after KYB"}
                  </p>
                </div>
                <Link
                  href="/dashboard/go-live"
                  className="rounded-lg border border-zinc-200 px-3 py-2 text-xs font-semibold"
                >
                  {decision.status === "approved" ? "View approval" : "Go live"}
                </Link>
              </div>
            )}
          </section>
        </>
      )}
      {notice && (
        <p role="status" className="mt-4 rounded-lg bg-zinc-50 p-3 text-xs text-zinc-600">
          {notice}
        </p>
      )}
      {dialog && (
        <Modal
          title={
            dialog.action === "new"
              ? "New API key"
              : dialog.action === "created"
                ? `${dialog.key.name} is ready`
                : dialog.action === "limits"
                  ? `Change ${dialog.key.name} limits`
                  : `${dialog.action === "roll" ? "Roll" : "Revoke"} ${dialog.key.name}?`
          }
          onClose={close}
        >
          {(dialog.action === "new" || dialog.action === "limits") && (
            <KeyForm
              initial={draftFor(dialog.action === "limits" ? dialog.key : undefined)}
              liveAllowed={decision.status === "approved"}
              onCancel={close}
              limitsOnly={dialog.action === "limits"}
              onSubmit={(draft) => {
                if (dialog.action === "limits" && dialog.key.preview) {
                  savePreview({ ...dialog.key, ...draft });
                  close();
                } else if (dialog.action === "limits") {
                  const preview = {
                    ...dialog.key,
                    ...draft,
                    key_id: crypto.randomUUID(),
                    name: `${dialog.key.name} (limits preview)`,
                    preview: true,
                  };
                  savePreview(preview);
                  showDetail(preview);
                  setNotice(
                    "Limits saved to a local preview. No transaction was signed and the workspace key is unchanged.",
                  );
                  close();
                } else createKey(draft);
              }}
            />
          )}
          {dialog.action === "created" && (
            <div className="space-y-[18px]">
              <p className="text-[13px] leading-5 text-[#6b6b6b]">
                Copy the secret now. It is shown once; after you close this dialog only the prefix stays
                visible.
              </p>
              <p className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
                Non-working preview token · not a backend API credential.
              </p>
              <code className="block break-all rounded-[10px] bg-[#0f0f0f] px-3.5 py-4 text-[13px] text-[#e5e5e5]">
                {dialog.secret}
              </code>
              <CopyButton text={dialog.secret} />
              <dl className="grid grid-cols-3 gap-3 rounded-xl border border-zinc-200 p-4 text-xs">
                {[
                  ["Per payout", dialog.key.perPayout ? `₦${dialog.key.perPayout}` : "Not configured"],
                  ["Daily", dialog.key.daily ? `₦${dialog.key.daily}` : "Not configured"],
                  [
                    "Environment",
                    dialog.key.environment === "test" ? "Sandbox" : "Live preview",
                  ],
                ].map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-zinc-500">{label}</dt>
                    <dd className="mt-1 font-semibold">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-xs leading-5 text-zinc-500">
                Production secrets belong in your secrets manager, never in the repository.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Link href="/dashboard/webhooks" onClick={close} className={buttonClass}>
                  Set up webhooks next
                </Link>
                <button type="button" onClick={close} className={primaryClass}>
                  I have saved it
                </button>
              </div>
            </div>
          )}
          {dialog.action === "roll" && (
            <div className="space-y-5">
              <p className="text-[13px] leading-6 text-zinc-500">
                In production, a new secret replaces this one with a 10-minute overlap so your servers can
                switch without a gap.
              </p>
              <ol className="space-y-3 text-sm">
                {[
                  "New secret shown once, same name and caps",
                  `Old secret: ${dialog.key.masked}`,
                  "Webhook signing secret is not affected",
                ].map((line, index) => (
                  <li key={line} className="flex gap-3">
                    <span className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs">
                      {index + 1}
                    </span>
                    {line}
                  </li>
                ))}
              </ol>
              <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                This only rolls a local preview token. Your backend key remains unchanged.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className={buttonClass}>
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => createKey(draftFor(dialog.key), dialog.key)}
                  className={primaryClass}
                >
                  Roll key · preview
                </button>
              </div>
            </div>
          )}
          {dialog.action === "revoke" && (
            <div className="space-y-5">
              <p className="text-[13px] leading-6 text-zinc-500">
                In production, revocation stops new requests from this key. Previously completed payouts
                remain paid.
              </p>
              <div className="rounded-xl border border-zinc-200 p-4 text-sm">
                <strong>{dialog.key.name}</strong>
                <code className="mt-2 block text-xs text-zinc-500">{dialog.key.masked}</code>
              </div>
              <label className="block text-[13px] font-semibold">
                Type the key name to confirm
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder={dialog.key.name}
                  className={fieldClass}
                />
              </label>
              <p className="rounded-lg bg-amber-50 p-3 text-xs leading-5 text-amber-800">
                Preview only. This does not revoke or disable your real backend key.
              </p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={close} className={buttonClass}>
                  Keep it
                </button>
                <button
                  type="button"
                  disabled={confirmation !== dialog.key.name}
                  onClick={() => {
                    if (dialog.key.preview) savePreview({ ...dialog.key, revoked: true });
                    setNotice(
                      dialog.key.preview
                        ? `${dialog.key.name} was revoked in this local preview.`
                        : "Revocation preview completed. The real workspace key remains unchanged.",
                    );
                    close();
                  }}
                  className="cursor-pointer rounded-lg bg-red-600 px-4 py-3 text-[13px] font-semibold text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Revoke key · preview
                </button>
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
