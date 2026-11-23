import { ApiError } from "./errors.js";

export type Pausable = "payouts" | "deposits";

export type Ops = {
  // Throws when an operator has paused this kind of movement. Taking money out of the vault is never paused.
  assertRunning(kind: Pausable): void;
  // Throws when the vault already holds as much as we are willing to stand behind before an audit.
  assertRoomInVault(): Promise<void>;
};

export type OpsConfig = {
  paused: ReadonlySet<Pausable>;
  vaultCapUnits: bigint | null;
  liabilities?: () => Promise<bigint>;
  log?: (message: string) => void;
};

const KINDS: readonly Pausable[] = ["payouts", "deposits"];

const MESSAGES: Record<Pausable, string> = {
  payouts: "Cash-outs are paused for a short while. Your money is safe in your vault.",
  deposits: "Adding money is paused for a short while. Nothing has been taken.",
};

// FLIQ_PAUSED is a comma list ("payouts,deposits"). FLIQ_VAULT_CAP_USDC is whole dollars; unset means no cap.
export function opsConfigFromEnv(env: Record<string, string | undefined>): Pick<OpsConfig, "paused" | "vaultCapUnits"> {
  const named = (env.FLIQ_PAUSED ?? "").split(",").map((part) => part.trim().toLowerCase());
  const cap = (env.FLIQ_VAULT_CAP_USDC ?? "").trim();
  if (cap && !/^\d+$/.test(cap)) throw new Error("FLIQ_VAULT_CAP_USDC must be a whole number of dollars");
  return {
    paused: new Set(KINDS.filter((kind) => named.includes(kind))),
    vaultCapUnits: cap ? BigInt(cap) * 1_000_000n : null,
  };
}

export function createOps(config: OpsConfig): Ops {
  return {
    assertRunning(kind) {
      if (config.paused.has(kind)) throw new ApiError(503, "paused", MESSAGES[kind]);
    },
    async assertRoomInVault() {
      if (config.vaultCapUnits === null || !config.liabilities) return;
      let held: bigint;
      try {
        held = await config.liabilities();
      } catch (error) {
        // A failed read must not block deposits: the cap is a ceiling on exposure, not a gate on the chain being up.
        config.log?.(`[ops] vault liabilities unreadable: ${(error as Error).name}`);
        return;
      }
      if (held < config.vaultCapUnits) return;
      config.log?.(`[ops] vault cap reached: ${held} of ${config.vaultCapUnits} units; new deposits are refused`);
      throw new ApiError(503, "paused", "fliq is full for now while we grow safely. Try again soon. Nothing has been taken.");
    },
  };
}

export const NO_OPS: Ops = createOps({ paused: new Set(), vaultCapUnits: null });
