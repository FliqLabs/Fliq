import type { Quote } from "../../../sdk/src/index.js";

export interface Recipient {
  country: string;
  bank: string;
  number: string;
}

export interface VerifiedRecipient {
  accountName: string;
  nameVerified: boolean;
  // Sent with the payout when the bank could not return a name and the person supplied it.
  suppliedName: string | null;
}

// What this connection has seen. It lives as long as the MCP session and is never written anywhere.
export class Session {
  private readonly verified = new Map<string, VerifiedRecipient>();
  private readonly quotes = new Map<string, Quote>();

  rememberVerified(recipient: Recipient, verified: VerifiedRecipient): void {
    this.verified.set(keyOf(recipient), verified);
  }

  verifiedRecipient(recipient: Recipient): VerifiedRecipient | null {
    return this.verified.get(keyOf(recipient)) ?? null;
  }

  rememberQuote(quote: Quote): void {
    this.quotes.set(quote.quote_id, quote);
  }

  quote(quoteId: string): Quote | null {
    return this.quotes.get(quoteId) ?? null;
  }
}

const keyOf = (recipient: Recipient) => `${recipient.country}:${recipient.bank}:${recipient.number}`;
