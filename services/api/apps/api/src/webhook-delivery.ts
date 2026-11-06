import type { Prisma } from "@prisma/client";
import { decrypt } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import { PAYOUT_STATES } from "../../../packages/domain/payout-state.js";
import {
  DELIVERY_ID_HEADER,
  EVENT_ID_HEADER,
  EVENT_TYPE_HEADER,
  SIGNATURE_HEADER,
  signatureHeader,
} from "../../../packages/webhooks/signature.js";
import type { Transport } from "../../../packages/webhooks/transport.js";
import type { Config } from "./config.js";
import { payoutSummary } from "./dashboard.js";
import type { Db, Unit } from "./db.js";

export const TEST_EVENT_TYPE = "test.webhook";
export const PAYOUT_EVENT_TYPES = PAYOUT_STATES.map((state) => `payout.${state}`);

// ARCH §12.4: first attempt at once, then these delays with jitter. After the last one the endpoint is marked failing.
export const RETRY_DELAYS_SECONDS = [30, 120, 600, 1800, 3600, 7200, 14_400, 28_800, 86_400];
export const MAX_ATTEMPTS = RETRY_DELAYS_SECONDS.length + 1;
const REQUEST_TIMEOUT_MS = 10_000;
// A claimed delivery is hidden for this long, so a worker that dies mid-send hands it back instead of losing it.
const CLAIM_LEASE_MS = 60_000;
const FANOUT_CONSUMER = "webhook_fanout";
// Events older than this are not fanned out, so a first deploy does not send a backlog.
const FANOUT_WINDOW_MS = 24 * 3600_000;
const BATCH = 50;

export interface DeliveryDeps {
  unit: Unit;
  config: Config;
  transport: Transport;
  now: () => Date;
  random?: () => number;
}

export function eventIdFor(payoutEventId: string): string {
  return `evt_${payoutEventId.replace(/^pev_/, "")}`;
}

export function eventEnvelope(input: {
  eventId: string;
  type: string;
  createdAt: Date;
  livemode: boolean;
  data: Prisma.InputJsonObject;
}): Prisma.InputJsonObject {
  return {
    id: input.eventId,
    type: input.type,
    created_at: input.createdAt.toISOString(),
    livemode: input.livemode,
    data: input.data,
  };
}

const subscribed = (events: readonly string[], type: string) => events.length === 0 || events.includes(type);

interface PendingEvent {
  id: string;
  payout_id: string;
  to_state: string;
  version: number;
  created_at: Date;
  developer_id: string;
}

// Turns each new payout state change into one delivery per subscribed endpoint. The inbox row makes it
// run once per event however many workers poll, and it never touches the payout itself.
export async function fanOut(deps: DeliveryDeps): Promise<number> {
  const since = new Date(deps.now().getTime() - FANOUT_WINDOW_MS);
  const pending = await deps.unit(
    (tx) => tx.$queryRaw<PendingEvent[]>`
    SELECT pe.id, pe.payout_id, pe.to_state::text AS to_state, pe.version, pe.created_at, p.developer_id
    FROM core.payout_events pe
    JOIN core.payouts p ON p.id = pe.payout_id
    WHERE pe.created_at > ${since}
      AND EXISTS (SELECT 1 FROM developer.webhook_endpoints e
                  WHERE e.workspace_id = p.developer_id AND e.deleted_at IS NULL AND e.status <> 'disabled')
      AND NOT EXISTS (SELECT 1 FROM messaging.inbox i WHERE i.consumer = ${FANOUT_CONSUMER} AND i.message_id = pe.id)
    ORDER BY pe.created_at, pe.id
    LIMIT ${BATCH}`,
  );
  let created = 0;
  for (const event of pending) {
    created += await deps.unit(async (tx) => {
      const fresh = await tx.inbox.createMany({
        data: [{ consumer: FANOUT_CONSUMER, messageId: event.id }],
        skipDuplicates: true,
      });
      if (fresh.count === 0) return 0;
      const type = `payout.${event.to_state}`;
      const endpoints = await tx.webhookEndpoint.findMany({
        where: {
          workspaceId: event.developer_id,
          deletedAt: null,
          status: { not: "disabled" },
          createdAt: { lte: event.created_at },
        },
      });
      const targets = endpoints.filter((endpoint) => subscribed(endpoint.events, type));
      if (targets.length === 0) return 0;
      const payload = await payoutEventPayload(tx, deps.config, event, type);
      await tx.webhookDelivery.createMany({
        data: targets.map((endpoint) => ({
          id: newId("whd"),
          endpointId: endpoint.id,
          eventId: eventIdFor(event.id),
          eventType: type,
          payoutId: event.payout_id,
          payload,
          nextAttemptAt: deps.now(),
        })),
      });
      return targets.length;
    });
  }
  return created;
}

async function payoutEventPayload(tx: Db, config: Config, event: PendingEvent, type: string) {
  const payout = await tx.payout.findUniqueOrThrow({
    where: { id: event.payout_id },
    include: { recipient: true },
  });
  // The state and version are the event's, not the payout's current ones: receivers keep the highest version.
  return eventEnvelope({
    eventId: eventIdFor(event.id),
    type,
    createdAt: event.created_at,
    livemode: config.keyEnvironment === "live",
    data: { payout: { ...payoutSummary(payout, config), state: event.to_state }, version: event.version },
  });
}

function nextDelay(attempt: number, random: () => number): number {
  const base = RETRY_DELAYS_SECONDS[attempt - 1] as number;
  return Math.round(base * 1000 * (0.9 + random() * 0.2));
}

async function claim(deps: DeliveryDeps): Promise<string[]> {
  const now = deps.now();
  const until = new Date(now.getTime() + CLAIM_LEASE_MS);
  return deps.unit(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      UPDATE developer.webhook_deliveries d SET next_attempt_at = ${until}
      WHERE d.id IN (
        SELECT d2.id FROM developer.webhook_deliveries d2
        JOIN developer.webhook_endpoints e ON e.id = d2.endpoint_id
        WHERE d2.status = 'pending' AND d2.next_attempt_at <= ${now}
          AND e.status <> 'disabled' AND e.deleted_at IS NULL
        ORDER BY d2.next_attempt_at
        LIMIT ${BATCH}
        FOR UPDATE OF d2 SKIP LOCKED)
      RETURNING d.id`;
    return rows.map((row) => row.id);
  });
}

function secretsOf(
  endpoint: {
    secretCipher: Uint8Array;
    previousSecretCipher: Uint8Array | null;
    previousSecretExpiresAt: Date | null;
  },
  dataKey: Buffer,
  now: Date,
) {
  const secrets = [decrypt(endpoint.secretCipher, dataKey)];
  if (
    endpoint.previousSecretCipher &&
    endpoint.previousSecretExpiresAt &&
    endpoint.previousSecretExpiresAt > now
  ) {
    secrets.push(decrypt(endpoint.previousSecretCipher, dataKey));
  }
  return secrets;
}

async function attempt(deps: DeliveryDeps, deliveryId: string): Promise<void> {
  const delivery = await deps.unit((tx) =>
    tx.webhookDelivery.findUniqueOrThrow({ where: { id: deliveryId }, include: { endpoint: true } }),
  );
  if (delivery.status !== "pending") return;
  const started = deps.now();
  const body = JSON.stringify(delivery.payload);
  const timestamp = Math.floor(started.getTime() / 1000);
  const clock = Date.now();
  const outcome = await deps.transport({
    url: delivery.endpoint.url,
    body,
    timeoutMs: REQUEST_TIMEOUT_MS,
    headers: {
      "content-type": "application/json",
      "user-agent": "fliq-webhooks/1",
      [SIGNATURE_HEADER]: signatureHeader(
        secretsOf(delivery.endpoint, deps.config.dataKey, started),
        timestamp,
        body,
      ),
      [EVENT_ID_HEADER]: delivery.eventId,
      [EVENT_TYPE_HEADER]: delivery.eventType,
      [DELIVERY_ID_HEADER]: delivery.id,
    },
  });
  const durationMs = Date.now() - clock;
  const number = delivery.attempts + 1;
  const status = "status" in outcome ? outcome.status : null;
  const ok = status !== null && status >= 200 && status < 300;
  const errorKind = ok ? null : "error" in outcome ? outcome.error : `http_${status}`;
  const finished = deps.now();
  const exhausted = !ok && number >= MAX_ATTEMPTS;

  await deps.unit(async (tx) => {
    await tx.webhookAttempt.create({
      data: {
        id: newId("wha"),
        deliveryId,
        attempt: number,
        startedAt: started,
        durationMs,
        responseStatus: status,
        errorKind,
      },
    });
    await tx.webhookDelivery.update({
      where: { id: deliveryId },
      data: {
        attempts: number,
        lastAttemptAt: started,
        lastResponseStatus: status,
        lastError: errorKind,
        status: ok ? "delivered" : exhausted ? "failed" : "pending",
        deliveredAt: ok ? finished : null,
        nextAttemptAt:
          ok || exhausted
            ? null
            : new Date(finished.getTime() + nextDelay(number, deps.random ?? Math.random)),
      },
    });
    if (ok) {
      await tx.webhookEndpoint.updateMany({
        where: { id: delivery.endpointId, status: "failing" },
        data: { status: "active", failingSince: null },
      });
    } else if (exhausted) {
      await tx.webhookEndpoint.updateMany({
        where: { id: delivery.endpointId, status: "active" },
        data: { status: "failing", failingSince: finished },
      });
    }
  });
}

export async function deliverDue(deps: DeliveryDeps): Promise<number> {
  const ids = await claim(deps);
  await Promise.all(ids.map((id) => attempt(deps, id)));
  return ids.length;
}

// Runs inside the API process. Several instances can run it: claims use SKIP LOCKED and fan-out uses the inbox.
export function startWebhookDelivery(deps: DeliveryDeps, intervalMs: number, log: (message: string) => void) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await fanOut(deps);
      await deliverDue(deps);
    } catch (error) {
      log(`webhook delivery tick failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
