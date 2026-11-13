import { newId } from "../../../../packages/db/src/ids.js";
import type { Config } from "../config.js";
import type { Db } from "../db.js";
import { unauthorized } from "../errors.js";
import { renderSignInEmail } from "./email-template.js";
import { openSession } from "./sessions.js";
import { EMAIL_LINK_TTL_SECONDS, hashToken, newOpaqueToken } from "./tokens.js";

export interface EmailSender {
  sendSignInLink(to: string, link: string): Promise<void>;
}

export class ResendSender implements EmailSender {
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async sendSignInLink(to: string, link: string): Promise<void> {
    const { subject, html, text } = renderSignInEmail(link, EMAIL_LINK_TTL_SECONDS / 60);
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: this.from, to, subject, html, text }),
    });
    if (!response.ok) throw new Error(`resend responded ${response.status}`);
  }
}

// Used when no RESEND_API_KEY is set, so a fresh clone can still sign in. Prints the link to the local console.
export class ConsoleSender implements EmailSender {
  async sendSignInLink(_to: string, link: string): Promise<void> {
    console.log(`[dev email] sign-in link: ${link}`);
  }
}

export function createEmailSender(config: Config): EmailSender {
  return config.resendApiKey ? new ResendSender(config.resendApiKey, config.emailFrom) : new ConsoleSender();
}

export async function createEmailLink(db: Db, config: Config, email: string) {
  const to = email.trim().toLowerCase();
  const { token, hash } = newOpaqueToken("el");
  await db.emailLink.create({
    data: { id: newId("eml"), email: to, tokenHash: hash, expiresAt: new Date(Date.now() + EMAIL_LINK_TTL_SECONDS * 1000) },
  });
  return { to, link: `${config.emailLinkBaseUrl}/auth/verify?token=${token}` };
}

export async function verifyEmailLink(db: Db, config: Config, token: string) {
  const link = await db.emailLink.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!link || link.consumedAt || link.expiresAt < new Date()) throw unauthorized("Sign-in link is invalid or expired.");
  const claimed = await db.emailLink.updateMany({ where: { id: link.id, consumedAt: null }, data: { consumedAt: new Date() } });
  if (claimed.count === 0) throw unauthorized("Sign-in link is invalid or expired.");
  const user = await db.user.upsert({ where: { email: link.email }, update: {}, create: { id: newId("usr"), email: link.email } });
  return openSession(db, config, user.id);
}
