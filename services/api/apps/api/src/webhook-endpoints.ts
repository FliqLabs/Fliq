import type { Prisma } from "@prisma/client";
import { encrypt } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import {
  BlockedDestination,
  checkDestination,
  type Resolve,
} from "../../../packages/webhooks/destination.js";
import {
  DELIVERY_ID_HEADER,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  SIGNATURE_HEADER,
  TOLERANCE_SECONDS,
  newSigningSecret,
} from "../../../packages/webhooks/signature.js";
import { audit } from "./audit.js";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { ApiError, conflict, invalidRequest, notFound } from "./errors.js";
import type { Caller } from "./keys.js";
import { PAYOUT_EVENT_TYPES, TEST_EVENT_TYPE, eventEnvelope } from "./webhook-delivery.js";

const MAX_ENDPOINTS = 10;
const MAX_DESCRIPTION_LENGTH = 200;
// Replays and test events together, per workspace per minute.
const MANUAL_SENDS_PER_MINUTE = 30;
const SECRET_OVERLAP_MS = 24 * 3600_000;

type EndpointRow = Prisma.WebhookEndpointGetPayload<object>;
type DeliveryRow = Prisma.WebhookDeliveryGetPayload<{ include: { endpoint: true } }>;

export interface EndpointRequest {
  url: string;
  description?: string;
  events?: string[];
}

export interface EndpointUpdate {
  url?: string;
  description?: string | null;
  events?: string[];
  enabled?: boolean;
}

export const SIGNING = {
  header: SIGNATURE_HEADER,
  algorithm: "hmac-sha256",
  signed_payload: "<t>.<raw request body>",
  format: "t=<unix seconds>,v1=<hex signature>[,v1=<hex signature during a secret rotation>]",
  tolerance_seconds: TOLERANCE_SECONDS,
  event_id_header: EVENT_ID_HEADER,
  event_type_header: EVENT_TYPE_HEADER,
  delivery_id_header: DELIVERY_ID_HEADER,
};

export const endpointView = (endpoint: EndpointRow) => ({
  endpoint_id: endpoint.id,
  url: endpoint.url,
  description: endpoint.description,
  events: endpoint.events,
  status: endpoint.status,
  environment: endpoint.environment,
  created_at: endpoint.createdAt.toISOString(),
  updated_at: endpoint.updatedAt.toISOString(),
  failing_since: endpoint.failingSince?.toISOString() ?? null,
});

// The audit trail keeps the host, not the path or query, which can carry the developer's own tokens.
const auditable = (endpoint: Pick<EndpointRow, "url" | "status" | "events">) => ({
  host: new URL(endpoint.url).host,
  status: endpoint.status,
  events: endpoint.events,
});

async function destination(raw: string, resolve: Resolve | undefined): Promise<string> {
  try {
    return (await checkDestination(raw, resolve)).toString();
  } catch (error) {
    if (error instanceof BlockedDestination) throw invalidRequest(`${error.message}.`);
    throw error;
  }
}

function cleanEvents(events: string[] | undefined): string[] {
  const unique = [...new Set(events ?? [])];
  const unknown = unique.filter((type) => !PAYOUT_EVENT_TYPES.includes(type));
  if (unknown.length > 0) throw invalidRequest(`Unknown event types: ${unknown.join(", ")}.`);
  return unique;
}

function cleanDescription(raw: string | null | undefined): string | null {
  const description = raw?.trim();
  if (!description) return null;
  if (description.length > MAX_DESCRIPTION_LENGTH) {
    throw invalidRequest(`description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  return description;
}

async function ownedEndpoint(tx: Db, caller: Caller, endpointId: string) {
  const endpoint = await tx.webhookEndpoint.findFirst({
    where: { id: endpointId, workspaceId: caller.workspaceId, deletedAt: null },
  });
  if (!endpoint) throw notFound("No such webhook endpoint.");
  return endpoint;
}

export async function listEndpoints(tx: Db, caller: Caller) {
  const endpoints = await tx.webhookEndpoint.findMany({
    where: { workspaceId: caller.workspaceId, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
  return { items: endpoints.map(endpointView), event_types: PAYOUT_EVENT_TYPES, signing: SIGNING };
}

// The URL is checked (and resolved) before the transaction opens, so DNS never holds a database connection.
export async function prepareEndpoint(input: EndpointRequest, resolve?: Resolve) {
  return {
    url: await destination(input.url, resolve),
    events: cleanEvents(input.events),
    description: cleanDescription(input.description),
  };
}

export async function createEndpoint(
  tx: Db,
  config: Config,
  caller: Caller,
  prepared: Awaited<ReturnType<typeof prepareEndpoint>>,
) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`endpoints:${caller.workspaceId}`}, 0))`;
  const count = await tx.webhookEndpoint.count({
    where: { workspaceId: caller.workspaceId, deletedAt: null },
  });
  if (count >= MAX_ENDPOINTS) {
    throw new ApiError(409, "limit_reached", `A workspace can hold ${MAX_ENDPOINTS} webhook endpoints.`);
  }
  const secret = newSigningSecret();
  const endpoint = await tx.webhookEndpoint.create({
    data: {
      id: newId("whe"),
      workspaceId: caller.workspaceId,
      environment: caller.keyEnvironment,
      url: prepared.url,
      description: prepared.description,
      events: prepared.events,
      secretCipher: encrypt(secret, config.dataKey),
    },
  });
  await audit(tx, caller, {
    action: "webhook_endpoint.created",
    targetType: "webhook_endpoint",
    targetId: endpoint.id,
    after: auditable(endpoint),
  });
  return { ...endpointView(endpoint), secret };
}

export async function prepareUpdate(input: EndpointUpdate, resolve?: Resolve) {
  return {
    ...(input.url !== undefined ? { url: await destination(input.url, resolve) } : {}),
    ...(input.events !== undefined ? { events: cleanEvents(input.events) } : {}),
    ...(input.description !== undefined ? { description: cleanDescription(input.description) } : {}),
    ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
  };
}

export async function updateEndpoint(
  tx: Db,
  caller: Caller,
  endpointId: string,
  update: Awaited<ReturnType<typeof prepareUpdate>>,
) {
  const before = await ownedEndpoint(tx, caller, endpointId);
  const { enabled, ...fields } = update;
  // Turning an endpoint back on clears failing: the developer says it is fixed, and the next delivery will tell.
  const status = enabled === undefined ? undefined : enabled ? "active" : "disabled";
  const endpoint = await tx.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      ...fields,
      ...(status ? { status, ...(status === "active" ? { failingSince: null } : {}) } : {}),
      updatedAt: caller.now,
    },
  });
  await audit(tx, caller, {
    action: "webhook_endpoint.updated",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    before: auditable(before),
    after: auditable(endpoint),
  });
  return endpointView(endpoint);
}

// Kept, not removed: its deliveries stay readable in the audit trail. Pending deliveries stop with it.
export async function deleteEndpoint(tx: Db, caller: Caller, endpointId: string): Promise<void> {
  const before = await ownedEndpoint(tx, caller, endpointId);
  await tx.webhookEndpoint.update({
    where: { id: endpointId },
    data: { deletedAt: caller.now, status: "disabled", updatedAt: caller.now },
  });
  await audit(tx, caller, {
    action: "webhook_endpoint.deleted",
    targetType: "webhook_endpoint",
    targetId: endpointId,
    before: auditable(before),
  });
}

// The old secret keeps signing for 24 hours next to the new one, so receivers can switch without dropping events.
export async function rotateEndpointSecret(tx: Db, config: Config, caller: Caller, endpointId: string) {
  const endpoint = await ownedEndpoint(tx, caller, endpointId);
  const secret = newSigningSecret();
  const updated = await tx.webhookEndpoint.update({
    where: { id: endpointId },
    data: {
      secretCipher: encrypt(secret, config.dataKey),
      previousSecretCipher: endpoint.secretCipher,
      previousSecretExpiresAt: new Date(caller.now.getTime() + SECRET_OVERLAP_MS),
      updatedAt: caller.now,
    },
  });
  await audit(tx, caller, {
    action: "webhook_endpoint.secret_rotated",
    targetType: "webhook_endpoint",
    targetId: endpointId,
  });
  return {
    ...endpointView(updated),
    secret,
    previous_secret_expires_at: (updated.previousSecretExpiresAt as Date).toISOString(),
  };
}

async function limitManualSends(tx: Db, caller: Caller) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`manual-sends:${caller.workspaceId}`}, 0))`;
  const recent = await tx.webhookDelivery.count({
    where: {
      endpoint: { workspaceId: caller.workspaceId },
      createdAt: { gt: new Date(caller.now.getTime() - 60_000) },
      OR: [{ replayOfId: { not: null } }, { eventType: TEST_EVENT_TYPE }],
    },
  });
  if (recent >= MANUAL_SENDS_PER_MINUTE) {
    throw new ApiError(429, "rate_limited", "Too many replays and test events. Try again in a minute.");
  }
}

export async function sendTestEvent(tx: Db, config: Config, caller: Caller, endpointId: string) {
  const endpoint = await ownedEndpoint(tx, caller, endpointId);
  if (endpoint.status === "disabled") throw conflict("This endpoint is disabled. Enable it first.");
  await limitManualSends(tx, caller);
  const eventId = newId("evt");
  const delivery = await tx.webhookDelivery.create({
    data: {
      id: newId("whd"),
      endpointId,
      eventId,
      eventType: TEST_EVENT_TYPE,
      payoutId: null,
      nextAttemptAt: caller.now,
      payload: eventEnvelope({
        eventId,
        type: TEST_EVENT_TYPE,
        createdAt: caller.now,
        livemode: config.keyEnvironment === "live",
        data: { test: true, message: "A test event from the fliq dashboard. No payout is involved." },
      }),
    },
  });
  return { event_id: eventId, delivery_id: delivery.id, status: delivery.status };
}

// Same event id and the stored payload, as a new delivery. Only a webhook is sent; nothing about the payout runs.
export async function replayDelivery(tx: Db, caller: Caller, deliveryId: string) {
  const original = await tx.webhookDelivery.findFirst({
    where: { id: deliveryId, endpoint: { workspaceId: caller.workspaceId } },
    include: { endpoint: true },
  });
  if (!original) throw notFound("No such delivery.");
  if (original.endpoint.deletedAt || original.endpoint.status === "disabled") {
    throw conflict("This endpoint is disabled or deleted. Enable it before replaying.");
  }
  await limitManualSends(tx, caller);
  const replay = await tx.webhookDelivery.create({
    data: {
      id: newId("whd"),
      endpointId: original.endpointId,
      eventId: original.eventId,
      eventType: original.eventType,
      payoutId: original.payoutId,
      payload: original.payload as Prisma.InputJsonValue,
      replayOfId: original.id,
      nextAttemptAt: caller.now,
    },
  });
  await audit(tx, caller, {
    action: "webhook_delivery.replayed",
    targetType: "webhook_delivery",
    targetId: original.id,
    after: { delivery_id: replay.id, event_id: replay.eventId },
  });
  return { event_id: replay.eventId, delivery_id: replay.id, status: replay.status, replay_of: original.id };
}

const deliveryView = (delivery: DeliveryRow) => ({
  delivery_id: delivery.id,
  event_id: delivery.eventId,
  event_type: delivery.eventType,
  payout_id: delivery.payoutId,
  endpoint_id: delivery.endpointId,
  endpoint_url: delivery.endpoint.url,
  status: delivery.status,
  attempts: delivery.attempts,
  response_status: delivery.lastResponseStatus,
  error: delivery.lastError,
  replay_of: delivery.replayOfId,
  created_at: delivery.createdAt.toISOString(),
  last_attempt_at: delivery.lastAttemptAt?.toISOString() ?? null,
  next_attempt_at: delivery.status === "pending" ? (delivery.nextAttemptAt?.toISOString() ?? null) : null,
  delivered_at: delivery.deliveredAt?.toISOString() ?? null,
});

export interface DeliveryFilter {
  endpoint_id?: string;
  event_type?: string;
  status?: string;
  payout_id?: string;
  from?: string;
  to?: string;
  limit?: string;
  cursor?: string;
}

const DELIVERY_STATUSES = ["pending", "delivered", "failed"] as const;

function parseDate(raw: string | undefined, name: string): Date | undefined {
  if (raw === undefined) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) throw invalidRequest(`${name} must be an ISO 8601 date-time.`);
  return date;
}

export function parsePageLimit(raw: string | undefined): number {
  if (raw === undefined) return 25;
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw invalidRequest("limit must be a whole number from 1 to 100.");
  }
  return limit;
}

export const encodeCursor = (createdAt: Date, id: string) =>
  Buffer.from(`${createdAt.toISOString()}|${id}`).toString("base64url");

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [iso, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const createdAt = new Date(iso ?? "");
  if (!id || Number.isNaN(createdAt.getTime())) throw invalidRequest("Invalid cursor.");
  return { createdAt, id };
}

export async function listDeliveries(tx: Db, caller: Caller, filter: DeliveryFilter) {
  const limit = parsePageLimit(filter.limit);
  if (filter.status !== undefined && !DELIVERY_STATUSES.includes(filter.status as never)) {
    throw invalidRequest(`status must be one of ${DELIVERY_STATUSES.join(", ")}.`);
  }
  const from = parseDate(filter.from, "from");
  const to = parseDate(filter.to, "to");
  const after = filter.cursor ? decodeCursor(filter.cursor) : undefined;
  const rows = await tx.webhookDelivery.findMany({
    where: {
      endpoint: { workspaceId: caller.workspaceId },
      ...(filter.endpoint_id ? { endpointId: filter.endpoint_id } : {}),
      ...(filter.event_type ? { eventType: filter.event_type } : {}),
      ...(filter.status ? { status: filter.status as (typeof DELIVERY_STATUSES)[number] } : {}),
      ...(filter.payout_id ? { payoutId: filter.payout_id } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } } : {}),
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    },
    include: { endpoint: true },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
  });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(deliveryView),
    next_cursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null,
  };
}

export async function getDelivery(tx: Db, caller: Caller, deliveryId: string) {
  const delivery = await tx.webhookDelivery.findFirst({
    where: { id: deliveryId, endpoint: { workspaceId: caller.workspaceId } },
    include: { endpoint: true, history: { orderBy: { attempt: "asc" } } },
  });
  if (!delivery) throw notFound("No such delivery.");
  return {
    ...deliveryView(delivery),
    payload: delivery.payload,
    history: delivery.history.map((attempt) => ({
      attempt: attempt.attempt,
      at: attempt.startedAt.toISOString(),
      duration_ms: attempt.durationMs,
      response_status: attempt.responseStatus,
      error: attempt.errorKind,
    })),
  };
}
