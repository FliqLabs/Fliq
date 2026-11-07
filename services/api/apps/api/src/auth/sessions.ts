import type { User } from "@prisma/client";
import { newId } from "../../../../packages/db/src/ids.js";
import type { Config } from "../config.js";
import { formatTokenAmount } from "../dashboard.js";
import { DEFAULT_VELOCITY } from "../payouts.js";
import type { Db } from "../db.js";
import { accepted, rejected, unauthorized, type Outcome } from "../errors.js";
import { ACCESS_TTL_SECONDS, REFRESH_TTL_SECONDS, hashToken, newOpaqueToken, signAccessToken } from "./tokens.js";

export function toUserView(user: User) {
  return {
    user_id: user.id,
    near_account: user.nearAccount,
    display_name: user.displayName,
    photo_url: user.photoUrl,
    occupation: user.occupation,
    vault: user.vaultAccount,
    home_currency: user.homeCurrency,
    daily_limit: { amount: formatTokenAmount(DEFAULT_VELOCITY.maxTokenUnitsPerDay), currency: "USD" },
    verified: user.nearAccount !== null,
  };
}

export type Session = Awaited<ReturnType<typeof openSession>>;

export async function openSession(db: Db, config: Config, userId: string, familyId: string = newId("ses")) {
  const now = Date.now();
  const refresh = newOpaqueToken("rf");
  await db.session.create({
    data: {
      id: newId("ses"),
      userId,
      familyId,
      refreshHash: refresh.hash,
      expiresAt: new Date(now + REFRESH_TTL_SECONDS * 1000),
    },
  });
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return {
    access_token: signAccessToken(userId, familyId, config.accessSecret, Math.floor(now / 1000)),
    expires_in: ACCESS_TTL_SECONDS,
    refresh_token: refresh.token,
    user: toUserView(user),
  };
}

export async function revokeFamily(db: Db, familyId: string): Promise<void> {
  await db.session.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
}

export async function isFamilyActive(db: Db, familyId: string): Promise<boolean> {
  const rows = await db.session.findMany({ where: { familyId }, select: { revokedAt: true }, take: 1 });
  return rows.length > 0 && rows[0]?.revokedAt === null;
}

export async function rotateSession(db: Db, config: Config, refreshToken: string): Promise<Outcome<Session>> {
  const row = await db.session.findUnique({ where: { refreshHash: hashToken(refreshToken) } });
  if (!row || row.revokedAt || row.expiresAt < new Date()) return rejected(unauthorized("Invalid refresh token."));
  const claimed = await db.session.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  if (claimed.count === 0) {
    await revokeFamily(db, row.familyId);
    return rejected(unauthorized("Refresh token was already used. Sign in again."));
  }
  return accepted(await openSession(db, config, row.userId, row.familyId));
}
