import { createHash } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Db, Unit } from "./db.js";
import { ApiError } from "./errors.js";

export interface Reply {
  status: number;
  body: unknown;
}

export const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

// The lock makes concurrent calls with one key run one after another, so the second sees the stored response.
export async function withIdempotency(
  unit: Unit,
  scope: string,
  request: FastifyRequest,
  work: (tx: Db) => Promise<Reply>,
): Promise<Reply> {
  const key = request.headers["idempotency-key"];
  if (typeof key !== "string" || key.length === 0) {
    throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required.");
  }
  const requestHash = hashOf(request.body);
  return unit(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 0))`;
    const stored = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (stored) {
      if (stored.requestHash !== requestHash) {
        throw new ApiError(422, "idempotency_mismatch", "This Idempotency-Key was used with a different request.");
      }
      return { status: stored.responseStatus, body: stored.responseBody };
    }
    const reply = await work(tx);
    await tx.idempotencyRecord.create({
      data: { scope, key, requestHash, responseStatus: reply.status, responseBody: reply.body as object },
    });
    return reply;
  });
}
