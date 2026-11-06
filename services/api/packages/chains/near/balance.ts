import type { NearRpc } from "./rpc";

const NEAR = 10n ** 24n;
// Architecture §11.1 and §18.1: keep about 5 NEAR, warn below 2, page below 1.
export const BALANCE_TARGET = 5n * NEAR;
export const BALANCE_WARNING = 2n * NEAR;
export const BALANCE_CRITICAL = 1n * NEAR;

export type BalanceLevel = "ok" | "warning" | "critical" | "missing";

export type BalanceReport = {
  accountId: string;
  yocto: string;
  near: string;
  level: BalanceLevel;
  target: string;
};

export async function checkBalance(rpc: NearRpc, accountId: string): Promise<BalanceReport> {
  const account = await rpc.account(accountId);
  const yocto = account?.amount ?? 0n;
  const level: BalanceLevel = !account
    ? "missing"
    : yocto < BALANCE_CRITICAL
      ? "critical"
      : yocto < BALANCE_WARNING
        ? "warning"
        : "ok";
  return {
    accountId,
    yocto: yocto.toString(),
    near: formatNear(yocto),
    level,
    target: formatNear(BALANCE_TARGET),
  };
}

export function formatNear(yocto: bigint): string {
  const whole = yocto / NEAR;
  const fraction = ((yocto % NEAR) / 10n ** 21n).toString().padStart(3, "0");
  return `${whole}.${fraction}`;
}
