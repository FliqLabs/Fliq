import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { newId } from "../../../../packages/db/src/ids.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { accepted, invalidRequest, rejected, unauthorized, type Outcome } from "../errors.js";
import { openSession, type Session } from "./sessions.js";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

async function takeChallenge(db: Db, id: string, purpose: "register" | "login") {
  const row = await db.authChallenge.findUnique({ where: { id } });
  const usable = row && row.purpose === purpose && !row.consumedAt && row.expiresAt > new Date();
  if (!usable) throw unauthorized("Challenge expired or already used.");
  const claimed = await db.authChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claimed.count === 0) throw unauthorized("Challenge expired or already used.");
  return row;
}

export async function startRegistration(db: Db, config: Config) {
  const userHandle = newId("usr");
  const options = await generateRegistrationOptions({
    rpName: config.rpName,
    rpID: config.rpId,
    userName: userHandle,
    userID: new TextEncoder().encode(userHandle),
    attestationType: "none",
    authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
  });
  const challengeId = newId("chl");
  await db.authChallenge.create({
    data: {
      id: challengeId,
      purpose: "register",
      challenge: options.challenge,
      userHandle,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    },
  });
  return { challenge_id: challengeId, options };
}

export async function finishRegistration(db: Db, config: Config, challengeId: string, credential: any): Promise<Outcome<Session>> {
  const challenge = await takeChallenge(db, challengeId, "register");
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpId,
  }).catch(() => null);
  if (!verification?.verified || !challenge.userHandle) return rejected(invalidRequest("Passkey could not be verified."));
  const info = verification.registrationInfo.credential;
  await db.user.create({ data: { id: challenge.userHandle } });
  await db.passkeyCredential.create({
    data: {
      id: newId("pk"),
      userId: challenge.userHandle,
      credentialId: info.id,
      publicKey: Buffer.from(info.publicKey),
      counter: BigInt(info.counter),
      transports: info.transports ?? [],
    },
  });
  return accepted(await openSession(db, config, challenge.userHandle));
}

export async function startLogin(db: Db, config: Config) {
  const options = await generateAuthenticationOptions({ rpID: config.rpId, userVerification: "preferred" });
  const challengeId = newId("chl");
  await db.authChallenge.create({
    data: { id: challengeId, purpose: "login", challenge: options.challenge, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
  });
  return { challenge_id: challengeId, options };
}

export async function finishLogin(db: Db, config: Config, challengeId: string, credential: any): Promise<Outcome<Session>> {
  const challenge = await takeChallenge(db, challengeId, "login");
  const stored = await db.passkeyCredential.findUnique({ where: { credentialId: String(credential?.id) } });
  if (!stored) return rejected(unauthorized("Unknown passkey."));
  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: challenge.challenge,
    expectedOrigin: config.origins,
    expectedRPID: config.rpId,
    credential: {
      id: stored.credentialId,
      publicKey: new Uint8Array(stored.publicKey),
      counter: Number(stored.counter),
      transports: stored.transports as any,
    },
  }).catch(() => null);
  if (!verification?.verified) return rejected(unauthorized("Passkey could not be verified."));
  await db.passkeyCredential.update({
    where: { id: stored.id },
    data: { counter: BigInt(verification.authenticationInfo.newCounter), lastUsedAt: new Date() },
  });
  return accepted(await openSession(db, config, stored.userId));
}
