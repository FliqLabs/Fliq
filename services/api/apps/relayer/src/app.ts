import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import type { RotatingSecret } from "../../../packages/config/index.js";
import {
  AccountError,
  checkBalance,
  DelegateError,
  fundAgentDeposit,
  PolicyError,
  provisionAccount,
  relay,
  RelayError,
  relayStatus,
  type ProvisionDeps,
  type ProvisionResult,
  type RelayDeps,
  type RelayResult,
} from "../../../packages/chains/near/index.js";

const BODY_LIMIT_BYTES = 32 * 1024;

export type RelayerAppDeps = {
  relay: RelayDeps;
  provision: ProvisionDeps;
  authToken: RotatingSecret;
  logger?: boolean;
};

const RELAY_STATUS: Record<RelayError["code"], number> = {
  rate_limited: 429,
  in_progress: 409,
  expired: 400,
  validity_too_long: 400,
  unknown_key: 403,
  nonce_used: 409,
  key_not_allowed: 403,
  no_key_available: 503,
  rejected_by_chain: 502,
  rpc_unavailable: 503,
};

const ACCOUNT_STATUS: Record<AccountError["code"], number> = {
  invalid_name: 400,
  invalid_key: 400,
  taken: 409,
  in_progress: 409,
  busy: 503,
  chain_failure: 502,
  rpc_unavailable: 503,
};

// Private network only: the API calls this after authenticating the user; nothing here is reachable publicly.
export function buildRelayerApp(deps: RelayerAppDeps): FastifyInstance {
  const app = Fastify({
    bodyLimit: BODY_LIMIT_BYTES,
    // Fastify strips unknown fields by default; refuse them instead, so a request is relayed exactly as sent.
    ajv: { customOptions: { removeAdditional: false } },
    logger: deps.logger ? { redact: ["req.headers.authorization"] } : false,
  });

  app.addHook("onRequest", async (request, reply) => {
    if (request.url === "/health") return;
    const token = request.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
    if (!token || !deps.authToken.accepts(token)) {
      await reply
        .code(401)
        .send({ error: { code: "unauthorized", message: "missing or wrong relayer token" } });
    }
  });

  app.setErrorHandler(async (error, _request, reply) => {
    if (error instanceof DelegateError)
      return fail(reply, 400, `invalid_delegate.${error.code}`, error.message);
    if (error instanceof PolicyError) return fail(reply, 403, "not_allowed", error.message);
    if (error instanceof RelayError) return fail(reply, RELAY_STATUS[error.code], error.code, error.message);
    if (error instanceof AccountError)
      return fail(reply, ACCOUNT_STATUS[error.code], error.code, error.message);
    const validation = (error as { validation?: unknown }).validation;
    if (validation) return fail(reply, 400, "invalid_request", (error as Error).message);
    app.log.error(error);
    return fail(reply, 500, "internal", "unexpected relayer error");
  });

  app.get("/health", async () => ({ status: "ok" }));

  app.post<{ Body: { signed_delegate: string } }>(
    "/v1/relays",
    { schema: { body: strictBody({ signed_delegate: { type: "string", minLength: 1 } }) } },
    async (request, reply) => {
      const result = await relay(deps.relay, request.body.signed_delegate);
      return reply.code(result.status === "pending" ? 202 : 200).send(relayView(result));
    },
  );

  app.get<{ Params: { hash: string } }>("/v1/relays/:hash", async (request, reply) => {
    if (!/^[0-9a-f]{64}$/.test(request.params.hash))
      return fail(reply, 400, "invalid_request", "hash must be 64 hex characters");
    const result = await relayStatus(deps.relay, request.params.hash);
    return result ? relayView(result) : fail(reply, 404, "not_found", "no relay with that delegate hash");
  });

  app.post<{ Body: { account_id: string; public_key: string } }>(
    "/v1/accounts",
    {
      schema: {
        body: strictBody({
          account_id: { type: "string", maxLength: 64 },
          public_key: { type: "string", maxLength: 128 },
        }),
      },
    },
    async (request, reply) => {
      const result = await provisionAccount(deps.provision, request.body.account_id, request.body.public_key);
      const code = result.status === "created" ? 201 : result.status === "pending" ? 202 : 200;
      return reply.code(code).send(accountView(result));
    },
  );

  // Called by the API only for a pending agent the signed-in user owns; the top-up itself happens once per agent.
  app.post<{ Body: { account_id: string; agent_id: string } }>(
    "/v1/accounts/agent-deposit",
    {
      schema: {
        body: strictBody({
          account_id: { type: "string", maxLength: 64 },
          agent_id: { type: "string", maxLength: 64 },
        }),
      },
    },
    async (request, reply) => {
      const result = await fundAgentDeposit(deps.provision, request.body.account_id, request.body.agent_id);
      return reply.code(result.status === "funded" ? 201 : result.status === "pending" ? 202 : 200).send({
        status: result.status,
        account_id: result.accountId,
        agent_id: result.agentId,
        yocto: result.yocto,
        tx_hash: result.txHash,
      });
    },
  );

  app.get("/v1/status", async () => {
    const [relayer, root] = await Promise.all([
      checkBalance(deps.relay.rpc, deps.relay.relayerAccountId),
      checkBalance(deps.provision.rpc, deps.provision.root.accountId),
    ]);
    return { relayer: { ...relayer, keys: deps.relay.relayerKeys.length }, account_creator: root };
  });

  return app;
}

function strictBody(properties: Record<string, object>) {
  return { type: "object", required: Object.keys(properties), additionalProperties: false, properties };
}

function fail(reply: FastifyReply, status: number, code: string, message: string) {
  return reply.code(status).send({ error: { code, message } });
}

function relayView(result: RelayResult) {
  return {
    status: result.status,
    tx_hash: result.txHash,
    delegate_hash: result.delegateHash,
    sender_id: result.senderId,
    receiver_id: result.receiverId,
    failures: result.failures,
  };
}

function accountView(result: ProvisionResult) {
  return {
    status: result.status,
    account_id: result.accountId,
    public_key: result.publicKey,
    tx_hashes: result.txHashes,
    storage: result.storage,
  };
}
