import { Prisma } from "@prisma/client";
import { RelayerClientError, type RelayerClient } from "../../../packages/chains/near/index.js";
import type { Config } from "./config.js";
import type { Db, Unit } from "./db.js";
import { ApiError, conflict, invalidRequest } from "./errors.js";
import { hashOf, type Reply } from "./idempotency.js";
import { toUserView } from "./auth/sessions.js";

const LABEL = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const RESERVED = new Set(["admin", "api", "app", "fliq", "help", "near", "pay", "root", "security", "support", "team", "vault", "www"]);

const ED25519_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{32,64}$/;

export type Provisioned = { status: "created" | "pending"; nearAccount: string; vault: string };

export interface NearProvisioner {
  createAccount(fullName: string, publicKey: string | undefined, options?: { registerStorage?: boolean }): Promise<Provisioned>;
  // Leaves the owner enough NEAR to attach set_agent's storage deposit to the delegate action they sign.
  fundAgentDeposit(owner: string, agentId: string): Promise<void>;
}

// For local runs and tests without a relayer: creates nothing on chain.
export class MockProvisioner implements NearProvisioner {
  constructor(
    private readonly vaultAccount: string,
    private readonly onCreated: (account: string) => void = () => undefined,
  ) {}

  async createAccount(fullName: string): Promise<Provisioned> {
    this.onCreated(fullName);
    return { status: "created", nearAccount: fullName, vault: this.vaultAccount };
  }

  async fundAgentDeposit(): Promise<void> {}
}

// A named account can only be made by its parent, so it is the relayer's account creator that makes it, with the
// user's own key as its only full-access key. Linking an account that key already controls counts as created.
export class RelayerProvisioner implements NearProvisioner {
  constructor(
    private readonly relayer: RelayerClient,
    private readonly vaultAccount: string,
  ) {}

  async createAccount(fullName: string, publicKey: string | undefined, options?: { registerStorage?: boolean }): Promise<Provisioned> {
    if (!publicKey) throw invalidRequest("public_key is required to create your NEAR account.");
    if (!ED25519_KEY.test(publicKey)) throw invalidRequest("public_key must be ed25519:<base58>.");
    try {
      const result = await this.relayer.provisionAccount(fullName, publicKey, options);
      return { status: result.status === "pending" ? "pending" : "created", nearAccount: result.account_id, vault: this.vaultAccount };
    } catch (error) {
      if (!(error instanceof RelayerClientError)) throw error;
      // A relayer that is still waking up, or still waiting for the chain, may finish creating the account after we
      // stop waiting. Answering pending lets the app retry, and the retry links the account the relayer made.
      if (error.code === "in_progress" || error.code === "relayer_timeout") return { status: "pending", nearAccount: fullName, vault: this.vaultAccount };
      if (error.code === "taken") throw conflict("That name is taken.");
      if (error.code === "invalid_key") throw invalidRequest("public_key must be ed25519:<base58>.");
      if (error.code === "invalid_name") throw invalidRequest("Name is invalid.");
      console.error(`relayer could not create ${fullName}: ${error.status} ${error.code} ${error.message}`);
      throw new ApiError(503, "chain_unavailable", "Your NEAR account could not be created right now. Try again in a moment.");
    }
  }

  async fundAgentDeposit(owner: string, agentId: string): Promise<void> {
    try {
      await this.relayer.fundAgentDeposit(owner, agentId);
    } catch (error) {
      if (!(error instanceof RelayerClientError)) throw error;
      // A top-up still in flight lands before the user can sign, so only a refused or failed one stops the connect.
      if (error.code === "in_progress" || error.code === "relayer_timeout") return;
      console.error(`relayer could not fund the agent deposit for ${owner} (${agentId}): ${error.status} ${error.code} ${error.message}`);
      throw new ApiError(503, "chain_unavailable", "The agent could not be set up right now. Try again in a moment.");
    }
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

export interface ClaimInput {
  name: string;
  public_key?: string;
}

async function storedReply(tx: Db, userId: string, key: string, requestHash: string): Promise<Reply | null> {
  const stored = await tx.idempotencyRecord.findUnique({ where: { scope_key: { scope: userId, key } } });
  if (!stored) return null;
  if (stored.requestHash !== requestHash) {
    throw new ApiError(422, "idempotency_mismatch", "This Idempotency-Key was used with a different request.");
  }
  return { status: stored.responseStatus, body: stored.responseBody };
}

// The chain call runs between two short transactions, never inside one. A pending account is not recorded, so the
// same request sent again finishes it; the unique name keeps two users from both saving one account.
export async function claimName(unit: Unit, config: Config, provisioner: NearProvisioner, userId: string, key: string | undefined, input: ClaimInput): Promise<Reply> {
  if (!key) throw new ApiError(400, "idempotency_key_required", "Idempotency-Key header is required.");
  const requestHash = hashOf(input);
  const label = String(input.name ?? "").toLowerCase();
  const name = fullName(label, config);

  const replay = await unit(async (tx) => {
    const stored = await storedReply(tx, userId, key, requestHash);
    if (stored) return stored;
    const problem = nameProblem(label);
    if (problem) throw invalidRequest(`Name is ${problem}.`);
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.nearAccount) throw conflict("This account already has a name.");
    if (await tx.user.findUnique({ where: { nearAccount: name }, select: { id: true } })) throw conflict("That name is taken.");
    return null;
  });
  if (replay) return replay;

  const account = await provisioner.createAccount(name, input.public_key);
  if (account.status === "pending") return { status: 202, body: { status: "pending", near_account: account.nearAccount } };

  return unit(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${key}`}, 0))`;
    const stored = await storedReply(tx, userId, key, requestHash);
    if (stored) return stored;
    try {
      const saved = await tx.user.updateMany({
        where: { id: userId, nearAccount: null },
        data: { nearAccount: account.nearAccount, vaultAccount: account.vault },
      });
      if (saved.count === 0) throw conflict("This account already has a name.");
      const reply = { status: 201, body: toUserView(await tx.user.findUniqueOrThrow({ where: { id: userId } })) };
      await tx.idempotencyRecord.create({ data: { scope: userId, key, requestHash, responseStatus: reply.status, responseBody: reply.body as object } });
      return reply;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("That name is taken.");
      throw error;
    }
  });
}
