import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { sha256Hex } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import { audit, type AuditActor } from "./audit.js";
import type { Db } from "./db.js";
import { ApiError, conflict, invalidRequest, notFound } from "./errors.js";

export type KeyEnvironment = "test" | "live";
type ApiKeyRow = Prisma.ApiKeyGetPayload<object>;

const PREFIXES: Record<KeyEnvironment, string> = { test: "rt_test_", live: "rt_live_" };
// "rt_test_" plus four characters, enough to recognise a key without revealing it.
const KEY_PREFIX_LENGTH = 12;
const KEY_BYTES = 32;
const MAX_NAME_LENGTH = 64;
export const MAX_ACTIVE_KEYS = 20;
const LAST_USED_RESOLUTION_MS = 60_000;

export interface KeyRequest {
  name: string;
  environment: KeyEnvironment;
}

export interface Caller extends AuditActor {
  keyEnvironment: KeyEnvironment;
  now: Date;
}

export function keyEnvironmentOf(token: string): KeyEnvironment | null {
  if (token.startsWith(PREFIXES.test)) return "test";
  if (token.startsWith(PREFIXES.live)) return "live";
  return null;
}

export const keyView = (key: ApiKeyRow) => ({
  key_id: key.id,
  name: key.name,
  environment: key.environment,
  masked: `${key.prefix}...${key.last4}`,
  status: key.revokedAt ? ("revoked" as const) : ("active" as const),
  created_at: key.createdAt.toISOString(),
  last_used_at: key.lastUsedAt?.toISOString() ?? null,
});

// Live access needs an approved KYB review. No review process exists yet, so no workspace has it.
export async function liveAccess(_tx: Db, _workspaceId: string, keyEnvironment: KeyEnvironment) {
  return {
    live_enabled: false,
    kyb_status: "not_started" as const,
    deployment_environment: keyEnvironment,
    test_keys_allowed: keyEnvironment === "test",
    live_keys_allowed: false,
  };
}

async function issue(tx: Db, workspaceId: string, environment: KeyEnvironment, name: string) {
  const key = `${PREFIXES[environment]}${randomBytes(KEY_BYTES).toString("base64url")}`;
  const row = await tx.apiKey.create({
    data: {
      id: newId("key"),
      workspaceId,
      environment,
      name,
      keyHash: sha256Hex(key),
      prefix: key.slice(0, KEY_PREFIX_LENGTH),
      last4: key.slice(-4),
    },
  });
  return { row, key };
}

function cleanName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > MAX_NAME_LENGTH)
    throw invalidRequest(`name must be 1 to ${MAX_NAME_LENGTH} characters.`);
  return name;
}

export async function createKey(tx: Db, caller: Caller, input: KeyRequest) {
  const name = cleanName(input.name);
  if (
    input.environment === "live" &&
    !(await liveAccess(tx, caller.workspaceId, caller.keyEnvironment)).live_keys_allowed
  ) {
    throw new ApiError(403, "live_not_enabled", "Live keys are available once the business passes KYB.");
  }
  if (input.environment !== caller.keyEnvironment) {
    throw new ApiError(
      422,
      "environment_unavailable",
      `This deployment only issues ${caller.keyEnvironment} keys.`,
    );
  }
  // Serialises key creation per workspace so two requests cannot both pass the limit.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`keys:${caller.workspaceId}`}, 0))`;
  const active = await tx.apiKey.count({ where: { workspaceId: caller.workspaceId, revokedAt: null } });
  if (active >= MAX_ACTIVE_KEYS)
    throw new ApiError(
      409,
      "limit_reached",
      `A workspace can hold ${MAX_ACTIVE_KEYS} active keys. Revoke one first.`,
    );

  const { row, key } = await issue(tx, caller.workspaceId, input.environment, name);
  await audit(tx, caller, {
    action: "api_key.created",
    targetType: "api_key",
    targetId: row.id,
    after: { name, environment: row.environment, status: "active" },
  });
  return { ...keyView(row), key };
}

async function ownedKey(tx: Db, caller: Caller, keyId: string) {
  const key = await tx.apiKey.findFirst({ where: { id: keyId, workspaceId: caller.workspaceId } });
  if (!key) throw notFound("No such key.");
  return key;
}

// Revoking twice is not an error: the key is revoked either way.
export async function revokeKey(tx: Db, caller: Caller, keyId: string): Promise<void> {
  await ownedKey(tx, caller, keyId);
  const revoked = await tx.apiKey.updateMany({
    where: { id: keyId, revokedAt: null },
    data: { revokedAt: caller.now },
  });
  if (revoked.count === 0) return;
  await audit(tx, caller, {
    action: "api_key.revoked",
    targetType: "api_key",
    targetId: keyId,
    before: { status: "active" },
    after: { status: "revoked" },
  });
}

// The old key stops working in the same commit that creates its replacement.
export async function rotateKey(tx: Db, caller: Caller, keyId: string) {
  const old = await ownedKey(tx, caller, keyId);
  const revoked = await tx.apiKey.updateMany({
    where: { id: keyId, revokedAt: null },
    data: { revokedAt: caller.now },
  });
  if (revoked.count === 0) throw conflict("This key is already revoked.");
  const { row, key } = await issue(tx, caller.workspaceId, old.environment, old.name);
  await audit(tx, caller, {
    action: "api_key.rotated",
    targetType: "api_key",
    targetId: keyId,
    before: { key_id: keyId, status: "active" },
    after: { key_id: row.id, replaced: keyId },
  });
  return { ...keyView(row), key };
}

export interface KeyIdentity {
  keyId: string;
  workspaceId: string;
  ownerId: string;
}

// Accepts only an active key of this deployment's environment that belongs to its owner's current workspace,
// because every handler resolves the workspace from the owner.
export async function authenticateKey(
  tx: Db,
  token: string,
  environment: KeyEnvironment,
  now: Date,
): Promise<KeyIdentity | null> {
  if (keyEnvironmentOf(token) !== environment) return null;
  const key = await tx.apiKey.findUnique({
    where: { keyHash: sha256Hex(token) },
    include: { workspace: true },
  });
  if (!key || key.revokedAt || key.environment !== environment) return null;
  const current = await tx.workspace.findFirst({
    where: { ownerId: key.workspace.ownerId },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (current?.id !== key.workspaceId) return null;
  await tx.apiKey.updateMany({
    where: {
      id: key.id,
      OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_RESOLUTION_MS) } }],
    },
    data: { lastUsedAt: now },
  });
  return { keyId: key.id, workspaceId: key.workspaceId, ownerId: key.workspace.ownerId };
}
