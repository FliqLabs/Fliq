import type { FastifyRequest } from "fastify";
import { newId } from "../../../packages/db/src/ids.js";
import type { VaultClient } from "../../../packages/chains/vault/index.js";
import type { Config } from "./config.js";
import type { Unit } from "./db.js";
import { ApiError, conflict, invalidRequest } from "./errors.js";
import type { Reply } from "./idempotency.js";
import type { Rate } from "./rates.js";

export const PAID_API_AMOUNT = 10_000n;
export const PAID_API_SERVICE = "Live Naira Rate";
export const PAID_API_CORRIDOR = "API";
export const PAID_API_PAYMENT_HEADER = "x-fliq-payment";

export interface AgentPaymentDeps {
  config: Config;
  unit: Unit;
  vault: VaultClient;
  rate: (token: string, currency: string) => Promise<Rate>;
  now?: () => Date;
  pollMs?: number;
  timeoutMs?: number;
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function liveRate(deps: AgentPaymentDeps) {
  return deps.rate("usdc", "ngn");
}

export function createPaidApiHandler(deps: AgentPaymentDeps) {
  return async (request: FastifyRequest): Promise<Reply> => {
    const auth = request.auth;
    if (!auth?.agentId) throw invalidRequest("This demo endpoint requires an agent signature.");

    const headerValue = request.headers[PAID_API_PAYMENT_HEADER];
    const payment = typeof headerValue === "string" ? headerValue.trim() : "";

    if (!payment) {
      const registered = await deps.unit(async (tx) => {
        const agent = await tx.agent.findUnique({ where: { id: auth.agentId ?? "" } });
        const user = await tx.user.findUnique({ where: { id: auth.userId }, select: { nearAccount: true } });
        if (!agent || agent.userId !== auth.userId || !user?.nearAccount) {
          throw invalidRequest("The signed agent is not connected to a vault owner.");
        }
        const orderId = newId("api");
        const now = deps.now?.() ?? new Date();
        const expiresAtNs = BigInt(now.getTime()) * 1_000_000n + 15n * 60n * 1_000n * 1_000n * 1_000n;
        await deps.vault.registerOrder({
          orderId,
          payer: user.nearAccount,
          depositAddress: deps.config.agentApiPayToAddress,
          amount: PAID_API_AMOUNT,
          expiresAtNs,
          corridor: PAID_API_CORRIDOR,
          agentId: auth.agentId,
        });
        await tx.paidApiOrder.create({
          data: {
            id: newId("apo"),
            orderId,
            userId: auth.userId,
            agentId: auth.agentId!,
            payer: user.nearAccount,
            payToAddress: deps.config.agentApiPayToAddress,
            amountUnits: PAID_API_AMOUNT,
            expiresAtNs,
          },
        });
        return { orderId, expiresAtNs };
      });
      const rate = await liveRate(deps);
      return {
        status: 402,
        body: {
          error: { code: "payment_required", message: "Pay 1 USDC cent from the vault, then retry." },
          price: PAID_API_AMOUNT.toString(),
          token_contract: deps.config.usdcContract,
          vault_account: deps.config.vaultAccount,
          pay_to_address: deps.config.agentApiPayToAddress,
          order_id: registered.orderId,
          expires_at_ns: registered.expiresAtNs.toString(),
          payment_header: PAID_API_PAYMENT_HEADER,
          payment_method: "payout(order_id, amount, deposit_address)",
          live_rate_preview: rate,
        },
      };
    }

    const order = await deps.unit((tx) =>
      tx.paidApiOrder.findFirst({
        where: {
          userId: auth.userId,
          agentId: auth.agentId ?? "",
          OR: [{ orderId: payment }, { txHash: payment }],
        },
      }),
    );
    if (!order)
      throw invalidRequest("The payment order or transaction hash was not registered by this agent.");
    if (order.consumedAt) throw conflict("This payment order has already been used.");
    if (BigInt(order.expiresAtNs) <= BigInt((deps.now?.() ?? new Date()).getTime()) * 1_000_000n) {
      throw invalidRequest("This payment order has expired.");
    }

    const pollMs = deps.pollMs ?? 250;
    const timeoutMs = deps.timeoutMs ?? 5_000;
    const started = Date.now();
    let receipt = await deps.vault.getReceipt(order.orderId);
    while ((!receipt || receipt.transferState !== "dispatched") && Date.now() - started < timeoutMs) {
      await wait(pollMs);
      receipt = await deps.vault.getReceipt(order.orderId);
    }
    if (!receipt)
      throw new ApiError(
        503,
        "payment_unconfirmed",
        "The payout receipt is not available; retry the same request.",
      );
    if (receipt.transferState === "registered")
      throw new ApiError(402, "payment_required", "This order has not been paid. Retry after payout.");
    if (receipt.transferState !== "dispatched")
      throw new ApiError(202, "payment_pending", "The payout callback is pending; retry the same request.");
    if (receipt.amount !== PAID_API_AMOUNT || receipt.depositAddress !== deps.config.agentApiPayToAddress) {
      throw invalidRequest("The payout amount or destination does not match this payment order.");
    }

    const consumed = await deps.unit(async (tx) => {
      const updated = await tx.paidApiOrder.updateMany({
        where: { orderId: order.orderId, consumedAt: null },
        data: { consumedAt: new Date(), txHash: payment.startsWith("tx-") ? payment : order.txHash },
      });
      if (updated.count !== 1) return false;
      await tx.paidApiCall.create({
        data: {
          id: newId("apc"),
          orderId: order.orderId,
          userId: auth.userId,
          agentId: auth.agentId!,
          service: PAID_API_SERVICE,
          amountUnits: PAID_API_AMOUNT,
          txHash: payment.startsWith("tx-") ? payment : order.txHash,
        },
      });
      return true;
    });
    if (!consumed) throw conflict("This payment order has already been used.");

    return { status: 200, body: await liveRate(deps) };
  };
}
