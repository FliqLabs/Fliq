import type { FastifyRequest } from "fastify";
import { vaultMirror } from "../../../packages/ledger/post.js";
import { revokeFamily } from "./auth/sessions.js";
import type { Db } from "./db.js";
import { invalidRequest, notFound } from "./errors.js";

export type NotificationSettings = {
  received: boolean;
  payout_paid: boolean;
  payout_refunded: boolean;
  agent_paid: boolean;
  agent_refused: boolean;
  cap_almost_reached: boolean;
  rate_alert: { enabled: boolean; currency: "NGN" | "KES"; above: number | null };
  weekly_summary: boolean;
};

// Every money and agent notification is on for a new user; the optional ones are off.
export const DEFAULT_NOTIFICATIONS: NotificationSettings = {
  received: true,
  payout_paid: true,
  payout_refunded: true,
  agent_paid: true,
  agent_refused: true,
  cap_almost_reached: true,
  rate_alert: { enabled: false, currency: "NGN", above: null },
  weekly_summary: false,
};

const HOME_CURRENCIES = new Set(["NGN", "KES"]);
const MAX_DEVICE_LENGTH = 80;

export function checkHomeCurrency(value: string | undefined): void {
  if (value !== undefined && !HOME_CURRENCIES.has(value)) throw invalidRequest("home_currency must be NGN or KES.");
}

export async function notificationSettings(tx: Db, userId: string): Promise<NotificationSettings> {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { notificationSettings: true } });
  return { ...DEFAULT_NOTIFICATIONS, ...((user.notificationSettings ?? {}) as Partial<NotificationSettings>) };
}

export async function saveNotificationSettings(tx: Db, userId: string, settings: NotificationSettings): Promise<NotificationSettings> {
  if (settings.rate_alert.enabled && (settings.rate_alert.above === null || settings.rate_alert.above <= 0)) {
    throw invalidRequest("rate_alert.above must be a positive rate when the alert is on.");
  }
  await tx.user.update({ where: { id: userId }, data: { notificationSettings: settings } });
  return settings;
}

// The app sends X-Device-Name ("iPhone 17 Pro"); a browser has only its user agent.
export function deviceName(request: FastifyRequest): string {
  const named = request.headers["x-device-name"];
  const raw = (typeof named === "string" && named.trim()) || request.headers["user-agent"] || "Unknown device";
  return raw.replace(/[\r\n\t]+/g, " ").trim().slice(0, MAX_DEVICE_LENGTH);
}

export async function rememberDevice(tx: Db, userId: string, familyId: string, device: string): Promise<void> {
  await tx.sessionDevice.upsert({ where: { familyId }, create: { familyId, userId, device }, update: {} });
}

// A device is one sign-in family: refreshing rotates its sessions, so its last activity is its newest session.
export async function listSessions(tx: Db, userId: string, currentFamilyId: string, now: Date) {
  const sessions = await tx.session.findMany({ where: { userId, revokedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "asc" } });
  const families = new Map<string, { first: Date; last: Date }>();
  for (const session of sessions) {
    const seen = families.get(session.familyId);
    families.set(session.familyId, { first: seen?.first ?? session.createdAt, last: session.createdAt });
  }
  const devices = await tx.sessionDevice.findMany({ where: { familyId: { in: [...families.keys()] } } });
  const items = [...families.entries()].map(([familyId, times]) => ({
    session_id: familyId,
    device: devices.find((device) => device.familyId === familyId)?.device ?? "Unknown device",
    current: familyId === currentFamilyId,
    created_at: times.first.toISOString(),
    last_active_at: times.last.toISOString(),
  }));
  items.sort((a, b) => Number(b.current) - Number(a.current) || b.last_active_at.localeCompare(a.last_active_at));
  return { items };
}

export async function revokeSession(tx: Db, userId: string, familyId: string): Promise<void> {
  const owned = await tx.session.findFirst({ where: { userId, familyId, revokedAt: null }, select: { id: true } });
  if (!owned) throw notFound("No such session.");
  await revokeFamily(tx, familyId);
}

export async function listPasskeys(tx: Db, userId: string) {
  const passkeys = await tx.passkeyCredential.findMany({ where: { userId }, orderBy: { createdAt: "desc" } });
  return {
    items: passkeys.map((passkey) => ({
      passkey_id: passkey.id,
      transports: passkey.transports,
      created_at: passkey.createdAt.toISOString(),
      last_used_at: passkey.lastUsedAt?.toISOString() ?? null,
    })),
  };
}

// A token moves to whoever registered it last, since a phone signed in as someone else must not get their alerts.
export async function registerPushToken(tx: Db, userId: string, token: string, platform: string): Promise<void> {
  await tx.pushToken.upsert({ where: { token }, create: { token, userId, platform }, update: { userId, platform, updatedAt: new Date() } });
}

// Home's getting-started card: the user's own account saved, then the first top-up landed.
export async function setup(tx: Db, userId: string) {
  const user = await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { nearAccount: true } });
  const ownAccount = await tx.recipient.findFirst({ where: { userId, own: true, savedAt: { not: null }, deletedAt: null }, select: { id: true } });
  const landed = await tx.vaultDeposit.findFirst({ where: { userId, state: "landed" }, select: { id: true } });
  const funded = user.nearAccount ? (await vaultMirror(tx, user.nearAccount, "USDC")).available > 0n : false;
  const steps = [
    { step: "add_account" as const, done: Boolean(ownAccount) },
    { step: "top_up" as const, done: Boolean(landed) || funded },
  ];
  return { steps, done: steps.filter((step) => step.done).length, total: steps.length };
}
