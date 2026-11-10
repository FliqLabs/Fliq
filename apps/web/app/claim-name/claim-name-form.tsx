"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ApiError, fliqApi, type User } from "../lib/fliq-api";
import {
  createNearKey,
  loadNearKey,
  recoverNearKey,
  saveNearKey,
  type NewNearKey,
  type StoredNearKey,
} from "./near-key";

type Availability = { name: string; available: boolean; reason: string | null };
type ClaimPending = { status: "pending"; near_account: string };
type PreparedClaim = { name: string; accountName: string; key: NewNearKey };

function isPendingClaim(result: User | ClaimPending): result is ClaimPending {
  return "status" in result && result.status === "pending";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function sendClaim(key: StoredNearKey): Promise<User | ClaimPending> {
  let result: User | ClaimPending;
  for (let attempt = 0; attempt < 5; attempt++) {
    result = await fliqApi<User | ClaimPending>("me/name", {
      method: "POST",
      headers: { "Idempotency-Key": key.claim!.idempotencyKey },
      body: JSON.stringify({ name: key.claim!.name, public_key: key.publicKey }),
    });
    if (!isPendingClaim(result)) return result;
    if (attempt < 4) await wait(2_000);
  }
  return result!;
}

async function verifyKeyOwnership(accountId: string, publicKey: string): Promise<boolean> {
  const response = await fetch("/api/near-key/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: accountId, public_key: publicKey }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not verify this NEAR key.");
  return result.matches === true;
}

async function prepareClaim(name: string, accountName: string): Promise<PreparedClaim> {
  const key = await createNearKey();
  return { name, accountName, key };
}

export function ClaimNameForm() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [prepared, setPrepared] = useState<PreparedClaim | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [showRecovery, setShowRecovery] = useState(false);
  const [localError, setLocalError] = useState("");
  const [saving, setSaving] = useState(false);

  const label = name.trim().toLowerCase();
  const valid = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/.test(label) && !label.includes("--");
  const account = useQuery({ queryKey: ["me"], queryFn: () => fliqApi<User>("me") });
  const savedKey = useQuery({
    queryKey: ["near-key", account.data?.user_id],
    queryFn: () => loadNearKey(account.data!.user_id),
    enabled: account.isSuccess,
    retry: false,
  });
  const ownership = useQuery({
    queryKey: ["near-key-ownership", account.data?.near_account, savedKey.data?.publicKey],
    queryFn: () => verifyKeyOwnership(account.data!.near_account!, savedKey.data!.publicKey),
    enabled: Boolean(account.data?.near_account && savedKey.data),
    staleTime: 5 * 60_000,
    retry: false,
  });
  const availability = useQuery({
    queryKey: ["name", label],
    queryFn: () => fliqApi<Availability>(`names/${encodeURIComponent(label)}`),
    enabled: valid && account.isSuccess && !account.data.near_account && !savedKey.data?.claim,
  });

  const prepare = useMutation({
    mutationFn: ({ name, accountName }: { name: string; accountName: string }) =>
      prepareClaim(name, accountName),
    onSuccess: (nextClaim) => {
      setPrepared(nextClaim);
      setLocalError("");
    },
  });
  const claim = useMutation({
    mutationFn: sendClaim,
    onSuccess: async (result, key) => {
      if (isPendingClaim(result)) return;
      await saveNearKey({ ...key, claim: undefined });
      queryClient.setQueryData(["me"], result);
      router.replace("/wallet");
    },
  });
  const restore = useMutation({
    mutationFn: async () => {
      const key = await recoverNearKey(recoveryCode);
      if (account.data?.near_account) {
        const matches = await verifyKeyOwnership(account.data.near_account, key.publicKey);
        if (!matches) throw new Error("This recovery code does not control your NEAR account.");
      }
      const record: StoredNearKey = { ...key, userId: account.data!.user_id };
      await saveNearKey(record);
      return record;
    },
    onSuccess: async () => {
      setRecoveryCode("");
      setShowRecovery(false);
      await queryClient.invalidateQueries({ queryKey: ["near-key", account.data?.user_id] });
      await queryClient.invalidateQueries({ queryKey: ["near-key-ownership"] });
    },
  });

  async function startClaim(key: StoredNearKey) {
    setSaving(true);
    setLocalError("");
    try {
      await saveNearKey(key);
      await queryClient.invalidateQueries({ queryKey: ["near-key", key.userId] });
      setPrepared(null);
      setConfirmation("");
      claim.mutate(key);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not save the NEAR key.");
    } finally {
      setSaving(false);
    }
  }

  async function chooseAnotherName(key: StoredNearKey) {
    setSaving(true);
    setLocalError("");
    try {
      const latestAccount = await fliqApi<User>("me");
      queryClient.setQueryData(["me"], latestAccount);
      if (latestAccount.near_account) return;
      await saveNearKey({ ...key, claim: undefined });
      await queryClient.invalidateQueries({ queryKey: ["near-key", key.userId] });
      setName("");
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : "Could not reset the claim.");
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!valid || !availability.data?.available || !account.data || saving) return;
    if (!savedKey.data) {
      prepare.mutate({ name: label, accountName: availability.data.name });
      return;
    }
    void startClaim({
      ...savedKey.data,
      claim: { name: label, accountName: availability.data.name, idempotencyKey: crypto.randomUUID() },
    });
  }

  function confirmBackup() {
    if (!prepared || !account.data) return;
    if (confirmation.trim() !== prepared.key.recoveryCode) {
      setLocalError("Enter the recovery code exactly as shown to confirm you saved it.");
      return;
    }
    void startClaim({
      userId: account.data.user_id,
      publicKey: prepared.key.publicKey,
      privateKey: prepared.key.privateKey,
      claim: {
        name: prepared.name,
        accountName: prepared.accountName,
        idempotencyKey: crypto.randomUUID(),
      },
    });
  }

  if (account.isPending || (account.isSuccess && savedKey.isPending)) {
    return <p className="text-sm text-zinc-500">Checking your account…</p>;
  }
  if (account.error instanceof ApiError && account.error.status === 401) {
    return (
      <p className="text-sm">
        Sign in first.{" "}
        <Link href="/sign-in" className="font-semibold underline">
          Go to sign in
        </Link>
      </p>
    );
  }
  if (account.isError || savedKey.isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {account.error?.message ?? savedKey.error?.message}
      </p>
    );
  }

  if (prepared) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Save your recovery code</h1>
        <p className="text-sm text-zinc-600">
          This code restores the NEAR key for {prepared.accountName} if you change devices or clear browser
          data. Save it in a password manager or write it down. Anyone with this code can control your NEAR
          account.
        </p>
        <code className="break-all rounded-lg bg-zinc-100 p-4 text-sm" aria-label="Recovery code">
          {prepared.key.recoveryCode}
        </code>
        <button
          type="button"
          onClick={() =>
            void navigator.clipboard
              .writeText(prepared.key.recoveryCode)
              .catch(() => setLocalError("Could not copy the code. Select it and copy it manually."))
          }
          className="w-fit text-sm font-semibold underline"
        >
          Copy recovery code
        </button>
        <label htmlFor="confirm-recovery" className="text-sm font-medium">
          Paste the saved code to confirm your backup
        </label>
        <input
          id="confirm-recovery"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="min-h-12 rounded-lg border border-zinc-200 px-4 text-sm outline-none focus:border-zinc-600"
        />
        <button
          type="button"
          disabled={saving}
          onClick={confirmBackup}
          className="min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {saving ? "Saving key…" : "Save key and claim name"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPrepared(null);
            setConfirmation("");
          }}
          className="text-sm underline"
        >
          Choose another name
        </button>
        {localError && (
          <p role="alert" className="text-sm text-red-600">
            {localError}
          </p>
        )}
      </div>
    );
  }

  const pendingKey = savedKey.data;
  if (pendingKey?.claim && !account.data.near_account) {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Creating your NEAR account</h1>
        <p className="text-sm text-zinc-600">
          Your claim for {pendingKey.claim.accountName} is still pending. This device has the signing key.
          Keep your recovery code safe.
        </p>
        <button
          type="button"
          disabled={claim.isPending}
          onClick={() => claim.mutate(pendingKey)}
          className="min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {claim.isPending ? "Checking account…" : "Continue claim"}
        </button>
        {claim.isError && (
          <p role="alert" className="text-sm text-red-600">
            {claim.error.message}
          </p>
        )}
        {claim.error instanceof ApiError && claim.error.status === 409 && (
          <button
            type="button"
            disabled={saving}
            onClick={() => void chooseAnotherName(pendingKey)}
            className="text-left text-sm font-semibold underline"
          >
            Choose another name
          </button>
        )}
        {localError && (
          <p role="alert" className="text-sm text-red-600">
            {localError}
          </p>
        )}
        {claim.data && isPendingClaim(claim.data) && (
          <p role="status" className="text-sm text-zinc-600">
            The network is still creating your account. Try again shortly.
          </p>
        )}
      </div>
    );
  }

  if (account.data.near_account && savedKey.data && ownership.isPending) {
    return <p className="text-sm text-zinc-500">Checking your NEAR key…</p>;
  }

  if (account.data.near_account && savedKey.data && ownership.isError) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {ownership.error.message}
      </p>
    );
  }

  if (account.data.near_account && savedKey.data && ownership.data) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Your NEAR key is on this device</h1>
        <p className="text-sm text-zinc-600">{account.data.near_account}</p>
        <Link href="/wallet" className="text-sm font-semibold underline">
          Continue to your wallet
        </Link>
      </div>
    );
  }

  if (account.data.near_account && !showRecovery) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-3xl font-bold tracking-tight">Your name is {account.data.near_account}</h1>
        <p className="text-sm text-zinc-600">
          A NEAR signing key for this account is not available in this browser.
        </p>
        <button
          type="button"
          onClick={() => setShowRecovery(true)}
          className="text-left text-sm font-semibold underline"
        >
          Restore with recovery code
        </button>
        <Link href="/wallet" className="text-sm underline">
          Continue to your wallet
        </Link>
      </div>
    );
  }

  if (showRecovery) {
    return (
      <form
        onSubmit={(event) => {
          event.preventDefault();
          restore.mutate();
        }}
        className="flex flex-col gap-4"
      >
        <h1 className="text-3xl font-bold tracking-tight">Restore your NEAR key</h1>
        <p className="text-sm text-zinc-600">Enter the code you saved when you claimed your name.</p>
        <label htmlFor="recovery-code" className="text-sm font-medium">
          Recovery code
        </label>
        <input
          id="recovery-code"
          required
          value={recoveryCode}
          onChange={(event) => setRecoveryCode(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          className="min-h-12 rounded-lg border border-zinc-200 px-4 text-sm outline-none focus:border-zinc-600"
        />
        <button
          type="submit"
          disabled={restore.isPending}
          className="min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {restore.isPending ? "Restoring key…" : "Restore key"}
        </button>
        <button type="button" onClick={() => setShowRecovery(false)} className="text-sm underline">
          Back
        </button>
        {restore.isError && (
          <p role="alert" className="text-sm text-red-600">
            {restore.error.message}
          </p>
        )}
      </form>
    );
  }

  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Claim your name</h1>
      <p className="mt-2 text-sm text-zinc-500">
        Choose your fliq name. You will save a recovery code before we create your NEAR account.
      </p>
      <form onSubmit={submit} className="mt-7 flex flex-col">
        <label htmlFor="fliq-name" className="text-xs font-medium">
          Your fliq name
        </label>
        <input
          id="fliq-name"
          autoComplete="username"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="yourname"
          className="mt-2 min-h-12 rounded-lg border border-zinc-200 px-4 text-sm outline-none focus:border-zinc-600"
        />
        {availability.data?.name && <p className="mt-2 text-xs text-zinc-500">{availability.data.name}</p>}
        {name && !valid && (
          <p className="mt-2 text-xs text-zinc-500">
            Use 3–33 lowercase letters, numbers, or single hyphens.
          </p>
        )}
        {availability.isSuccess && (
          <p className={`mt-2 text-xs ${availability.data.available ? "text-emerald-700" : "text-red-600"}`}>
            {availability.data.available
              ? "Name available"
              : `Name ${availability.data.reason ?? "unavailable"}`}
          </p>
        )}
        {availability.isError && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {availability.error.message}
          </p>
        )}
        {savedKey.data && (
          <p className="mt-3 text-xs text-zinc-500">Your saved NEAR key on this device will be used.</p>
        )}
        <button
          type="submit"
          disabled={!availability.data?.available || prepare.isPending || saving || claim.isPending}
          className="mt-6 min-h-12 rounded-lg bg-zinc-950 px-5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {prepare.isPending ? "Creating key…" : saving ? "Saving key…" : "Continue"}
        </button>
        {prepare.isError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {prepare.error.message}
          </p>
        )}
        {localError && (
          <p role="alert" className="mt-3 text-sm text-red-600">
            {localError}
          </p>
        )}
      </form>
      {!savedKey.data && (
        <button
          type="button"
          onClick={() => setShowRecovery(true)}
          className="mt-4 text-sm font-semibold underline"
        >
          I already have a recovery code
        </button>
      )}
    </>
  );
}
