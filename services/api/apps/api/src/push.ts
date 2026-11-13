import { createPrivateKey, sign, type KeyObject } from "node:crypto";
import { connect, type ClientHttp2Session } from "node:http2";
import { decrypt } from "../../../packages/db/src/crypto.js";
import type { Db, Unit } from "./db.js";
import { DEFAULT_NOTIFICATIONS, type NotificationSettings } from "./settings.js";

export type PushKind = "transfer_in" | "transfer_out" | "payout" | "deposit" | "refused";

export interface PushMessage {
  userId: string;
  kind: PushKind;
  refId: string;
  title: string;
  body: string;
  setting: keyof NotificationSettings | null;
}

export interface PushTarget {
  token: string;
  environment: string;
  bundleId: string | null;
}

export type SendResult = { status: number; reason?: string };
export type PushSender = (target: PushTarget, payload: object) => Promise<SendResult>;

export interface ApnsCredentials {
  keyId: string;
  teamId: string;
  key: string;
  topic?: string;
}

const JWT_TTL_SECONDS = 50 * 60;
const SEND_TIMEOUT_MS = 10_000;
const HOSTS: Record<string, string> = {
  production: "https://api.push.apple.com",
  sandbox: "https://api.sandbox.push.apple.com",
};
const DEAD_REASONS = new Set(["BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"]);

export function apnsFromEnv(env: NodeJS.ProcessEnv): ApnsCredentials | null {
  const { APNS_KEY_ID: keyId, APNS_TEAM_ID: teamId, APNS_KEY: key, APNS_TOPIC: topic } = env;
  if (!keyId || !teamId || !key) return null;
  return { keyId, teamId, key: key.replace(/\\n/g, "\n"), ...(topic ? { topic } : {}) };
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

// APNs token auth: an ES256 JWT naming the key and team, good for up to an hour.
export function apnsJwt(
  credentials: ApnsCredentials,
  issuedAt: number,
  key: KeyObject = createPrivateKey(credentials.key),
): string {
  const signing = `${base64url(JSON.stringify({ alg: "ES256", kid: credentials.keyId }))}.${base64url(JSON.stringify({ iss: credentials.teamId, iat: issuedAt }))}`;
  const signature = sign("sha256", Buffer.from(signing), { key, dsaEncoding: "ieee-p1363" });
  return `${signing}.${base64url(signature)}`;
}

export function apnsPayload(message: Pick<PushMessage, "title" | "body" | "kind" | "refId">) {
  return {
    aps: { alert: { title: message.title, body: message.body }, sound: "default" },
    kind: message.kind,
    ref_id: message.refId,
  };
}

export function createApnsSender(
  credentials: ApnsCredentials,
  nowSeconds: () => number = () => Math.floor(Date.now() / 1000),
): PushSender {
  const key = createPrivateKey(credentials.key);
  let jwt: { token: string; at: number } | null = null;
  const sessions = new Map<string, ClientHttp2Session>();
  const bearer = () => {
    const now = nowSeconds();
    if (!jwt || now - jwt.at > JWT_TTL_SECONDS) jwt = { token: apnsJwt(credentials, now, key), at: now };
    return jwt.token;
  };
  const session = (host: string) => {
    const open = sessions.get(host);
    if (open && !open.closed && !open.destroyed) return open;
    const fresh = connect(host);
    fresh.on("error", () => sessions.delete(host));
    fresh.on("close", () => sessions.delete(host));
    fresh.unref();
    sessions.set(host, fresh);
    return fresh;
  };
  return (target, payload) =>
    new Promise((resolve) => {
      const topic = target.bundleId ?? credentials.topic;
      if (!topic) return resolve({ status: 0, reason: "NoTopic" });
      const request = session(HOSTS[target.environment] ?? (HOSTS.production as string)).request({
        ":method": "POST",
        ":path": `/3/device/${target.token}`,
        authorization: `bearer ${bearer()}`,
        "apns-topic": topic,
        "apns-push-type": "alert",
        "apns-priority": "10",
        "content-type": "application/json",
      });
      let status = 0;
      let raw = "";
      request.setTimeout(SEND_TIMEOUT_MS, () => request.close());
      request.on("response", (headers) => (status = Number(headers[":status"] ?? 0)));
      request.on("data", (chunk) => (raw += chunk));
      request.on("error", () => resolve({ status: 0, reason: "NetworkError" }));
      request.on("close", () => {
        let reason: string | undefined;
        try {
          reason = raw ? (JSON.parse(raw) as { reason?: string }).reason : undefined;
        } catch {
          reason = undefined;
        }
        resolve(reason ? { status, reason } : { status });
      });
      request.end(JSON.stringify(payload));
    });
}

export const isDeadToken = (result: SendResult) =>
  result.status === 410 || (result.reason !== undefined && DEAD_REASONS.has(result.reason));

const SYMBOLS: Record<string, string> = { NGN: "₦", KES: "KSh ", GHS: "GH₵" };

export function dollars(units: bigint): string {
  const cents = (units + 5_000n) / 10_000n;
  return `$${(cents / 100n).toLocaleString("en-US")}.${String(cents % 100n).padStart(2, "0")}`;
}

export function local(minor: bigint, currency: string): string {
  const code = currency.toUpperCase();
  return `${SYMBOLS[code] ?? `${code} `}${(minor / 100n).toLocaleString("en-US")}`;
}

// frank.fliqaccount.near reads as @frank; any other NEAR account stays whole.
export function handle(account: string): string {
  return /\.(fliqaccount\.(near|testnet)|fliq\.near)$/.test(account) ? `@${account.split(".")[0]}` : account;
}

export const transferInMessage = (
  userId: string,
  refId: string,
  units: bigint,
  from: string,
): PushMessage => ({
  userId,
  kind: "transfer_in",
  refId,
  title: `You received ${dollars(units)}`,
  body: `From ${handle(from)}`,
  setting: "received",
});

export const transferOutMessage = (
  userId: string,
  refId: string,
  units: bigint,
  to: string,
): PushMessage => ({
  userId,
  kind: "transfer_out",
  refId,
  title: `Sent ${dollars(units)} to ${handle(to)}`,
  body: "It's in their vault now.",
  setting: null,
});

export const depositMessage = (
  userId: string,
  refId: string,
  units: bigint,
  token: string,
  chain: string,
): PushMessage => ({
  userId,
  kind: "deposit",
  refId,
  title: `${dollars(units)} arrived in your vault`,
  body:
    chain === "near"
      ? "From NEAR"
      : `${token.toUpperCase()} from ${chain.charAt(0).toUpperCase()}${chain.slice(1)}`,
  setting: "received",
});

export function payoutMessage(
  userId: string,
  payout: {
    id: string;
    state: string;
    amountIn: bigint;
    amountOutMinor: bigint;
    currency: string;
    agentName: string | null;
  },
  name: string,
): PushMessage | null {
  const base = { userId, kind: "payout" as const, refId: payout.id };
  const paid = local(payout.amountOutMinor, payout.currency);
  if (payout.state === "settled") {
    return payout.agentName
      ? { ...base, title: `${payout.agentName} paid ${paid}`, body: `To ${name}`, setting: "agent_paid" }
      : { ...base, title: `${paid} paid to ${name}`, body: "The bank has it.", setting: "payout_paid" };
  }
  if (payout.state === "refunded") {
    return {
      ...base,
      title: `Cash out refunded: ${dollars(payout.amountIn)} is back in your vault`,
      body: `${paid} to ${name} could not be paid.`,
      setting: "payout_refunded",
    };
  }
  if (payout.state === "failed" || payout.state === "expired") {
    return {
      ...base,
      title: "Cash out didn't go through",
      body: `${paid} to ${name} was not paid. Open fliq to try again.`,
      setting: "payout_refunded",
    };
  }
  return null;
}

export interface PushDeps {
  unit: Unit;
  send: PushSender | null;
  dataKey: Buffer;
  now: () => Date;
  log: (message: string) => void;
}

const CONSUMER = "push";
// Only events this recent are pushed, so a first deploy does not replay history.
const WINDOW_MS = 15 * 60_000;
const BATCH = 50;
const PAYOUT_TERMINAL = ["settled", "refunded", "failed", "expired"];

type Pending = { messageId: string; build: (tx: Db) => Promise<PushMessage | null> };

async function pending(tx: Db, since: Date, dataKey: Buffer): Promise<Pending[]> {
  const seen = async (ids: string[]) =>
    new Set(
      (
        await tx.inbox.findMany({
          where: { consumer: CONSUMER, messageId: { in: ids } },
          select: { messageId: true },
        })
      ).map((row) => row.messageId),
    );

  const transfers = await tx.transfer.findMany({
    where: { createdAt: { gt: since } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  const deposits = await tx.vaultDeposit.findMany({
    where: { state: "landed", landedAt: { gt: since } },
    orderBy: { landedAt: "asc" },
    take: BATCH,
  });
  const events = await tx.payoutEvent.findMany({
    where: { createdAt: { gt: since }, toState: { in: PAYOUT_TERMINAL as never } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });

  const all: Pending[] = [
    ...transfers.flatMap((row) => [
      {
        messageId: `${row.id}:in`,
        build: async () => transferInMessage(row.toUserId, row.id, row.amount, row.fromAccount),
      },
      {
        messageId: `${row.id}:out`,
        build: async () => transferOutMessage(row.fromUserId, row.id, row.amount, row.toAccount),
      },
    ]),
    ...deposits.map((row) => ({
      messageId: row.id,
      build: async () =>
        depositMessage(row.userId, row.id, row.landedUnits ?? row.amountUnits, row.token, row.chain),
    })),
    ...events.map((event) => ({
      messageId: event.id,
      build: async (db: Db) => {
        const payout = await db.payout.findUnique({
          where: { id: event.payoutId },
          include: { recipient: true },
        });
        if (!payout) return null;
        const agent = payout.agentId
          ? await db.agent.findUnique({ where: { id: payout.agentId }, select: { name: true } })
          : null;
        const name = decrypt(payout.recipient.nameCipher, dataKey);
        return payoutMessage(
          payout.recipient.userId,
          { ...payout, state: event.toState, agentName: agent?.name ?? null },
          name,
        );
      },
    })),
  ];
  const done = await seen(all.map((item) => item.messageId));
  return all.filter((item) => !done.has(item.messageId));
}

async function wanted(tx: Db, message: PushMessage): Promise<boolean> {
  if (!message.setting) return true;
  const user = await tx.user.findUnique({
    where: { id: message.userId },
    select: { notificationSettings: true },
  });
  const settings = {
    ...DEFAULT_NOTIFICATIONS,
    ...((user?.notificationSettings ?? {}) as Partial<NotificationSettings>),
  };
  return settings[message.setting] !== false;
}

// Each event is claimed in messaging.inbox before it is sent, so two API replicas never push it twice.
export async function dispatchPushes(deps: PushDeps): Promise<number> {
  const send = deps.send;
  if (!send) return 0;
  const since = new Date(deps.now().getTime() - WINDOW_MS);
  const queue = await deps.unit((tx) => pending(tx, since, deps.dataKey));
  let sent = 0;
  for (const item of queue) {
    const claimed = await deps.unit(async (tx) => {
      const fresh = await tx.inbox.createMany({
        data: [{ consumer: CONSUMER, messageId: item.messageId }],
        skipDuplicates: true,
      });
      if (fresh.count === 0) return null;
      const message = await item.build(tx);
      if (!message || !(await wanted(tx, message))) return null;
      const targets = await tx.pushToken.findMany({ where: { userId: message.userId, platform: "ios" } });
      return { message, targets };
    });
    if (!claimed) continue;
    for (const target of claimed.targets) {
      const result = await send(target, apnsPayload(claimed.message)).catch(
        () => ({ status: 0, reason: "SendFailed" }) as SendResult,
      );
      if (result.status === 200) sent += 1;
      else if (isDeadToken(result))
        await deps.unit((tx) => tx.pushToken.deleteMany({ where: { token: target.token } }));
      else deps.log(`push to a device failed: ${result.status} ${result.reason ?? ""}`.trim());
    }
  }
  return sent;
}

export function startPushDispatch(deps: PushDeps, intervalMs: number) {
  if (!deps.send)
    deps.log("push notifications are off: APNS_KEY_ID, APNS_TEAM_ID and APNS_KEY are not all set");
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchPushes(deps);
    } catch (error) {
      deps.log(`push tick failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
