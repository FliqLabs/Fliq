import type { Prisma } from "@prisma/client";
import { decrypt, encrypt, keyedHash } from "../../../packages/db/src/crypto.js";
import { newId } from "../../../packages/db/src/ids.js";
import { transitionPayout } from "../../../packages/domain/transition.js";
import { InsufficientVaultBalance, postEntry, reserveVault } from "../../../packages/ledger/post.js";
import { orderCommitted, vaultReleased } from "../../../packages/ledger/postings.js";
import { MAX_ORDER_TTL_MS, type VaultClient } from "../../../packages/chains/vault/index.js";
import { ProviderError } from "../../../packages/providers/errors.js";
import type { AccountCheck, Asset, Chain, CreatedOrder, FiatCurrency, ProviderAdapter } from "../../../packages/providers/types.js";
import type { Config } from "./config.js";
import { formatTokenAmount } from "./dashboard.js";
import type { Db, Unit } from "./db.js";
import { ApiError, conflict, invalidRequest, notFound } from "./errors.js";
import { hashOf, type Reply } from "./idempotency.js";
import { institutionType } from "./institutions.js";
import type { OneClickHops } from "./hop.js";
import { isAddressOn } from "./refund-address.js";
import { COUNTRY, developerIdFor, requestQuote, reviveHop, reviveProviderQuote, type QuoteDeps, type QuoteInput } from "./quotes.js";
import { resolveName } from "./recipients.js";
import { recoveryView } from "./recovery.js";

export interface PayoutDeps {
  config: Config;
  adapters: readonly ProviderAdapter[];
  velocity: { maxPerDay: number; maxTokenUnitsPerDay: bigint };
  now: () => Date;
  quotes: QuoteDeps;
  // Present when the deployment can run a NEAR to provider route through 1Click and a vault.
  intents?: IntentsDeps;
}

export interface IntentsDeps {
  hops: OneClickHops;
  vault: VaultClient;
  // Registers the 1Click deposit address on the vault's token, without which the vault's transfer to it fails.
  tokenStorage: { ensure(accountId: string): Promise<unknown> };
  // Spec 10.1: the hop may cost this much more than quoted before the payout is stopped and re-quoted.
  guardBps: bigint;
  // The 1Click deadline is the provider address validity minus this margin.
  deadlineMarginMs: number;
}

export const DEFAULT_GUARD_BPS = 30n;
export const DEFAULT_DEADLINE_MARGIN_MS = 5 * 60_000;
const DEFAULT_ADDRESS_VALIDITY_MS = 15 * 60_000;

export const DEFAULT_VELOCITY = { maxPerDay: 200, maxTokenUnitsPerDay: 50_000_000_000n };

export interface PayoutInput {
  quote_id: string;
  account: { bank: string; number: string };
  client_reference?: string;
  refund_address?: string;
  account_name?: string;
  retry_of?: string;
}

const IN_PROGRESS = 202;
const ACCOUNT_NUMBER = /^[0-9]{6,20}$/;

async function lockKey(tx: Db, scope: string, key: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope}:${key}`}, 0))`;
}

async function replayOf(tx: Db, scope: string, key: string, requestHash: string): Promise<Reply | null> {
  const stored = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
  if (!stored) return null;
  if (stored.requestHash !== requestHash) {
    throw new ApiError(422, "idempotency_mismatch", "This Idempotency-Key was used with a different request.");
  }
  if (stored.responseStatus === IN_PROGRESS) throw conflict("This request is still being processed. Retry shortly.");
  return { status: stored.responseStatus, body: stored.responseBody };
}

// An unknown outcome is held and re-queried, never guessed. Only a definite rejection fails the payout.
function isDefiniteRejection(error: unknown): boolean {
  return error instanceof ProviderError && error.kind === "rejected";
}

// The provider's fiat reference arrives on its settled webhook and is kept on that event.
export function bankReference(events: readonly { toState: string; detail: Prisma.JsonValue }[]): string | null {
  const detail = events.find((event) => event.toState === "settled")?.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  const reference = detail.fiat_reference;
  return typeof reference === "string" ? reference : null;
}

export async function payoutView(tx: Db, config: Config, payoutId: string) {
  const payout = await tx.payout.findUniqueOrThrow({
    where: { id: payoutId },
    include: {
      recipient: true,
      events: { orderBy: { version: "asc" } },
      retries: { select: { id: true, createdAt: true } },
      claims: true,
    },
  });
  const quote = await tx.quote.findUniqueOrThrow({ where: { id: payout.quoteId } });
  const route = quote.chosenRouteId ? await tx.quoteRoute.findUnique({ where: { id: quote.chosenRouteId } }) : null;
  const at = (state: string) => payout.events.find((event) => event.toState === state)?.createdAt;
  const settledAt = at("settled");
  const depositAt = at("deposit_seen");
  const fees = {
    provider: Number(route?.feeProvider ?? 0n),
    network: Number(route?.feeNetwork ?? 0n),
    total: Number((route?.feeProvider ?? 0n) + (route?.feeNetwork ?? 0n) + (route?.feeIntents ?? 0n) + (route?.feeOurs ?? 0n)),
  };
  return {
    payout_id: payout.id,
    state: payout.state,
    account_name: decrypt(payout.recipient.nameCipher, config.dataKey),
    account: { bank: payout.recipient.institutionCode, number: decrypt(payout.recipient.accountCipher, config.dataKey) },
    amount: formatTokenAmount(payout.amountIn),
    receive: Number(payout.amountOutMinor / 100n),
    currency: payout.currency,
    rate: Number(payout.rate),
    fees,
    provider: payout.provider,
    // Empty until the provider confirms the order and says where the sender pays.
    deposit: {
      chain: payout.depositChain ?? "",
      address: payout.depositAddress ?? "",
      amount: formatTokenAmount(payout.depositUnits ?? payout.amountIn),
    },
    provider_order: payout.providerOrderId,
    vault_receipt: payout.routeKind === "intents" && payout.depositChain === "near" ? payout.id : null,
    bank_reference: bankReference(payout.events),
    seconds: settledAt && depositAt ? Math.round((settledAt.getTime() - depositAt.getTime()) / 1000) : null,
    history: payout.events.map((event) => ({ state: event.toState, at: event.createdAt.toISOString() })),
    agent: payout.agentId ? { agent_id: payout.agentId, name: (await tx.agent.findUnique({ where: { id: payout.agentId }, select: { name: true } }))?.name ?? payout.agentId } : null,
    ...recoveryView(payout, bankReference(payout.events)),
  };
}

export async function getPayout(unit: Unit, config: Config, userId: string, payoutId: string) {
  return unit(async (tx) => {
    const found = await tx.payout.findFirst({ where: { id: payoutId, developerId: await developerIdFor(tx, userId) }, select: { id: true } });
    if (!found) throw notFound("No such payout.");
    return payoutView(tx, config, payoutId);
  });
}

export async function createPayout(unit: Unit, deps: PayoutDeps, userId: string, key: string | undefined, input: PayoutInput, options: { agentId?: string } = {}): Promise<Reply> {
  if (!key) throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required.");
  if (!ACCOUNT_NUMBER.test(input.account.number)) throw invalidRequest("account.number must be 6 to 20 digits.");
  const requestHash = hashOf(input);

  const replay = await unit((tx) => replayOf(tx, userId, key, requestHash));
  if (replay) return replay;

  const prepared = await unit(async (tx) => {
    const developerId = await developerIdFor(tx, userId);
    const quote = await tx.quote.findFirst({ where: { id: input.quote_id, developerId }, include: { routes: { where: { rank: 1 } } } });
    const route = quote?.routes[0];
    if (!quote || !route?.providerQuote) throw notFound("No such quote.");
    if (quote.expiresAt <= deps.now()) throw new ApiError(422, "quote_expired", "This quote has expired. Request a new one.");
    const user = await tx.user.findUnique({ where: { id: userId } });
    const intents = route.kind === "intents";
    if (intents && !user?.nearAccount) throw invalidRequest("Claim a fliq name before paying from your vault.");
    const payer = user?.nearAccount ?? null;
    const hop = reviveHop(route.providerQuote);
    const refundAddress = intents ? intentsRefundAddress(deps.config, hop?.chain) : directRefundAddress(quote.sourceChain, input.refund_address, payer);
    return { developerId, quote, route, payer, refundAddress, intents, hop };
  });

  const adapter = deps.adapters.find((candidate) => candidate.id === prepared.route.provider);
  if (!adapter) throw new ApiError(422, "no_route", "That provider is not available right now.");
  const country = COUNTRY[prepared.quote.currency as keyof typeof COUNTRY];
  const verification = await adapter.verifyAccount({ institutionCode: input.account.bank, accountNumber: input.account.number, country }).catch((error: unknown) => {
    if (!(error instanceof ProviderError)) throw error;
    if (error.kind === "not_supported") throw new ApiError(422, "route_unavailable", "The provider on this route cannot check or pay this account.");
    // A bank that does not answer in time is not a missing account: nothing has moved, so the payer can simply retry.
    if (error.transient) throw new ApiError(422, "route_unavailable", "The bank did not answer in time. Nothing moved; try again in a moment.");
    throw new ApiError(422, "account_not_found", "The bank could not find that account.");
  });
  if (!verification.found) throw new ApiError(422, "account_not_found", "The bank could not find that account.");
  const bankName = verification.accountName ?? (await nameFromOtherProviders(deps.adapters, adapter, { institutionCode: input.account.bank, accountNumber: input.account.number, country }));
  const accountName = resolveName(bankName, input.account_name).name;

  // Phase one: everything that must exist before the provider is called, committed together.
  const committed = await unit(async (tx) => {
    await lockKey(tx, userId, key);
    const again = await replayOf(tx, userId, key, requestHash);
    if (again) return { kind: "replayed" as const, reply: again };
    const { quote, route, developerId } = prepared;
    if (quote.expiresAt <= deps.now()) throw new ApiError(422, "quote_expired", "This quote has expired. Request a new one.");

    // A quote funds one payout. The lock stops two requests with different keys from both claiming it.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`quote:${quote.id}`}, 0))`;
    if (await tx.payout.findFirst({ where: { quoteId: quote.id }, select: { id: true } })) throw conflict("This quote was already used.");

    // Per developer and held by a lock, so concurrent requests cannot each slip under the limit.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`velocity:${developerId}`}, 0))`;
    const dayStart = new Date(Date.UTC(deps.now().getUTCFullYear(), deps.now().getUTCMonth(), deps.now().getUTCDate()));
    const today = await tx.payout.aggregate({ where: { developerId, createdAt: { gte: dayStart } }, _count: true, _sum: { amountIn: true } });
    if (today._count >= deps.velocity.maxPerDay || (today._sum.amountIn ?? 0n) + route.amountIn > deps.velocity.maxTokenUnitsPerDay) {
      throw new ApiError(422, "velocity_limit", "Daily payout limit reached for this account.");
    }

    if (input.retry_of) {
      const original = await tx.payout.findFirst({ where: { id: input.retry_of, developerId }, select: { state: true } });
      if (!original) throw notFound("No such payout to retry.");
      if (!["refunded", "failed", "expired"].includes(original.state)) throw conflict("Only a refunded, failed or expired payout can be tried again.");
    }

    const payoutId = newId("po");
    const clientReference = input.client_reference ?? payoutId;
    if (await tx.payout.findUnique({ where: { developerId_clientReference: { developerId, clientReference } }, select: { id: true } })) {
      throw conflict("client_reference was already used.");
    }

    const lookupHash = keyedHash(`${input.account.bank}:${input.account.number}`, deps.config.hashKey);
    const existing = await tx.recipient.findUnique({ where: { userId_lookupHash: { userId, lookupHash } } });
    const recipientId =
      existing?.id ??
      (
        await tx.recipient.create({
          data: {
            id: newId("rcp"),
            userId,
            institutionCode: input.account.bank,
            accountCipher: encrypt(input.account.number, deps.config.dataKey),
            nameCipher: encrypt(accountName, deps.config.dataKey),
            lookupHash,
          },
        })
      ).id;

    await tx.payout.create({
      data: {
        id: payoutId,
        developerId,
        clientReference,
        quoteId: quote.id,
        recipientId,
        routeKind: route.kind,
        provider: route.provider,
        state: "created",
        amountIn: route.amountIn,
        amountOutMinor: route.amountOutMinor,
        currency: quote.currency,
        rate: quote.rate,
        retryOfId: input.retry_of ?? null,
        agentId: options.agentId ?? null,
      },
    });
    await tx.payoutEvent.create({ data: { id: newId("pev"), payoutId, fromState: null, toState: "created", version: 1, cause: "created" } });

    const providerQuote = reviveProviderQuote(route.providerQuote);
    await postEntry(
      tx,
      orderCommitted(
        { payoutId, provider: route.provider, asset: quote.tokenSymbol as Asset, gross: route.amountIn, routingFee: route.amountIn - (prepared.hop ? prepared.hop.amountIn : providerQuote.sendUnits), networkFee: 0n },
        { quote: quote.id, provider: route.provider, currency: quote.currency, expectedOutMinor: Number(route.amountOutMinor) },
      ),
    );
    await tx.idempotencyRecord.create({ data: { scope: userId, key, requestHash, responseStatus: IN_PROGRESS, responseBody: { payout_id: payoutId } } });
    return { kind: "committed" as const, payoutId, providerQuote };
  });
  if (committed.kind === "replayed") return committed.reply;

  // Phase two: the provider call, only after the commitment is durable.
  const { payoutId, providerQuote } = committed;
  const corridor = { country, currency: prepared.quote.currency.toUpperCase() as FiatCurrency, payoutType: institutionType(input.account.bank) };
  const asset = prepared.quote.tokenSymbol as Asset;

  const opened = await openOrder({
    deps,
    unit,
    adapter,
    userId,
    payoutId,
    providerQuote,
    corridor,
    asset,
    prepared,
    recipient: { institutionCode: input.account.bank, accountNumber: input.account.number, accountName },
    ...(options.agentId ? { agentId: options.agentId } : {}),
  });

  return unit(async (tx) => {
    const reply = await settle(tx, deps, { userId, input, payoutId, prepared, opened });
    await tx.idempotencyRecord.update({
      where: { scope_key: { scope: userId, key } },
      data: { responseStatus: reply.status, responseBody: reply.body as object },
    });
    return reply;
  });
}

// Some providers can pay an account but cannot tell whose it is. A bank name is the same whichever provider reads it
// (NIP in Nigeria), so another provider's answer confirms it; failing that, the sender types the name.
async function nameFromOtherProviders(adapters: readonly ProviderAdapter[], chosen: ProviderAdapter, check: AccountCheck): Promise<string | null> {
  for (const other of adapters) {
    if (other === chosen) continue;
    const found = await other.verifyAccount(check).catch(() => null);
    if (found?.found && found.accountName) return found.accountName;
  }
  return null;
}

// An Intents payout funds the provider on the hop's network, so the provider refunds there, to the address fliq keeps
// on that network. The 1Click leg refunds on NEAR to the vault instead (see openHop). Without an address for the
// network the payout is refused before any provider order exists.
function intentsRefundAddress(config: Config, chain: string | undefined): string {
  const address = chain ? config.providerRefundAddresses[chain] : undefined;
  if (!chain || !address) {
    console.warn(`[payouts] no provider refund address for ${chain ?? "an unknown network"}: set PROVIDER_REFUND_ADDRESS_${(chain ?? "").toUpperCase()}`);
    throw new ApiError(422, "route_unavailable", "That route is not available right now. Try again.");
  }
  return address;
}

// A direct payout is funded on the quote's source network, so its refund address must be one there too.
function directRefundAddress(chain: string, requested: string | undefined, payer: string | null): string {
  const address = requested ?? (chain === "near" ? payer : null);
  if (!address) throw invalidRequest(`refund_address is required for a payout funded on ${chain}.`);
  if (!isAddressOn(chain, address)) throw invalidRequest(`refund_address must be an address on ${chain}.`);
  return address;
}

type Prepared = {
  quote: { id: string; currency: string; tokenSymbol: string; sourceChain: string; mode: string; amountIn: bigint; amountOutMinor: bigint };
  route: { provider: string; amountIn: bigint };
  payer: string | null;
  refundAddress: string;
  intents: boolean;
  hop: ReturnType<typeof reviveHop>;
};

type Deposit = { chain: string; address: string; units: bigint; validUntil: Date | null; memo: string | null };

type Opened =
  | { kind: "ready"; order: CreatedOrder; deposit: Deposit }
  | { kind: "unknown" }
  | { kind: "rejected" }
  | { kind: "quote_changed" }
  | { kind: "route_unavailable" }
  | { kind: "insufficient_balance"; order: CreatedOrder | null };

interface OpenInput {
  deps: PayoutDeps;
  unit: Unit;
  adapter: ProviderAdapter;
  userId: string;
  payoutId: string;
  providerQuote: ReturnType<typeof reviveProviderQuote>;
  corridor: { country: ReturnType<typeof countryFor>; currency: FiatCurrency; payoutType: "bank" | "mobile_money" };
  asset: Asset;
  prepared: Prepared;
  recipient: { institutionCode: string; accountNumber: string; accountName: string };
  agentId?: string;
}

const countryFor = (currency: string) => COUNTRY[currency as keyof typeof COUNTRY];

async function openOrder(input: OpenInput): Promise<Opened> {
  const { deps, unit, adapter, payoutId, providerQuote, corridor, asset, prepared, recipient } = input;
  const intents = prepared.intents ? deps.intents : undefined;
  if (prepared.intents && (!intents || !prepared.hop)) return { kind: "route_unavailable" };

  // Fail before any provider order exists when the vault cannot cover the payout.
  if (intents && (await intents.vault.getBalance(prepared.payer as string)).available < prepared.route.amountIn) {
    return { kind: "insufficient_balance", order: null };
  }

  let order: CreatedOrder;
  try {
    order = await adapter.createOrder({
      payoutId,
      quote: providerQuote,
      corridor,
      source: { asset, chain: (prepared.hop?.chain ?? prepared.quote.sourceChain) as Chain },
      recipient,
      refundAddress: prepared.refundAddress,
      sender: { pseudonym: keyedHash(`sender:${input.userId}`, deps.config.hashKey).toString("hex") },
    });
  } catch (error) {
    logProviderFailure(payoutId, error);
    return isDefiniteRejection(error) ? { kind: "rejected" } : { kind: "unknown" };
  }

  const funding = order.funding;
  if (!intents || !prepared.hop) {
    return {
      kind: "ready",
      order,
      deposit:
        funding.kind === "deposit_address"
          ? { chain: funding.chain, address: funding.address, units: funding.units, validUntil: funding.validUntil ?? null, memo: funding.memo ?? null }
          : { chain: "internal", address: "prefunded", units: funding.units, validUntil: null, memo: null },
    };
  }
  if (funding.kind !== "deposit_address") return { kind: "route_unavailable" };
  return openHop({ ...input, intents, hop: prepared.hop, order, funding });
}

// Enough to tell why a provider refused an order, without the recipient's account number or any credential.
function logProviderFailure(payoutId: string, error: unknown): void {
  if (!(error instanceof ProviderError)) return console.error(`[payouts] ${payoutId} createOrder failed: ${(error as Error)?.name ?? "error"}`);
  const status = error.httpStatus === undefined ? "" : ` http ${error.httpStatus}`;
  const reason = error.reason ? `: ${error.reason}` : "";
  console.error(`[payouts] ${payoutId} ${error.provider} ${error.operation} ${error.kind}${status}${reason}`);
}

async function openHop(
  input: OpenInput & { intents: IntentsDeps; hop: NonNullable<Prepared["hop"]>; order: CreatedOrder; funding: Extract<CreatedOrder["funding"], { kind: "deposit_address" }> },
): Promise<Opened> {
  const { deps, unit, payoutId, asset, prepared, intents, hop, order, funding } = input;
  const payer = prepared.payer as string;
  const now = deps.now();
  const validUntil = funding.validUntil ?? new Date(now.getTime() + DEFAULT_ADDRESS_VALIDITY_MS);
  const deadline = new Date(Math.min(validUntil.getTime() - intents.deadlineMarginMs, now.getTime() + MAX_ORDER_TTL_MS));
  if (deadline <= now) return { kind: "route_unavailable" };

  let swap;
  try {
    swap = await intents.hops.depositQuote({
      asset,
      from: prepared.quote.sourceChain as Chain,
      to: hop.chain,
      amountOut: funding.units,
      recipient: funding.address,
      // A swap that cannot complete is refunded on NEAR, into the vault, which holds it until recredit returns it.
      refundTo: deps.config.vaultAccount,
      deadline,
    });
  } catch {
    return { kind: "route_unavailable" };
  }
  if (!swap.depositAddress) return { kind: "route_unavailable" };
  // The re-quote guard: what the hop needs now against what it was priced at when the quote was made.
  if (swap.minAmountIn * 10_000n > hop.amountIn * (10_000n + intents.guardBps)) return { kind: "quote_changed" };

  const deposit: Deposit = { chain: "near", address: swap.depositAddress, units: swap.amountIn, validUntil: deadline, memo: swap.depositMemo ?? null };
  try {
    await intents.tokenStorage.ensure(deposit.address);
  } catch {
    return { kind: "route_unavailable" };
  }
  try {
    await unit((tx) => reserveVault(tx, payoutId, payer, asset, deposit.units));
  } catch (error) {
    if (error instanceof InsufficientVaultBalance) return { kind: "insufficient_balance", order };
    throw error;
  }
  try {
    await intents.vault.registerOrder({
      orderId: payoutId,
      payer,
      depositAddress: deposit.address,
      amount: deposit.units,
      expiresAtNs: BigInt(deadline.getTime()) * 1_000_000n,
      corridor: `${input.corridor.country}-${input.corridor.currency}-${input.corridor.payoutType}`,
      ...(input.agentId ? { agentId: input.agentId } : {}),
    });
  } catch {
    // The reservation was committed first, so a refused registration must give the funds back.
    await unit((tx) => postEntry(tx, vaultReleased(payoutId, payer, asset, deposit.units)));
    return { kind: "route_unavailable" };
  }
  return { kind: "ready", order, deposit };
}

async function settle(
  tx: Db,
  deps: PayoutDeps,
  context: { userId: string; input: PayoutInput; payoutId: string; prepared: Prepared; opened: Opened },
): Promise<Reply> {
  const { userId, payoutId, prepared, opened } = context;
  const fail = async (reason: string, status: number, body: unknown): Promise<Reply> => {
    await tx.payout.update({ where: { id: payoutId }, data: { failureReason: reason } });
    await transitionPayout(tx, { payoutId, target: "failed", cause: reason });
    return { status, body };
  };

  switch (opened.kind) {
    case "ready": {
      const { order, deposit } = opened;
      await tx.payout.update({
        where: { id: payoutId },
        data: {
          providerOrderId: order.providerOrderId,
          depositChain: deposit.chain,
          depositAddress: deposit.address,
          depositUnits: deposit.units,
          depositValidUntil: deposit.validUntil,
          depositMemo: deposit.memo,
        },
      });
      await transitionPayout(tx, { payoutId, target: "awaiting_deposit", cause: "order_created", detail: { provider: prepared.route.provider } });
      return { status: 201, body: await payoutView(tx, deps.config, payoutId) };
    }
    case "rejected":
      return fail("provider_rejected", 422, { error: { code: "provider_rejected", message: "The provider rejected this payout." } });
    case "route_unavailable":
      return fail("route_unavailable", 422, { error: { code: "route_unavailable", message: "That route is not available right now. Try again." } });
    case "insufficient_balance":
      return fail("insufficient_vault_balance", 422, { error: { code: "insufficient_balance", message: "Not enough free balance in your vault." } });
    case "quote_changed": {
      const fresh = await requestQuote(tx, deps.quotes, userId, requestOf(prepared));
      return fail("quote_changed", 409, { error: { code: "quote_changed", message: "The rate moved. Nothing was sent." }, quote: fresh });
    }
    case "unknown":
      await transitionPayout(tx, { payoutId, target: "provider_timeout", cause: "create_order_unknown" });
      return { status: 201, body: await payoutView(tx, deps.config, payoutId) };
  }
}

// The same request again, so the caller gets a fresh quote to confirm.
function requestOf(prepared: Prepared): QuoteInput {
  const receive = prepared.quote.mode === "receive_exactly";
  return {
    token: prepared.quote.tokenSymbol.toLowerCase() as QuoteInput["token"],
    currency: prepared.quote.currency as QuoteInput["currency"],
    amount: receive ? String(prepared.quote.amountOutMinor / 100n) : formatTokenAmount(prepared.quote.amountIn),
    mode: receive ? "receive" : "send",
    source_chain: prepared.quote.sourceChain,
  };
}
