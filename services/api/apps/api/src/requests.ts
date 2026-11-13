import { randomBytes } from "node:crypto";
import type { PaymentRequest, VaultDeposit } from "@prisma/client";
import { newId } from "../../../packages/db/src/ids.js";
import type { Config } from "./config.js";
import type { Db, Unit } from "./db.js";
import { depositView, formatUnits, formatUsd, parseUnits, type DepositChain, type Deposits, type DepositToken } from "./deposits.js";
import { conflict, invalidRequest, notFound } from "./errors.js";

const USDC_DECIMALS = 6;
const MAX_NOTE = 120;
// A request is in dollars, so only dollar tokens can pay it: a BTC deposit would land as some other amount.
const DOLLAR_TOKENS = new Set(["usdc", "usdt"]);

export interface RequestInput {
  amount: string;
  note: string;
  cash_out_on_arrival: boolean;
}

export function requestView(config: Config, label: string, row: PaymentRequest) {
  return {
    request_id: row.id,
    code: row.code,
    link: `${config.payLinkBase}/${label}/${row.code}`,
    amount: formatUnits(row.amountUnits, USDC_DECIMALS),
    note: row.note,
    state: row.state,
    cash_out_on_arrival: row.cashOutOnArrival,
    created_at: row.createdAt.toISOString(),
    paid: row.paidAt
      ? {
          paid_at: row.paidAt.toISOString(),
          payer: row.payer,
          token: row.paidToken ?? "USDC",
          chain: row.paidChain ?? "near",
          amount: row.paidAmount ?? formatUnits(row.landedUnits ?? row.amountUnits, USDC_DECIMALS),
          fee: formatUsd(row.feeMicroUsd ?? 0n),
          landed: formatUnits(row.landedUnits ?? row.amountUnits, USDC_DECIMALS),
          deposit_id: row.depositId,
        }
      : null,
  };
}

async function payee(tx: Db, config: Config, userId: string) {
  const user = await tx.user.findUnique({ where: { id: userId }, select: { nearAccount: true } });
  if (!user?.nearAccount) throw notFound("Claim a fliq name to get paid.");
  return { account: user.nearAccount, label: user.nearAccount.replace(`.${config.nearRootAccount}`, "") };
}

export async function createRequest(tx: Db, config: Config, userId: string, input: RequestInput) {
  const { label } = await payee(tx, config, userId);
  const units = parseUnits(input.amount, USDC_DECIMALS);
  if (units === null || units < 10_000n) throw invalidRequest("amount must be at least 0.01 dollars.");
  const note = input.note.trim();
  if (note.length > MAX_NOTE) throw invalidRequest(`note must be at most ${MAX_NOTE} characters.`);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = randomBytes(2).toString("hex");
    if (await tx.paymentRequest.findUnique({ where: { userId_code: { userId, code } }, select: { id: true } })) continue;
    const row = await tx.paymentRequest.create({
      data: { id: newId("req"), userId, code, amountUnits: units, note, cashOutOnArrival: input.cash_out_on_arrival },
    });
    return requestView(config, label, row);
  }
  throw conflict("Could not make a unique link; try again.");
}

export async function listRequests(tx: Db, config: Config, userId: string) {
  const { label } = await payee(tx, config, userId);
  const rows = await tx.paymentRequest.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 100 });
  return { items: rows.map((row) => requestView(config, label, row)) };
}

async function owned(tx: Db, userId: string, requestId: string) {
  const row = await tx.paymentRequest.findFirst({ where: { id: requestId, userId } });
  if (!row) throw notFound("No such request.");
  return row;
}

export async function getRequest(tx: Db, config: Config, userId: string, requestId: string) {
  const { label } = await payee(tx, config, userId);
  return requestView(config, label, await owned(tx, userId, requestId));
}

export async function cancelRequest(tx: Db, config: Config, userId: string, requestId: string) {
  const { label } = await payee(tx, config, userId);
  const row = await owned(tx, userId, requestId);
  if (row.state !== "open") throw conflict(`This request is already ${row.state}.`);
  return requestView(config, label, await tx.paymentRequest.update({ where: { id: row.id }, data: { state: "cancelled" } }));
}

// The pay link names the payee by label and the request by code; a wrong pair is simply not found.
export async function findPublic(tx: Db, config: Config, label: string, code: string) {
  const user = await tx.user.findUnique({
    where: { nearAccount: `${label.toLowerCase()}.${config.nearRootAccount}` },
    select: { id: true, nearAccount: true, displayName: true, photoUrl: true },
  });
  const request = user ? await tx.paymentRequest.findUnique({ where: { userId_code: { userId: user.id, code: code.toLowerCase() } } }) : null;
  if (!user || !request) throw notFound("No such request.");
  return { user, request };
}

export async function publicRequest(unit: Unit, config: Config, deposits: Deposits, label: string, code: string) {
  const { user, request } = await unit((tx) => findPublic(tx, config, label, code));
  const { sources } = await deposits.sources(unit, user.id);
  return {
    near_account: user.nearAccount as string,
    display_name: user.displayName,
    photo_url: user.photoUrl,
    amount: formatUnits(request.amountUnits, USDC_DECIMALS),
    note: request.note,
    state: request.state,
    sources: sources.filter((source) => DOLLAR_TOKENS.has(source.token)),
  };
}

// A payer who asks again for the same chain gets the address already watching for them, not a new one each time.
export async function payRequestDeposit(unit: Unit, config: Config, deposits: Deposits, label: string, code: string, input: { token: DepositToken; chain: DepositChain }) {
  if (!DOLLAR_TOKENS.has(input.token)) throw invalidRequest("This request is in dollars; pay it with USDC or USDT.");
  return unit(async (tx) => {
    const { user, request } = await findPublic(tx, config, label, code);
    if (request.state !== "open") throw conflict(`This request is ${request.state}.`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`request:${request.id}`}, 0))`;
    const open = await tx.vaultDeposit.findFirst({
      where: { requestId: request.id, token: input.token, chain: input.chain, state: "waiting", reservedUntil: { gt: new Date() } },
      orderBy: { createdAt: "desc" },
    });
    if (open) return depositView(open);
    const created = await deposits.create(tx, user.id, { ...input, amount: formatUnits(request.amountUnits, USDC_DECIMALS) });
    return depositView(await tx.vaultDeposit.update({ where: { id: created.deposit_id }, data: { requestId: request.id } }));
  });
}

export async function requestDeposit(unit: Unit, config: Config, deposits: Deposits, label: string, code: string, depositId: string) {
  const { user, request } = await unit((tx) => findPublic(tx, config, label, code));
  const owner = await unit((tx) => tx.vaultDeposit.findFirst({ where: { id: depositId, requestId: request.id }, select: { id: true } }));
  if (!owner) throw notFound("No such payment.");
  return deposits.get(unit, user.id, depositId);
}

// Called inside the transaction that lands the deposit, so a request is marked paid exactly once.
export async function markRequestPaid(tx: Db, deposit: VaultDeposit): Promise<void> {
  if (!deposit.requestId || deposit.landedUnits === null) return;
  await tx.paymentRequest.updateMany({
    where: { id: deposit.requestId, state: "open" },
    data: {
      state: "paid",
      paidAt: deposit.landedAt ?? new Date(),
      depositId: deposit.id,
      paidToken: deposit.token.toUpperCase(),
      paidChain: deposit.chain,
      paidAmount: formatUnits(deposit.receivedUnits ?? deposit.amountUnits, deposit.decimals),
      feeMicroUsd: deposit.feeMicroUsd,
      landedUnits: deposit.landedUnits,
    },
  });
}
