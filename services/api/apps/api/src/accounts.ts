import { Prisma } from "@prisma/client";
import type { Config } from "./config.js";
import type { Db } from "./db.js";
import { conflict, invalidRequest } from "./errors.js";
import { toUserView } from "./auth/sessions.js";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const RESERVED = new Set(["admin", "api", "app", "fliq", "help", "near", "pay", "root", "security", "support", "team", "vault", "www"]);

export interface NearProvisioner {
  createAccount(fullName: string): Promise<{ nearAccount: string; vault: string }>;
}

// Stands in for the relayer until Ladipeo's chain client exists; creates nothing on chain.
export class MockProvisioner implements NearProvisioner {
  constructor(
    private readonly vaultAccount: string,
    private readonly onCreated: (account: string) => void = () => undefined,
  ) {}

  async createAccount(fullName: string) {
    this.onCreated(fullName);
    return { nearAccount: fullName, vault: this.vaultAccount };
  }
}

export type NameProblem = "invalid" | "reserved" | "taken";

export function fullName(label: string, config: Config): string {
  return `${label}.${config.nearRootAccount}`;
}

export function nameProblem(label: string): NameProblem | null {
  if (!LABEL.test(label) || label.includes("--")) return "invalid";
  return RESERVED.has(label) ? "reserved" : null;
}

export async function checkName(db: Db, config: Config, rawLabel: string) {
  const label = rawLabel.toLowerCase();
  const name = fullName(label, config);
  const problem = nameProblem(label);
  if (problem) return { name, available: false, reason: problem };
  const owner = await db.user.findUnique({ where: { nearAccount: name }, select: { id: true } });
  return owner ? { name, available: false, reason: "taken" as const } : { name, available: true, reason: null };
}

export async function claimName(db: Db, config: Config, provisioner: NearProvisioner, userId: string, rawLabel: string) {
  const label = rawLabel.toLowerCase();
  const problem = nameProblem(label);
  if (problem) throw invalidRequest(`Name is ${problem}.`);
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (user.nearAccount) throw conflict("This account already has a name.");
  const name = fullName(label, config);
  const account = await provisioner.createAccount(name);
  try {
    const updated = await db.user.update({
      where: { id: userId },
      data: { nearAccount: account.nearAccount, vaultAccount: account.vault },
    });
    return toUserView(updated);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("That name is taken.");
    throw error;
  }
}
