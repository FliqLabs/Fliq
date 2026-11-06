import { createHash, timingSafeEqual } from "node:crypto";
import { inspect } from "node:util";

const REDACTED = "[redacted]";

// Wrapping secrets means logging or serialising a whole config object cannot leak one.
export class Secret {
  readonly #value: string;

  constructor(value: string) {
    this.#value = value;
  }

  reveal(): string {
    return this.#value;
  }

  equals(candidate: string): boolean {
    return timingSafeEqual(digest(this.#value), digest(candidate));
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [inspect.custom](): string {
    return REDACTED;
  }
}

export type RotatingSecret = {
  current: Secret;
  previous: Secret | undefined;
  accepts(candidate: string): boolean;
};

export function rotating(current: Secret, previous: Secret | undefined): RotatingSecret {
  return {
    current,
    previous,
    accepts: (candidate) => current.equals(candidate) || (previous?.equals(candidate) ?? false),
  };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}
