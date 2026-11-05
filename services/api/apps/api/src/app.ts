import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { isFamilyActive } from "./auth/sessions.js";
import { verifyAccessToken } from "./auth/tokens.js";
import type { Config } from "./config.js";
import type { Unit } from "./db.js";
import { ApiError, unauthorized } from "./errors.js";
import type { Reply } from "./idempotency.js";
import { loadSpec, operations } from "./openapi.js";
import { rateLimitHook, type Limiter } from "./rate-limit.js";
import type { InboundWebhook } from "../../../packages/providers/types.js";

export interface AuthContext {
  userId: string;
  familyId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

export type Handler = (request: FastifyRequest) => Promise<Reply>;

export interface AppDeps {
  config: Config;
  unit: Unit;
  handlers: Record<string, Handler>;
  logger?: boolean;
  limiter?: Limiter;
  webhooks?: (provider: string, webhook: InboundWebhook) => Promise<Reply>;
}

function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

function bearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  return header?.startsWith("Bearer ") ? header.slice(7) : null;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const trustedHops = Number(process.env.TRUST_PROXY_HOPS ?? 1);
  const app: FastifyInstance = Fastify({
    logger: deps.logger ?? false,
    requestIdHeader: "x-trace-id",
    // One proxy hop (Render) sits in front, so the client address is the last one it appended; trusting more would let callers spoof it.
    trustProxy: (_address: string, hop: number) => hop < trustedHops,
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false, coerceTypes: false, allErrors: false } },
  });

  if (deps.limiter) app.addHook("onRequest", rateLimitHook(deps.limiter, deps.config.accessSecret));

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-trace-id", request.id);
  });

  app.setErrorHandler((error: any, request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ApiError) return reply.status(error.status).send(errorBody(error.code, error.message));
    if (error.validation) {
      const where = error.validation[0]?.instancePath || "body";
      return reply.status(400).send(errorBody("invalid_request", `Invalid request at ${where}: ${error.validation[0]?.message}.`));
    }
    request.log.error({ err: { type: error.name, message: error.message } }, "unhandled error");
    return reply.status(500).send(errorBody("internal", "Something went wrong."));
  });

  app.setNotFoundHandler((_request, reply) => reply.status(404).send(errorBody("not_found", "No such route.")));

  const requireSession = async (request: FastifyRequest) => {
    const token = bearerToken(request);
    const claims = token && verifyAccessToken(token, deps.config.accessSecret, Math.floor(Date.now() / 1000));
    if (!claims || !(await deps.unit((tx) => isFamilyActive(tx, claims.fam)))) throw unauthorized();
    request.auth = { userId: claims.sub, familyId: claims.fam };
  };

  for (const operation of operations(loadSpec())) {
    const handler = deps.handlers[operation.operationId];
    if (!handler) continue;
    app.route({
      method: operation.method.toUpperCase() as "GET",
      url: operation.fastifyPath,
      schema: operation.bodySchema ? { body: operation.bodySchema } : {},
      preHandler: operation.isPublic ? [] : [requireSession],
      handler: async (request, reply) => {
        const result = await handler(request);
        return reply.status(result.status).send(result.body);
      },
    });
  }

  const receiveWebhook = deps.webhooks;
  if (receiveWebhook) {
    // Its own scope: the signature covers the exact bytes sent, so this route keeps the body as a string.
    app.register(async (scope) => {
      scope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, rawBody, done) => done(null, rawBody));
      scope.post("/v1/webhooks/:provider", async (request, reply) => {
        const { provider } = request.params as { provider: string };
        const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value]));
        const result = await receiveWebhook(provider, { headers, rawBody: request.body as string });
        return reply.status(result.status).send(result.body);
      });
    });
  }
  return app;
}
