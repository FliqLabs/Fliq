import type { Quote } from "../../../sdk/src/index.js";

export interface Recipient {
  country: string;
  bank: string;
  number: string;
}

// The Quote response does not say which chain it is funded on, and the refund address must be on that chain.
export interface KnownQuote {
  quote: Quote;
  sourceChain: string;
  expiresAt: number;
}

// What this connection has seen. It lives as long as the MCP session and is never written anywhere.
export class Session {
  private readonly verified = new Map<string, string>();
  private readonly quotes = new Map<string, KnownQuote>();

  constructor(private readonly now: () => number = Date.now) {}

  rememberVerified(recipient: Recipient, accountName: string): void {
    this.verified.set(keyOf(recipient), accountName);
  }

  verifiedName(recipient: Recipient): string | null {
    return this.verified.get(keyOf(recipient)) ?? null;
  }

  rememberQuote(quote: Quote, sourceChain: string): void {
    this.quotes.set(quote.quote_id, { quote, sourceChain, expiresAt: this.now() + quote.expires_in * 1000 });
  }

  quote(quoteId: string): KnownQuote | null {
    return this.quotes.get(quoteId) ?? null;
  }

  isExpired(known: KnownQuote): boolean {
    return this.now() >= known.expiresAt;
  }
}

const keyOf = (recipient: Recipient) => `${recipient.country}:${recipient.bank}:${recipient.number}`;
