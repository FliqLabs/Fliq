import type { FastifyRequest } from "fastify";
import { checkName, claimName, type ClaimInput, type NearProvisioner } from "./accounts.js";
import type { RelayerClient } from "../../../packages/chains/near/index.js";
import { getRelay, relayDelegate } from "./relay.js";
import { listActivity, listNotifications, parseFilter } from "./activity.js";
import { connectAgent, listAgents, revokeAgent, updateAgentLimits, type AgentInput, type AgentLimits } from "./agents.js";
import { publicReceipt } from "./receipts.js";
import { agentRecipients, agentSelf, createAgentPayout, getAgentPayout, quoteForAgent, type AgentPayoutInput } from "./agent-payouts.js";
import { cancelRequest, createRequest, getRequest, listRequests, payRequestDeposit, publicRequest, requestDeposit, type RequestInput } from "./requests.js";
import {
  checkHomeCurrency,
  deviceName,
  listPasskeys,
  listSessions,
  notificationSettings,
  registerPushToken,
  rememberDevice,
  revokeSession,
  saveNotificationSettings,
  setup,
  type NotificationSettings,
} from "./settings.js";
import { verifyAccessToken } from "./auth/tokens.js";
import type { Handler } from "./app.js";
import { createEmailLink, verifyEmailLink, type EmailSender } from "./auth/email-links.js";
import { finishLogin, finishRegistration, startLogin, startRegistration } from "./auth/passkeys.js";
import { revokeFamily, rotateSession, toUserView } from "./auth/sessions.js";
import type { Config } from "./config.js";
import type { Db, Unit } from "./db.js";
import {
  currentWorkspace,
  listKeys,
  listPayouts,
  onboardingProgress,
  parseLimit,
  parseTimezone,
  payoutStats,
  workspaceView,
} from "./dashboard.js";
import { requireHttpsUrl, settle } from "./errors.js";
import { createDeposits, type DepositChain, type DepositInput, type Deposits, type DepositToken } from "./deposits.js";
import { withIdempotency } from "./idempotency.js";
import { exportPayoutsCsv, parsePayoutFilter, type PayoutQuery } from "./payout-history.js";
import { parseDays, usageReport } from "./usage.js";
import { createKey, liveAccess, revokeKey, rotateKey, type Caller, type KeyRequest } from "./keys.js";
import type { VaultClient } from "../../../packages/chains/vault/index.js";
import { lookupPerson, recentPeople } from "./people.js";
import { DEFAULT_STATUS_CONFIG, statusReport, type Probe, type StatusConfig } from "./status.js";
import { vaultBalance } from "./vault.js";
import { deleteRecipient, listInstitutions, listRecipients, saveRecipient, updateRecipient, verifyAccount, type AccountLookup } from "./recipients.js";
import { bankReference, createPayout, getPayout, type PayoutDeps, type PayoutInput } from "./payouts.js";
import { openClaim, quoteRetry } from "./recovery.js";
import { createRateBoard, type RateBoard } from "./rate-board.js";
import { createRates } from "./rates.js";
import { quoteAndSave, type QuoteDeps, type QuoteInput } from "./quotes.js";
import { createWorkspace } from "./workspaces.js";
import type { Resolve } from "../../../packages/webhooks/destination.js";
import {
  createEndpoint,
  deleteEndpoint,
  getDelivery,
  listDeliveries,
  listEndpoints,
  prepareEndpoint,
  prepareUpdate,
  replayDelivery,
  rotateEndpointSecret,
  sendTestEvent,
  updateEndpoint,
  type DeliveryFilter,
  type EndpointRequest,
  type EndpointUpdate,
} from "./webhook-endpoints.js";

export interface HandlerDeps {
  config: Config;
  unit: Unit;
  email: EmailSender;
  provisioner: NearProvisioner;
  // The private relayer, when one is configured: it creates NEAR accounts and pays gas for user-signed calls.
  relayer?: RelayerClient;
  quotes: QuoteDeps;
  payouts: Omit<PayoutDeps, "quotes">;
  vault: VaultClient;
  status?: { probes: readonly Probe[]; config?: StatusConfig };
  deposits?: Deposits;
  rateBoard?: RateBoard;
  now?: () => Date;
  // Resolves webhook hostnames when an endpoint is saved. Tests replace it; production uses the system resolver.
  webhookResolve?: Resolve;
}

const body = <T>(request: FastifyRequest) => request.body as T;
const auth = (request: FastifyRequest) => request.auth as NonNullable<FastifyRequest["auth"]>;

export function createHandlers({
  config,
  unit,
  email,
  provisioner,
  quotes,
  payouts,
  vault,
  status = { probes: [] },
  deposits = createDeposits({ client: undefined, vaultAccount: config.vaultAccount, usdcContract: "", slippageBps: 0 }),
  rateBoard = createRateBoard(quotes, unit),
  relayer,
  now = () => new Date(),
  webhookResolve,
}: HandlerDeps): Record<string, Handler> {
  const rates = createRates(quotes);
  const agentDeps = { config, vault, provisioner, rate: rates, now };
  const agentPayoutDeps = { config, vault, quotes, payouts: { ...payouts, quotes } };
  // Set by the agent signature check: the owner's user and the agent that signed.
  const agentOf = (request: FastifyRequest) => {
    const caller = auth(request);
    return { ownerId: caller.userId, agentId: caller.agentId as string };
  };
  // The security screen names each signed-in device, so the name is kept with the session family a sign-in opens.
  const signedIn = async <T extends { access_token: string }>(request: FastifyRequest, session: T): Promise<T> => {
    const claims = verifyAccessToken(session.access_token, config.accessSecret, Math.floor(Date.now() / 1000));
    if (claims) await unit((tx) => rememberDevice(tx, claims.sub, claims.fam, deviceName(request)));
    return session;
  };
  const callerIn = async (tx: Db, request: FastifyRequest): Promise<Caller> => ({
    userId: auth(request).userId,
    workspaceId: (await currentWorkspace(tx, auth(request).userId)).id,
    traceId: request.id,
    keyEnvironment: config.keyEnvironment,
    now: now(),
  });
  const keyId = (request: FastifyRequest) => (request.params as { keyId: string }).keyId;
  const endpointId = (request: FastifyRequest) => (request.params as { endpointId: string }).endpointId;
  const deliveryId = (request: FastifyRequest) => (request.params as { deliveryId: string }).deliveryId;

  return {
    getRate: async (request) => {
      const { token, currency } = request.params as { token: string; currency: string };
      return { status: 200, body: await rates(token, currency), headers: { "cache-control": "public, max-age=10" } };
    },
    getRateBoard: async (request) => {
      const { token, currency } = request.params as { token: string; currency: string };
      return { status: 200, body: await rateBoard.board(token, currency), headers: { "cache-control": "public, max-age=10" } };
    },
    getRateHistory: async (request) => {
      const { token, currency } = request.params as { token: string; currency: string };
      const { range } = request.query as { range?: string };
      return { status: 200, body: await rateBoard.history(token, currency, range), headers: { "cache-control": "public, max-age=60" } };
    },
    getHealth: async () => ({ status: 200, body: { status: "ok", version: "0.1.0" } }),

    startPasskeyRegistration: async () => ({ status: 200, body: await unit((tx) => startRegistration(tx, config)) }),
    finishPasskeyRegistration: async (request) => {
      const { challenge_id, credential } = body<{ challenge_id: string; credential: unknown }>(request);
      return { status: 201, body: await signedIn(request, settle(await unit((tx) => finishRegistration(tx, config, challenge_id, credential)))) };
    },
    startPasskeyLogin: async () => ({ status: 200, body: await unit((tx) => startLogin(tx, config)) }),
    finishPasskeyLogin: async (request) => {
      const { challenge_id, credential } = body<{ challenge_id: string; credential: unknown }>(request);
      return { status: 200, body: await signedIn(request, settle(await unit((tx) => finishLogin(tx, config, challenge_id, credential)))) };
    },

    sendEmailLink: async (request) => {
      const { to, link } = await unit((tx) => createEmailLink(tx, config, body<{ email: string }>(request).email));
      // The response is the same whether or not the send works, so it cannot reveal which emails have accounts.
      await email.sendSignInLink(to, link).catch((error: Error) => request.log.error({ err: { message: error.message } }, "email send failed"));
      return { status: 202, body: { status: "sent" } };
    },
    verifyEmailLink: async (request) => ({
      status: 200,
      body: await signedIn(request, await unit((tx) => verifyEmailLink(tx, config, body<{ token: string }>(request).token))),
    }),
    refreshSession: async (request) => ({
      status: 200,
      body: settle(await unit((tx) => rotateSession(tx, config, body<{ refresh_token: string }>(request).refresh_token))),
    }),
    logout: async (request) => {
      await unit((tx) => revokeFamily(tx, auth(request).familyId));
      return { status: 204, body: undefined };
    },

    getMe: async (request) => ({
      status: 200,
      body: await unit(async (tx) => toUserView(await tx.user.findUniqueOrThrow({ where: { id: auth(request).userId } }))),
    }),
    updateMe: async (request) => {
      const { display_name, occupation, photo_url, home_currency } = body<{
        display_name?: string;
        occupation?: string | null;
        photo_url?: string | null;
        home_currency?: string;
      }>(request);
      requireHttpsUrl(photo_url);
      checkHomeCurrency(home_currency);
      const user = await unit((tx) =>
        tx.user.update({ where: { id: auth(request).userId }, data: { displayName: display_name?.trim(), occupation, photoUrl: photo_url, homeCurrency: home_currency } }),
      );
      return { status: 200, body: toUserView(user) };
    },
    checkName: async (request) => ({
      status: 200,
      body: await unit((tx) => checkName(tx, config, (request.params as { name: string }).name)),
    }),
    claimName: (request) =>
      claimName(unit, config, provisioner, auth(request).userId, request.headers["idempotency-key"] as string | undefined, body<ClaimInput>(request)),
    relay: (request) => relayDelegate(unit, relayer, auth(request).userId, body<{ signed_delegate: string }>(request).signed_delegate, { vault: config.vaultAccount, usdc: config.usdcContract }),
    getRelay: (request) => getRelay(unit, relayer, auth(request).userId, (request.params as { delegateHash: string }).delegateHash),

    getCurrentWorkspace: async (request) => ({
      status: 200,
      body: await unit(async (tx) => workspaceView(await currentWorkspace(tx, auth(request).userId))),
    }),
    listKeys: async (request) => ({
      status: 200,
      body: await unit(async (tx) => listKeys(tx, (await currentWorkspace(tx, auth(request).userId)).id)),
    }),
    // Not behind Idempotency-Key: a stored replay would keep the plaintext key in the database for a day.
    createKey: async (request) => ({
      status: 201,
      body: await unit(async (tx) => createKey(tx, await callerIn(tx, request), body<KeyRequest>(request))),
    }),
    revokeKey: async (request) => {
      await unit(async (tx) => revokeKey(tx, await callerIn(tx, request), keyId(request)));
      return { status: 204, body: undefined };
    },
    rotateKey: async (request) => ({
      status: 201,
      body: await unit(async (tx) => rotateKey(tx, await callerIn(tx, request), keyId(request))),
    }),
    getLiveAccess: async (request) => ({
      status: 200,
      body: await unit(async (tx) => liveAccess(tx, (await currentWorkspace(tx, auth(request).userId)).id, config.keyEnvironment)),
    }),
    listWebhookEndpoints: async (request) => ({
      status: 200,
      body: await unit(async (tx) => listEndpoints(tx, await callerIn(tx, request))),
    }),
    createWebhookEndpoint: async (request) => {
      const prepared = await prepareEndpoint(body<EndpointRequest>(request), webhookResolve);
      return { status: 201, body: await unit(async (tx) => createEndpoint(tx, config, await callerIn(tx, request), prepared)) };
    },
    updateWebhookEndpoint: async (request) => {
      const update = await prepareUpdate(body<EndpointUpdate>(request), webhookResolve);
      return { status: 200, body: await unit(async (tx) => updateEndpoint(tx, await callerIn(tx, request), endpointId(request), update)) };
    },
    deleteWebhookEndpoint: async (request) => {
      await unit(async (tx) => deleteEndpoint(tx, await callerIn(tx, request), endpointId(request)));
      return { status: 204, body: undefined };
    },
    rotateWebhookSecret: async (request) => ({
      status: 200,
      body: await unit(async (tx) => rotateEndpointSecret(tx, config, await callerIn(tx, request), endpointId(request))),
    }),
    sendWebhookTest: async (request) => ({
      status: 202,
      body: await unit(async (tx) => sendTestEvent(tx, config, await callerIn(tx, request), endpointId(request))),
    }),
    listWebhookDeliveries: async (request) => ({
      status: 200,
      body: await unit(async (tx) => listDeliveries(tx, await callerIn(tx, request), request.query as DeliveryFilter)),
    }),
    getWebhookDelivery: async (request) => ({
      status: 200,
      body: await unit(async (tx) => getDelivery(tx, await callerIn(tx, request), deliveryId(request))),
    }),
    replayWebhookDelivery: async (request) => ({
      status: 202,
      body: await unit(async (tx) => replayDelivery(tx, await callerIn(tx, request), deliveryId(request))),
    }),
    getOnboarding: async (request) => ({
      status: 200,
      body: await unit(async (tx) => onboardingProgress(tx, (await currentWorkspace(tx, auth(request).userId)).id)),
    }),
    listPayouts: async (request) => {
      const query = request.query as PayoutQuery;
      const limit = parseLimit(query.limit);
      const filter = parsePayoutFilter(query);
      return {
        status: 200,
        body: await unit(async (tx) => listPayouts(tx, config, (await currentWorkspace(tx, auth(request).userId)).id, limit, query.cursor, filter)),
      };
    },
    exportPayouts: async (request) => {
      const filter = parsePayoutFilter(request.query as PayoutQuery);
      const exported = await unit(async (tx) => exportPayoutsCsv(tx, config, (await currentWorkspace(tx, auth(request).userId)).id, filter));
      return {
        status: 200,
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="fliq-payouts-${now().toISOString().slice(0, 10)}.csv"`,
          "cache-control": "no-store",
          "x-export-rows": String(exported.rows),
          "x-export-truncated": String(exported.truncated),
        },
        body: exported.csv,
      };
    },
    getUsage: async (request) => {
      const days = parseDays((request.query as { days?: string }).days);
      return {
        status: 200,
        body: await unit(async (tx) => usageReport(tx, (await currentWorkspace(tx, auth(request).userId)).id, days, now())),
      };
    },

    requestQuote: async (request) => ({
      status: 200,
      body: await quoteAndSave(unit, quotes, auth(request).userId, body<QuoteInput>(request)),
    }),

    createPayout: async (request) =>
      createPayout(unit, { ...payouts, quotes }, auth(request).userId, request.headers["idempotency-key"] as string | undefined, body<PayoutInput>(request)),
    getPayout: async (request) => ({
      status: 200,
      body: await getPayout(unit, config, auth(request).userId, (request.params as { payoutId: string }).payoutId),
    }),

    quoteRetry: async (request) => ({
      status: 200,
      body: await quoteRetry(unit, quotes, auth(request).userId, (request.params as { payoutId: string }).payoutId),
    }),
    openPayoutClaim: (request) =>
      withIdempotency(unit, auth(request).userId, request, (tx) =>
        openClaim(tx, auth(request).userId, (request.params as { payoutId: string }).payoutId, bankReference),
      ),

    listInstitutions: async (request) => ({
      status: 200,
      body: await listInstitutions(quotes.adapters, (request.query as { country?: string }).country),
    }),
    verifyAccountName: async (request) => ({ status: 200, body: await verifyAccount(quotes.adapters, body<AccountLookup>(request)) }),
    saveRecipient: (request) => saveRecipient(unit, { config, adapters: quotes.adapters }, auth(request).userId, body<AccountLookup>(request)),
    listRecipients: async (request) => ({ status: 200, body: await unit((tx) => listRecipients(tx, config, auth(request).userId)) }),
    updateRecipient: async (request) => ({
      status: 200,
      body: await unit((tx) => updateRecipient(tx, config, auth(request).userId, (request.params as { recipientId: string }).recipientId, body<{ own?: boolean; default?: boolean }>(request))),
    }),
    deleteRecipient: async (request) => {
      await unit((tx) => deleteRecipient(tx, auth(request).userId, (request.params as { recipientId: string }).recipientId));
      return { status: 204, body: undefined };
    },

    // Public and cacheable: the status page and its bars read this, so a burst of visitors makes one query per 10 seconds.
    getStatus: async () => ({
      status: 200,
      headers: { "cache-control": "public, max-age=10" },
      body: await unit((tx) => statusReport(tx, status.probes, status.config ?? DEFAULT_STATUS_CONFIG, now())),
    }),

    getVaultBalance: async (request) => ({ status: 200, body: await vaultBalance(unit, vault, auth(request).userId) }),

    listActivity: async (request) => {
      const { filter, limit, cursor } = request.query as { filter?: string; limit?: string; cursor?: string };
      return { status: 200, body: await unit((tx) => listActivity(tx, config, auth(request).userId, parseFilter(filter), parseLimit(limit), cursor)) };
    },
    listNotifications: async (request) => ({
      status: 200,
      body: await unit((tx) => listNotifications(tx, config, auth(request).userId, parseLimit((request.query as { limit?: string }).limit))),
    }),
    registerPushToken: async (request) => {
      const { token, platform } = body<{ token: string; platform: string }>(request);
      await unit((tx) => registerPushToken(tx, auth(request).userId, token, platform));
      return { status: 204, body: undefined };
    },

    listAgents: async (request) => ({ status: 200, body: await listAgents(unit, agentDeps, auth(request).userId) }),
    getAgentSelf: async (request) => ({ status: 200, body: await agentSelf(unit, vault, agentOf(request).agentId) }),
    listAgentRecipients: async (request) => ({ status: 200, body: await agentRecipients(unit, config, agentOf(request).ownerId) }),
    quoteForAgent: async (request) => ({
      status: 200,
      body: await quoteForAgent(unit, quotes, agentOf(request).ownerId, body<{ currency: QuoteInput["currency"]; amount: string; mode?: "send" | "receive" }>(request)),
    }),
    createAgentPayout: (request) =>
      createAgentPayout(unit, agentPayoutDeps, agentOf(request).agentId, request.headers["idempotency-key"] as string | undefined, body<AgentPayoutInput>(request)),
    getAgentPayout: async (request) => ({
      status: 200,
      body: await getAgentPayout(unit, config, agentOf(request).agentId, (request.params as { payoutId: string }).payoutId),
    }),
    relayForAgent: (request) =>
      relayDelegate(unit, relayer, agentOf(request).ownerId, body<{ signed_delegate: string }>(request).signed_delegate, { vault: config.vaultAccount, usdc: config.usdcContract }, agentOf(request).agentId),
    connectAgent: async (request) => ({ status: 201, body: await connectAgent(unit, agentDeps, auth(request).userId, body<AgentInput>(request)) }),
    updateAgentLimits: async (request) => ({
      status: 200,
      body: await updateAgentLimits(unit, agentDeps, auth(request).userId, (request.params as { agentId: string }).agentId, body<AgentLimits>(request)),
    }),
    revokeAgent: async (request) => ({ status: 200, body: await revokeAgent(unit, agentDeps, auth(request).userId, (request.params as { agentId: string }).agentId) }),

    listRequests: async (request) => ({ status: 200, body: await unit((tx) => listRequests(tx, config, auth(request).userId)) }),
    createRequest: (request) =>
      withIdempotency(unit, auth(request).userId, request, async (tx) => ({ status: 201, body: await createRequest(tx, config, auth(request).userId, body<RequestInput>(request)) })),
    getRequest: async (request) => ({ status: 200, body: await unit((tx) => getRequest(tx, config, auth(request).userId, (request.params as { requestId: string }).requestId)) }),
    cancelRequest: async (request) => ({ status: 200, body: await unit((tx) => cancelRequest(tx, config, auth(request).userId, (request.params as { requestId: string }).requestId)) }),
    getPublicRequest: async (request) => {
      const { name, code } = request.params as { name: string; code: string };
      return { status: 200, body: await publicRequest(unit, config, deposits, name, code) };
    },
    payRequestDeposit: async (request) => {
      const { name, code } = request.params as { name: string; code: string };
      return { status: 201, body: await payRequestDeposit(unit, config, deposits, name, code, body<{ token: DepositToken; chain: DepositChain }>(request)) };
    },
    getRequestDeposit: async (request) => {
      const { name, code, depositId } = request.params as { name: string; code: string; depositId: string };
      return { status: 200, body: await requestDeposit(unit, config, deposits, name, code, depositId) };
    },
    getPublicReceipt: async (request) => ({
      status: 200,
      headers: { "cache-control": "public, max-age=30" },
      body: await unit((tx) => publicReceipt(tx, config, (request.params as { payoutId: string }).payoutId)),
    }),

    listSessions: async (request) => ({ status: 200, body: await unit((tx) => listSessions(tx, auth(request).userId, auth(request).familyId, now())) }),
    revokeSession: async (request) => {
      await unit((tx) => revokeSession(tx, auth(request).userId, (request.params as { sessionId: string }).sessionId));
      return { status: 204, body: undefined };
    },
    listPasskeys: async (request) => ({ status: 200, body: await unit((tx) => listPasskeys(tx, auth(request).userId)) }),
    getNotificationSettings: async (request) => ({ status: 200, body: await unit((tx) => notificationSettings(tx, auth(request).userId)) }),
    updateNotificationSettings: async (request) => ({
      status: 200,
      body: await unit((tx) => saveNotificationSettings(tx, auth(request).userId, body<NotificationSettings>(request))),
    }),
    getSetup: async (request) => ({ status: 200, body: await unit((tx) => setup(tx, auth(request).userId)) }),
    listDepositSources: async (request) => ({ status: 200, body: await deposits.sources(unit, auth(request).userId) }),
    estimateDeposit: async (request) => {
      const { token, chain, amount } = request.query as { token?: string; chain?: string; amount?: string };
      const input = { token: token as DepositToken, chain: chain as DepositChain, amount: amount ?? "" };
      return { status: 200, body: await deposits.estimate(unit, auth(request).userId, input) };
    },
    createDeposit: (request) =>
      withIdempotency(unit, auth(request).userId, request, async (tx) => ({
        status: 201,
        body: await deposits.create(tx, auth(request).userId, body<DepositInput>(request)),
      })),
    getDeposit: async (request) => ({
      status: 200,
      body: await deposits.get(unit, auth(request).userId, (request.params as { depositId: string }).depositId),
    }),
    lookupPerson: async (request) => ({
      status: 200,
      body: await unit((tx) => lookupPerson(tx, config, (request.params as { name: string }).name)),
    }),
    listRecentPeople: async (request) => ({ status: 200, body: await unit((tx) => recentPeople(tx, auth(request).userId)) }),

    getPayoutStats: async (request) => {
      const timezone = parseTimezone((request.query as { tz?: string }).tz);
      return {
        status: 200,
        body: await unit(async (tx) => payoutStats(tx, (await currentWorkspace(tx, auth(request).userId)).id, timezone, now())),
      };
    },

    createWorkspace: (request) =>
      withIdempotency(unit, auth(request).userId, request, async (tx) => ({
        status: 201,
        body: await createWorkspace(tx, auth(request).userId, body<any>(request)),
      })),
  };
}
