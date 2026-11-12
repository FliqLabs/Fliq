import { createPublicClient, createWalletClient, erc20Abi, http, type Address, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import type { VaultClient } from "../../../packages/chains/vault/index.js";
import type { Db, Unit } from "./db.js";

// USDC on Base, the token Paycrest is funded with.
export const BASE_USDC: Address = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
// Kept free on top of every payout the float is promised to, so a fee change or a rounding never leaves it short.
export const FLOAT_MARGIN_UNITS = 100_000n;
// About ten USDC transfers on Base. Below this the float is left alone and payouts take the 1Click path.
export const MIN_FLOAT_ETH_WEI = 10_000_000_000_000n;
// A float payout waits at most this long for the vault to pay; after it the order has expired anyway.
const WATCH_WINDOW_MS = 24 * 60 * 60_000;
// The provider is still waiting for funds in these states.
const OPEN_STATES = ["awaiting_deposit", "deposit_seen", "routing", "with_provider"] as const;

// Thrown when the transfer was refused before it was broadcast, so the same payout can safely be tried again.
export class FloatNotSent extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "FloatNotSent";
  }
}

export interface FloatWallet {
  address: string;
  balances(): Promise<{ usdc: bigint; eth: bigint }>;
  // Resolves with the transaction hash once broadcast. Throws FloatNotSent when nothing was broadcast.
  transferUsdc(to: string, units: bigint): Promise<string>;
}

export function floatFromEnv(env: NodeJS.ProcessEnv): FloatWallet | null {
  const key = env.FLOAT_BASE_PRIVATE_KEY?.trim();
  if (!key) return null;
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.warn("FLOAT_BASE_PRIVATE_KEY is not a 0x-prefixed 32 byte hex key: the Base float is off.");
    return null;
  }
  return viemFloat(key as Hex, env.FLOAT_BASE_RPC_URL?.trim() || "https://mainnet.base.org");
}

function viemFloat(key: Hex, rpcUrl: string): FloatWallet {
  const account = privateKeyToAccount(key);
  const transport = http(rpcUrl, { timeout: 15_000 });
  const reader = createPublicClient({ chain: base, transport });
  const writer = createWalletClient({ account, chain: base, transport });
  return {
    address: account.address,
    async balances() {
      const [usdc, eth] = await Promise.all([
        reader.readContract({
          address: BASE_USDC,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [account.address],
        }),
        reader.getBalance({ address: account.address }),
      ]);
      return { usdc, eth };
    },
    async transferUsdc(to, units) {
      let request;
      try {
        ({ request } = await reader.simulateContract({
          account,
          address: BASE_USDC,
          abi: erc20Abi,
          functionName: "transfer",
          args: [to as Address, units],
        }));
      } catch (error) {
        throw new FloatNotSent((error as Error).name);
      }
      return writer.writeContract(request);
    },
  };
}

// USDC the float has already promised to payouts it has not paid yet.
async function promised(tx: Db, since: Date): Promise<bigint> {
  const open = await tx.payout.findMany({
    where: {
      floatTarget: { not: null },
      floatTxHash: null,
      state: { in: [...OPEN_STATES] },
      createdAt: { gte: since },
    },
    select: { floatUnits: true },
  });
  return open.reduce((sum, row) => sum + (row.floatUnits ?? 0n), 0n);
}

// Whether the float holds `units` beyond what it already owes, with gas to send them. Any doubt means no.
export async function floatCovers(
  wallet: Pick<FloatWallet, "address" | "balances">,
  units: bigint,
  owed = 0n,
): Promise<boolean> {
  try {
    const { usdc, eth } = await wallet.balances();
    if (eth < MIN_FLOAT_ETH_WEI) {
      console.warn(`[float] ${wallet.address} has too little ETH for gas: payouts take the 1Click path.`);
      return false;
    }
    return usdc >= owed + units + FLOAT_MARGIN_UNITS;
  } catch {
    return false;
  }
}

// At payout creation the float may have drained since the quote, so what it already promised counts too.
export async function floatCanPay(
  wallet: FloatWallet,
  unit: Unit,
  units: bigint,
  now: Date,
): Promise<boolean> {
  const owed = await unit((tx) => promised(tx, new Date(now.getTime() - WATCH_WINDOW_MS))).catch(() => null);
  return owed !== null && floatCovers(wallet, units, owed);
}

export type FloatDispatchDeps = {
  unit: Unit;
  vault: Pick<VaultClient, "getReceipt">;
  wallet: FloatWallet;
  now: () => Date;
  log: (message: string) => void;
};

export type FloatResult = { payoutId: string; outcome: "waiting" | "taken" | "sent" | "retry" | "unknown" };

// Pays the provider from the float once the vault has really sent the user's USDC. The claim is taken in the database
// before anything is broadcast, so a payout is paid at most once across restarts and replicas. A transfer that may
// have been broadcast is never retried: an operator checks the float's history instead.
export async function dispatchFloat(deps: FloatDispatchDeps): Promise<FloatResult[]> {
  const since = new Date(deps.now().getTime() - WATCH_WINDOW_MS);
  const due = await deps.unit((tx) =>
    tx.payout.findMany({
      where: {
        floatTarget: { not: null },
        floatClaimedAt: null,
        state: { in: [...OPEN_STATES] },
        createdAt: { gte: since },
      },
      select: { id: true, floatTarget: true, floatUnits: true },
      orderBy: { createdAt: "asc" },
      take: 20,
    }),
  );
  const results: FloatResult[] = [];
  for (const payout of due) {
    const receipt = await deps.vault.getReceipt(payout.id).catch(() => null);
    if (receipt?.transferState !== "dispatched") {
      results.push({ payoutId: payout.id, outcome: "waiting" });
      continue;
    }
    const claimed = await deps.unit((tx) =>
      tx.payout.updateMany({
        where: { id: payout.id, floatClaimedAt: null },
        data: { floatClaimedAt: deps.now() },
      }),
    );
    if (claimed.count !== 1) {
      results.push({ payoutId: payout.id, outcome: "taken" });
      continue;
    }
    results.push({
      payoutId: payout.id,
      outcome: await send(deps, payout.id, payout.floatTarget as string, payout.floatUnits as bigint),
    });
  }
  return results;
}

async function send(
  deps: FloatDispatchDeps,
  payoutId: string,
  target: string,
  units: bigint,
): Promise<FloatResult["outcome"]> {
  try {
    const hash = await deps.wallet.transferUsdc(target, units);
    await deps.unit((tx) => tx.payout.update({ where: { id: payoutId }, data: { floatTxHash: hash } }));
    deps.log(`[float] ${payoutId}: paid ${units} USDC units to ${target} in ${hash}`);
    return "sent";
  } catch (error) {
    if (error instanceof FloatNotSent) {
      await deps.unit((tx) => tx.payout.update({ where: { id: payoutId }, data: { floatClaimedAt: null } }));
      deps.log(`[float] ${payoutId}: transfer refused before sending (${error.message}); trying again`);
      return "retry";
    }
    deps.log(
      `[float] ${payoutId}: transfer may have been sent (${(error as Error).name}); check ${deps.wallet.address} by hand`,
    );
    return "unknown";
  }
}

export function startFloatDispatch(deps: FloatDispatchDeps, intervalMs = 3_000): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await dispatchFloat(deps);
    } catch (error) {
      deps.log(`[float] sweep failed: ${(error as Error).name}`);
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

// One line at boot so the operator can see where to send USDC and ETH, and how much is there.
export async function logFloat(wallet: FloatWallet, log: (message: string) => void): Promise<void> {
  try {
    const { usdc, eth } = await wallet.balances();
    log(`[float] Base float ${wallet.address}: ${Number(usdc) / 1e6} USDC, ${Number(eth) / 1e18} ETH`);
  } catch (error) {
    log(`[float] Base float ${wallet.address}: balance unreadable (${(error as Error).name})`);
  }
}
