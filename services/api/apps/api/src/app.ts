import { randomUUID } from "node:crypto";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import { isFamilyActive } from "./auth/sessions.js";
import { verifyAccessToken } from "./auth/tokens.js";
import type { Config } from "./config.js";
import type { Unit } from "./db.js";
import { authenticateAgent } from "./agent-auth.js";
import { ApiError, forbidden, invalidRequest, unauthorized } from "./errors.js";
import type { Reply } from "./idempotency.js";
import { authenticateKey, keyEnvironmentOf } from "./keys.js";
import { loadSpec, operations } from "./openapi.js";
import { ProvenKeys, rateLimitHook, type Limiter } from "./rate-limit.js";
import type { UsageOutcome } from "./usage.js";
import type { InboundWebhook } from "../../../packages/providers/types.js";

export interface AuthContext {
  userId: string;
  // Empty for an API key: keys only reach KEY_OPERATIONS, none of which touch sessions.
  familyId: string;
  keyId?: string;
  // Set when an agent signed the request; userId is then its owner.
  agentId?: string;
}

// The developer API. Keys never reach sign-in, profile, workspace or key management, which need a person.
export const KEY_OPERATIONS: ReadonlySet<string> = new Set([
  "getRate",
  "createQuote",
  "requestQuote",
  "listInstitutions",
  "verifyAccountName",
  "verifyAccount",
  "listPayouts",
  "createPayout",
  "getPayout",
  "getPayoutStats",
]);

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthContext;
    rawBody?: string;
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
  recordUsage?: (event: { keyId?: string; token?: string; outcome: UsageOutcome; payoutCreated: boolean; at: Date }) => Promise<void>;
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

  const provenKeys = new ProvenKeys();
  if (deps.limiter) app.addHook("onRequest", rateLimitHook(deps.limiter, deps.config.accessSecret, provenKeys));

  app.addHook("onSend", async (request, reply) => {
    reply.header("x-trace-id", request.id);
  });

  // Only API-key traffic is usage. Runs after the response is sent, so counting never slows a request.
  const recordUsage = deps.recordUsage;
  if (recordUsage) {
    app.addHook("onResponse", async (request, reply) => {
      const status = reply.statusCode;
      const at = new Date();
      const keyId = request.auth?.keyId;
      if (keyId) {
        const payoutCreated = request.method === "POST" && request.routeOptions.url === "/v1/payouts" && status === 201;
        await recordUsage({ keyId, outcome: status < 400 ? "succeeded" : "failed", payoutCreated, at });
        return;
      }
      const token = bearerToken(request);
      if (status === 429 && token && keyEnvironmentOf(token)) {
        await recordUsage({ token, outcome: "rate_limited", payoutCreated: false, at });
      }
    });
  }

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

  const requireCaller = (operationId: string) => async (request: FastifyRequest) => {
    const token = bearerToken(request);
    if (token && keyEnvironmentOf(token)) {
      if (!KEY_OPERATIONS.has(operationId)) throw forbidden("API keys cannot call this endpoint. Sign in to the dashboard instead.");
      const key = await deps.unit((tx) => authenticateKey(tx, token, deps.config.keyEnvironment, new Date()));
      if (!key) throw unauthorized();
      provenKeys.add(token);
      request.auth = { userId: key.ownerId, familyId: "", keyId: key.keyId };
      return;
    }
    const claims = token && verifyAccessToken(token, deps.config.accessSecret, Math.floor(Date.now() / 1000));
    if (!claims || !(await deps.unit((tx) => isFamilyActive(tx, claims.fam)))) throw unauthorized();
    request.auth = { userId: claims.sub, familyId: claims.fam };
  };

  const header = (request: FastifyRequest, name: string) => {
    const value = request.headers[name];
    return typeof value === "string" ? value : undefined;
  };
  const requireAgent = async (request: FastifyRequest) => {
    const agent = await deps.unit((tx) =>
      authenticateAgent(
        tx,
        { agent: header(request, "x-fliq-agent"), timestamp: header(request, "x-fliq-timestamp"), signature: header(request, "x-fliq-signature") },
        request.method,
        request.url,
        request.rawBody ?? "",
        Math.floor(Date.now() / 1000),
      ),
    );
    request.auth = { userId: agent.userId, familyId: "", agentId: agent.id };
  };

  const all = operations(loadSpec()).filter((operation) => deps.handlers[operation.operationId]);
  const route = (scope: FastifyInstance, operation: (typeof all)[number]) => {
    const handler = deps.handlers[operation.operationId] as Handler;
    scope.route({
      method: operation.method.toUpperCase() as "GET",
      url: operation.fastifyPath,
      schema: operation.bodySchema ? { body: operation.bodySchema } : {},
      preHandler: operation.isPublic ? [] : [operation.isAgent ? requireAgent : requireCaller(operation.operationId)],
      handler: async (request, reply) => {
        const result = await handler(request);
        return reply.status(result.status).headers(result.headers ?? {}).send(result.body);
      },
    });
  };
  for (const operation of all.filter((candidate) => !candidate.isAgent)) route(app, operation);
  // An agent signs the exact bytes it sent, so its routes keep the raw body; every other route parses as usual.
  app.register(async (scope) => {
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (request, rawBody, done) => {
      const text = rawBody as string;
      request.rawBody = text;
      if (text === "") return done(null, undefined);
      try {
        done(null, JSON.parse(text));
      } catch {
        done(invalidRequest("The body is not valid JSON."), undefined);
      }
    });
    for (const operation of all.filter((candidate) => candidate.isAgent)) route(scope, operation);
  });

  const receiveWebhook = deps.webhooks;
  if (receiveWebhook) {
    // Its own scope: the signature covers the exact bytes sent, so this route keeps the body as a string.
    app.register(async (scope) => {
      scope.addContentTypeParser("application/json", { parseAs: "string" }, (_request, rawBody, done) => done(null, rawBody));
      scope.post("/v1/webhooks/:provider", async (request, reply) => {
        const { provider } = request.params as { provider: string };
        const headers = Object.fromEntries(Object.entries(request.headers).map(([name, value]) => [name, Array.isArray(value) ? value[0] : value]));
        const result = await receiveWebhook(provider, { headers, rawBody: request.body as string });
        return reply.status(result.status).headers(result.headers ?? {}).send(result.body);
      });
    });
  }
  return app;
}
