import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MockProvisioner } from "../apps/api/src/accounts.js";
import { buildApp } from "../apps/api/src/app.js";
import type { EmailSender } from "../apps/api/src/auth/email-links.js";
import { loadConfig } from "../apps/api/src/config.js";
import { createDatabase, unitOf } from "../apps/api/src/db.js";
import { createHandlers } from "../apps/api/src/handlers.js";
import { DEFAULT_VELOCITY } from "../apps/api/src/payouts.js";
import { recordOutsideSend } from "../apps/api/src/people.js";
import { sandboxAdapters } from "../apps/api/src/sandbox.js";
import { MockVault } from "../packages/chains/vault/index.js";
import { newId } from "../packages/db/src/ids.js";
import { DEFAULT_ROUTING_CONFIG, NO_SIGNALS } from "../packages/domain/routing.js";
import type { ProviderAdapter } from "../packages/providers/types.js";

// Throwaway local database only; Prisma loads .env, which may point at a shared one.
const enabled =
  /@(localhost|127\.0\.0\.1)[:/]/.test(process.env.DATABASE_URL ?? "") &&
  Boolean(process.env.FLIQ_ACCESS_SECRET);

const SOLANA = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
const BASE = "0x76b4c56085ed136a8744d52be956396624a730e8";
const TRON = "TA4Wt1DUCqz6YegbnsmqsWC5uUfbdBqPxm";

describe.skipIf(!enabled)("saved wallets", () => {
  if (!enabled) {
    it("needs DATABASE_URL pointing at a local database", () => {});
    return;
  }

  const database = createDatabase();
  const unit = unitOf(database);
  const config = loadConfig();
  const links: string[] = [];
  const sender: EmailSender = { sendSignInLink: async (_to, link) => void links.push(link) };
  const suffix = randomBytes(4).toString("hex");
  const adapter = sandboxAdapters()[0] as ProviderAdapter;
  const now = () => new Date();

  const app = buildApp({
    config,
    unit,
    handlers: createHandlers({
      config,
      unit,
      email: sender,
      provisioner: new MockProvisioner(config.vaultAccount),
      vault: new MockVault({ registrar: "registrar.test.near", usdc: "usdc.test.near", now: () => 0n }),
      quotes: { adapters: [adapter], routing: DEFAULT_ROUTING_CONFIG, signals: NO_SIGNALS, now },
      payouts: { config, adapters: [adapter], velocity: DEFAULT_VELOCITY, now },
      now,
    }),
  });

  const userIds: string[] = [];
  const emails: string[] = [];

  async function signIn(label: string) {
    const email = `wallets+${label}-${suffix}@example.test`;
    emails.push(email);
    await app.inject({ method: "POST", url: "/v1/auth/email-links", payload: { email } });
    const linkToken = new URL(links.at(-1) as string).searchParams.get("token") as string;
    const session = (await app.inject({ method: "POST", url: "/v1/auth/email-links/verify", payload: { token: linkToken } })).json();
    userIds.push(session.user.user_id);
    return { headers: { authorization: `Bearer ${session.access_token}` }, userId: session.user.user_id as string };
  }

  const save = (headers: Record<string, string>, payload: object) => app.inject({ method: "POST", url: "/v1/wallets", payload, headers });
  const list = async (headers: Record<string, string>) => (await app.inject({ method: "GET", url: "/v1/wallets", headers })).json().items;

  beforeAll(async () => {
    await app.ready();
  }, 60_000);

  afterAll(async () => {
    await database.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`DELETE FROM core.saved_wallets WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM core.wallet_sends WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM core.transfers WHERE from_user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.sessions WHERE user_id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.users WHERE id = ANY(${userIds}::text[])`;
      await tx.$executeRaw`DELETE FROM auth.email_links WHERE email = ANY(${emails}::text[])`;
    });
    await database.$disconnect();
  }, 60_000);

  it("saves a wallet with its name, keeps the address encrypted, and lists only the owner's", async () => {
    const user = await signIn("save");
    const saved = await save(user.headers, { label: "Tunde's Binance", chain: "solana", address: SOLANA, token: "usdc" });
    expect(saved.statusCode).toBe(201);
    expect(saved.json()).toMatchObject({ label: "Tunde's Binance", chain: "solana", address: SOLANA, token: "usdc", last_sent_at: null });

    const row = await database.savedWallet.findUniqueOrThrow({ where: { id: saved.json().wallet_id } });
    expect(Buffer.from(row.addressCipher).toString("utf8")).not.toContain(SOLANA);

    const stranger = await signIn("stranger");
    expect(await list(stranger.headers)).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `/v1/wallets/${saved.json().wallet_id}`, headers: stranger.headers })).statusCode).toBe(404);
  }, 60_000);

  it("saving the same chain and address again returns the one wallet with the new name", async () => {
    const user = await signIn("dupe");
    const first = (await save(user.headers, { label: "Kemi", chain: "base", address: BASE })).json();
    const again = await save(user.headers, { label: "Kemi on Base", chain: "base", address: BASE.toUpperCase().replace("0X", "0x") });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ wallet_id: first.wallet_id, label: "Kemi on Base" });
    const elsewhere = await save(user.headers, { label: "Kemi on BNB", chain: "bnb", address: BASE });
    expect(elsewhere.json().wallet_id).not.toBe(first.wallet_id);
    expect(await list(user.headers)).toHaveLength(2);
  }, 60_000);

  it("refuses a wrong address, a missing or long name, and unknown fields", async () => {
    const user = await signIn("refuse");
    const wrong = await save(user.headers, { label: "Ada", chain: "tron", address: SOLANA });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.message).toContain("Tron");
    expect((await save(user.headers, { label: "", chain: "tron", address: TRON })).statusCode).toBe(400);
    expect((await save(user.headers, { label: "a".repeat(41), chain: "tron", address: TRON })).statusCode).toBe(400);
    expect((await save(user.headers, { label: "Ada", chain: "ethereum", address: BASE })).statusCode).toBe(400);
    expect((await save(user.headers, { label: "Ada", chain: "tron", address: TRON, memo: "x" })).statusCode).toBe(400);
  }, 60_000);

  it("renames and removes, and a removed wallet saved again comes back", async () => {
    const user = await signIn("manage");
    const saved = (await save(user.headers, { label: "Ada", chain: "tron", address: TRON })).json();
    const renamed = await app.inject({ method: "PATCH", url: `/v1/wallets/${saved.wallet_id}`, payload: { label: "Ada's Trust Wallet" }, headers: user.headers });
    expect(renamed.json()).toMatchObject({ wallet_id: saved.wallet_id, label: "Ada's Trust Wallet" });
    expect((await app.inject({ method: "PATCH", url: `/v1/wallets/${saved.wallet_id}`, payload: { label: " " }, headers: user.headers })).statusCode).toBe(400);

    expect((await app.inject({ method: "DELETE", url: `/v1/wallets/${saved.wallet_id}`, headers: user.headers })).statusCode).toBe(204);
    expect(await list(user.headers)).toEqual([]);
    expect((await app.inject({ method: "DELETE", url: `/v1/wallets/${saved.wallet_id}`, headers: user.headers })).statusCode).toBe(404);

    const back = await save(user.headers, { label: "Ada again", chain: "tron", address: TRON });
    expect(back.statusCode).toBe(201);
    expect(back.json().wallet_id).toBe(saved.wallet_id);
  }, 60_000);

  it("orders by the last send fliq recorded to each wallet, then by newest saved", async () => {
    const user = await signIn("order");
    const solana = (await save(user.headers, { label: "My Phantom", chain: "solana", address: SOLANA })).json();
    const tron = (await save(user.headers, { label: "Ada", chain: "tron", address: TRON })).json();
    const near = (await save(user.headers, { label: "Tobi", chain: "near", address: "tobi.fliq.near" })).json();
    expect((await list(user.headers)).map((item: { wallet_id: string }) => item.wallet_id)).toEqual([near.wallet_id, tron.wallet_id, solana.wallet_id]);

    const sendTo = (address: string, at: Date, originTx: string | null) =>
      database.walletSend.create({
        data: {
          id: newId("snd"), userId: user.userId, account: "order.test.near", chain: "solana", toAddress: address,
          amountUnits: 10_000_000n, receivesUnits: 9_970_000n, minReceivesUnits: 9_940_000n,
          depositAddress: randomBytes(32).toString("hex"), etaSeconds: 40, expiresAt: at, quote: {}, createdAt: at, originTx,
        },
      });
    await sendTo(SOLANA, new Date("2026-11-20T10:00:00Z"), "tx-1");
    await sendTo(SOLANA, new Date("2026-11-25T10:00:00Z"), null);
    await unit((tx) => recordOutsideSend(tx, user.userId, { txHash: `tx-${suffix}-near`, from: "order.test.near", to: "tobi.fliq.near", amount: 1_000_000n }));

    const items = await list(user.headers);
    expect(items.map((item: { wallet_id: string }) => item.wallet_id)).toEqual([near.wallet_id, solana.wallet_id, tron.wallet_id]);
    expect(items[1].last_sent_at, "a send the user never signed is not a send").toBe("2026-11-20T10:00:00.000Z");
    expect(items[2].last_sent_at).toBeNull();
  }, 60_000);
});
