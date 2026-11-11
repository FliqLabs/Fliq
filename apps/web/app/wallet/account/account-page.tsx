"use client";

/* eslint-disable @next/next/no-img-element -- flag is a tiny fixed image */

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { recoverNearKey, saveNearKey } from "../../claim-name/near-key";
import { Icon } from "../../components/app/icons";
import { ThemeSwitch } from "../../components/app/theme";
import { Avatar, Chip, Notice, PageState, Spinner, Toggle, useCopy, useToast } from "../../components/app/ui";
import { fliqApi } from "../../lib/fliq-api";
import { hasDeviceKey } from "../../lib/device-signer";
import { CURRENCIES } from "../../lib/money";
import { walletApi, type NotificationSettings } from "../../lib/wallet-api";
import { keys, useMe, useNotificationSettings, usePasskeys, useSessions } from "../../lib/wallet-queries";
import { when } from "../activity-ui";

const NOTIFICATIONS: { key: keyof Omit<NotificationSettings, "rate_alert">; title: string; detail: string }[] = [
  { key: "received", title: "Money lands", detail: "A deposit, a paid request or a fliq transfer" },
  { key: "payout_paid", title: "A payout is paid", detail: "With the bank reference" },
  { key: "payout_refunded", title: "A payout comes back", detail: "When a provider cannot pay and your vault is refunded" },
  { key: "agent_paid", title: "An agent pays someone", detail: "Each payout an agent makes" },
  { key: "agent_refused", title: "Your vault refuses an agent", detail: "When a request goes over its limits" },
  { key: "cap_almost_reached", title: "An agent nears its daily limit", detail: "At 80% of the cap" },
  { key: "weekly_summary", title: "Weekly summary", detail: "Every Monday morning" },
];

async function keyMatchesAccount(accountId: string, publicKey: string) {
  const response = await fetch("/api/near-key/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ account_id: accountId, public_key: publicKey }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Could not check this key on NEAR.");
  return result.matches === true;
}

function Profile() {
  const me = useMe();
  const copy = useCopy();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [occupation, setOccupation] = useState("");
  const save = useMutation({
    mutationFn: () => walletApi.updateMe({ display_name: name.trim(), occupation: occupation.trim() || null }),
    onSuccess: (user) => {
      queryClient.setQueryData(keys.me, user);
      setEditing(false);
      toast("Name saved");
    },
  });
  if (!me.data) return null;
  const display = me.data.display_name || me.data.near_account || "You";
  return (
    <section className="card set">
      <div>
        <Avatar name={display} photo={me.data.photo_url} />
        <div className="t">
          {editing ? (
            <div className="grid2">
              <input className="inp" id="display-name" aria-label="Display name" placeholder="Your name" value={name} maxLength={60} onChange={(event) => setName(event.target.value)} autoFocus />
              <input className="inp" id="occupation" aria-label="What you do" placeholder="What you do" value={occupation} maxLength={60} onChange={(event) => setOccupation(event.target.value)} />
            </div>
          ) : (
            <>
              <b>{me.data.display_name || "Add your name"}</b>
              <span>{me.data.occupation ? `${me.data.occupation} · ` : ""}The name people see on receipts and request links</span>
            </>
          )}
        </div>
        {editing ? (
          <>
            <button type="button" className="btn line sm" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button type="button" className="btn ink sm" disabled={!name.trim() || save.isPending} onClick={() => save.mutate()}>
              Save
            </button>
          </>
        ) : (
          <button
            type="button"
            className="btn line sm"
            onClick={() => {
              setName(me.data.display_name ?? "");
              setOccupation(me.data.occupation ?? "");
              setEditing(true);
            }}
          >
            Edit
          </button>
        )}
      </div>
      {me.data.near_account && (
        <div>
          <span className="icw">
            <Icon name="link" size={17} />
          </span>
          <div className="t">
            <b>{me.data.near_account}</b>
            <span>Your fliq name. Anyone on fliq can pay you with it, instantly and free.</span>
          </div>
          <button type="button" className="btn line sm" onClick={() => copy(me.data.near_account!, "fliq name copied")}>
            <Icon name="copy" size={15} />
            Copy
          </button>
        </div>
      )}
      {save.isError && (
        <div>
          <Notice tone="bad">{save.error.message}</Notice>
        </div>
      )}
    </section>
  );
}

function Preferences() {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const settings = useNotificationSettings();
  const currency = me.data?.home_currency ?? "NGN";
  const setCurrency = useMutation({
    mutationFn: (home_currency: "NGN" | "KES") => walletApi.updateMe({ home_currency }),
    onSuccess: (user) => {
      queryClient.setQueryData(keys.me, user);
      toast("Home currency saved");
    },
  });
  const [draft, setDraft] = useState<NotificationSettings | null>(null);
  const current = draft ?? settings.data ?? null;
  const saveSettings = useMutation({
    mutationFn: walletApi.saveNotificationSettings,
    onSuccess: (saved) => {
      queryClient.setQueryData(keys.notifications, saved);
      setDraft(null);
    },
    onError: () => setDraft(null),
  });
  const flip = (key: keyof Omit<NotificationSettings, "rate_alert">, value: boolean) => {
    if (!current) return;
    const next = { ...current, [key]: value };
    setDraft(next);
    saveSettings.mutate(next);
  };
  return (
    <>
      <section className="card set">
        <div>
          <img src={CURRENCIES[currency].flag} alt="" style={{ width: 36, height: 36, borderRadius: "50%" }} />
          <div className="t">
            <b>Home currency</b>
            <span>Used for estimates. Your vault always holds USDC.</span>
          </div>
          <select
            className="inp"
            id="pref-cur"
            style={{ width: "auto", height: 38 }}
            aria-label="Home currency"
            value={currency}
            disabled={setCurrency.isPending}
            onChange={(event) => setCurrency.mutate(event.target.value as "NGN" | "KES")}
          >
            <option value="NGN">NGN · Nigeria</option>
            <option value="KES">KES · Kenya</option>
          </select>
        </div>
        <div>
          <span className="icw">
            <Icon name="sun" size={17} />
          </span>
          <div className="t">
            <b>Appearance</b>
            <span>Applies on this device</span>
          </div>
          <ThemeSwitch labels />
        </div>
      </section>
      <div className="set-h">Notifications</div>
      <section className="card set">
        {settings.isPending && (
          <div>
            <Spinner />
          </div>
        )}
        {settings.isError && (
          <div>
            <Notice tone="bad">{settings.error.message}</Notice>
          </div>
        )}
        {current &&
          NOTIFICATIONS.map((item) => (
            <div key={item.key}>
              <span className="icw">
                <Icon name="bell" size={17} />
              </span>
              <div className="t">
                <b>{item.title}</b>
                <span>{item.detail}</span>
              </div>
              <Toggle checked={current[item.key]} onChange={(value) => flip(item.key, value)} label={item.title} disabled={saveSettings.isPending} />
            </div>
          ))}
        {saveSettings.isError && (
          <div>
            <Notice tone="bad">{saveSettings.error.message}</Notice>
          </div>
        )}
      </section>
    </>
  );
}

function DeviceKey() {
  const me = useMe();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const device = useQuery({
    queryKey: ["device-key", me.data?.user_id],
    queryFn: () => hasDeviceKey(me.data!),
    enabled: me.isSuccess,
  });
  const restore = useMutation({
    mutationFn: async () => {
      const user = me.data!;
      const key = await recoverNearKey(code);
      if (user.near_account && !(await keyMatchesAccount(user.near_account, key.publicKey))) {
        throw new Error("This recovery code does not control your NEAR account.");
      }
      await saveNearKey({ ...key, userId: user.user_id });
    },
    onSuccess: () => {
      setCode("");
      queryClient.invalidateQueries({ queryKey: ["device-key"] });
      toast("This browser can now sign for your vault");
    },
  });
  return (
    <section className="card set" id="device">
      <div>
        <span className="icw">
          <Icon name="key" size={17} />
        </span>
        <div className="t">
          <b>This browser&apos;s signing key</b>
          <span>Signs fliq to fliq transfers and agent limits. It never leaves this browser.</span>
        </div>
        {device.isPending ? <Spinner /> : device.data ? <Chip tone="good">Ready</Chip> : <Chip tone="sand">Not on this browser</Chip>}
      </div>
      {device.isSuccess && !device.data && (
        <div>
          <form
            style={{ display: "flex", gap: 10, flexWrap: "wrap", width: "100%" }}
            onSubmit={(event) => {
              event.preventDefault();
              restore.mutate();
            }}
          >
            <input
              className="inp mono"
              id="recovery-code"
              style={{ flex: "1 1 260px" }}
              placeholder="fliq-…"
              autoComplete="off"
              spellCheck={false}
              value={code}
              onChange={(event) => setCode(event.target.value)}
              aria-label="Recovery code"
            />
            <button type="submit" className="btn ink" disabled={!code.trim() || restore.isPending}>
              {restore.isPending ? "Checking" : "Restore key"}
            </button>
          </form>
          {restore.isError && <Notice tone="bad">{restore.error.message}</Notice>}
        </div>
      )}
    </section>
  );
}

function Security() {
  const passkeys = usePasskeys();
  const sessions = useSessions();
  const toast = useToast();
  const queryClient = useQueryClient();
  const revoke = useMutation({
    mutationFn: walletApi.revokeSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: keys.sessions });
      toast("Signed out of that device");
    },
  });
  return (
    <>
      <section className="card set">
        {passkeys.data?.items.map((passkey) => (
          <div key={passkey.passkey_id}>
            <span className="icw">
              <Icon name="finger" size={17} />
            </span>
            <div className="t">
              <b>Passkey{passkey.transports.includes("hybrid") ? " · syncs across devices" : ""}</b>
              <span>
                Added {when(passkey.created_at)}
                {passkey.last_used_at ? ` · used ${when(passkey.last_used_at)}` : ""}
              </span>
            </div>
          </div>
        ))}
        {passkeys.isSuccess && passkeys.data.items.length === 0 && (
          <div>
            <span className="icw">
              <Icon name="finger" size={17} />
            </span>
            <div className="t">
              <b>No passkey yet</b>
              <span>You sign in with an email link. Add a passkey from the fliq app to approve payments with Face ID or Touch ID.</span>
            </div>
          </div>
        )}
      </section>
      <div className="set-h">Signed-in devices</div>
      <section className="card set">
        {sessions.isPending && (
          <div>
            <Spinner />
          </div>
        )}
        {sessions.data?.items.map((session) => (
          <div key={session.session_id}>
            <span className="icw">
              <Icon name="monitor" size={17} />
            </span>
            <div className="t">
              <b>{session.device}</b>
              <span>Active {when(session.last_active_at)}</span>
            </div>
            {session.current ? (
              <Chip tone="good">This device</Chip>
            ) : (
              <button type="button" className="btn line sm" disabled={revoke.isPending} onClick={() => revoke.mutate(session.session_id)}>
                Sign out
              </button>
            )}
          </div>
        ))}
      </section>
    </>
  );
}

export function AccountPage() {
  const me = useMe();
  const router = useRouter();
  const queryClient = useQueryClient();
  const logout = useMutation({
    mutationFn: () => fliqApi<void>("auth/logout", { method: "POST" }),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/sign-in");
    },
  });
  useEffect(() => {
    if (location.hash === "#device") document.getElementById("device")?.scrollIntoView({ block: "center" });
  }, [me.isSuccess]);
  if (me.isPending) return <PageState message="Loading your account" />;
  if (me.isError) return <PageState message={me.error.message} />;
  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="head">
        <div>
          <h1>Account</h1>
        </div>
      </div>
      <div className="set-h">Profile</div>
      <Profile />
      <div className="set-h">Preferences</div>
      <Preferences />
      <div className="set-h">Security</div>
      <DeviceKey />
      <Security />
      <section className="card set">
        <div>
          <span className="icw">
            <Icon name="logout" size={17} />
          </span>
          <div className="t">
            <b>Sign out</b>
            <span>Signs out this browser. Your vault is not affected.</span>
          </div>
          <button type="button" className="btn danger sm" disabled={logout.isPending} onClick={() => logout.mutate()}>
            Sign out
          </button>
        </div>
      </section>
    </div>
  );
}
