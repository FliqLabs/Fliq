import type { ConfigIssue } from "./errors";
import { rotating, Secret, type RotatingSecret } from "./secret";

export const DEPLOYMENTS = ["local", "sandbox", "production"] as const;
export type Deployment = (typeof DEPLOYMENTS)[number];
export type Env = Readonly<Record<string, string | undefined>>;

type Parsed<T> = { value: T } | { problem: string };

const NEAR_ACCOUNT = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
const NEAR_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,88}$/;
const MIN_SECRET_LENGTH = 16;

// Every read records its problem and returns a fallback, so one boot reports every bad variable at once;
// loadConfig throws before any fallback can be used.
export class Reader {
  readonly issues: ConfigIssue[] = [];
  readonly variables = new Set<string>();
  readonly deployment: Deployment;
  readonly #env: Env;

  constructor(env: Env) {
    this.#env = env;
    this.deployment = this.oneOf("FLIQ_ENV", DEPLOYMENTS, "production");
  }

  fail(variable: string, problem: string): void {
    if (this.hasProblem(variable)) return;
    this.issues.push({ variable, problem });
  }

  hasProblem(variable: string): boolean {
    return this.issues.some((issue) => issue.variable === variable);
  }

  optional<T>(name: string, read: (name: string) => T): T | undefined {
    this.variables.add(name);
    return this.#raw(name) === undefined ? undefined : read(name);
  }

  oneOf<const T extends string>(name: string, values: readonly T[], fallback: T = values[0] as T): T {
    return this.#read<T>(name, fallback, (raw) =>
      values.includes(raw as T) ? { value: raw as T } : { problem: `must be one of ${values.join(", ")}` },
    );
  }

  int(name: string, min: number, max: number): number {
    return this.#read<number>(name, min, (raw) => {
      const value = Number(raw);
      if (!/^\d+$/.test(raw) || value < min || value > max) {
        return { problem: `must be a whole number from ${min} to ${max}` };
      }
      return { value };
    });
  }

  // For amounts beyond Number's safe range, such as yoctoNEAR.
  units(name: string, max: bigint): bigint {
    return this.#read<bigint>(name, 0n, (raw) =>
      /^\d+$/.test(raw) && BigInt(raw) <= max
        ? { value: BigInt(raw) }
        : { problem: `must be a whole number from 0 to ${max}` },
    );
  }

  url(name: string, schemes: readonly string[]): string {
    const expected = `must be a URL starting with ${schemes.map((scheme) => `${scheme}//`).join(" or ")}`;
    return this.#read<string>(name, "", (raw) => {
      if (!URL.canParse(raw)) return { problem: expected };
      return schemes.includes(new URL(raw).protocol) ? { value: raw } : { problem: expected };
    });
  }

  nearAccount(name: string): string {
    return this.#read<string>(name, "", (raw) =>
      raw.length >= 2 && raw.length <= 64 && NEAR_ACCOUNT.test(raw)
        ? { value: raw }
        : { problem: "must be a valid NEAR account id" },
    );
  }

  nearKey(name: string): Secret {
    return this.#read(name, new Secret(""), parseNearKey);
  }

  nearKeys(name: string, min: number, max: number): Secret[] {
    return this.#read<Secret[]>(name, [], (raw) => {
      const keys = raw.split(",").map((key) => parseNearKey(key.trim()));
      if (keys.some((key) => "problem" in key))
        return { problem: "must be a comma-separated list of ed25519 keys" };
      if (keys.length < min || keys.length > max) return { problem: `must hold ${min} to ${max} keys` };
      return { value: keys.map((key) => (key as { value: Secret }).value) };
    });
  }

  secret(name: string): Secret {
    return this.#read<Secret>(name, new Secret(""), (raw) =>
      raw.length >= MIN_SECRET_LENGTH
        ? { value: new Secret(raw) }
        : { problem: `must be at least ${MIN_SECRET_LENGTH} characters` },
    );
  }

  // Both values are accepted during a rotation; drop the _PREVIOUS variable once the overlap window ends.
  rotatingSecret(name: string): RotatingSecret {
    const previousName = `${name}_PREVIOUS`;
    const current = this.secret(name);
    const previous = this.optional(previousName, (variable) => this.secret(variable));
    if (previous && current.equals(previous.reveal())) this.fail(previousName, `must differ from ${name}`);
    return rotating(current, previous);
  }

  #raw(name: string): string | undefined {
    const value = this.#env[name]?.trim();
    return value ? value : undefined;
  }

  #read<T>(name: string, fallback: T, parse: (raw: string) => Parsed<T>): T {
    this.variables.add(name);
    const raw = this.#raw(name);
    if (raw === undefined) {
      this.fail(name, "missing");
      return fallback;
    }
    const parsed = parse(raw);
    if ("problem" in parsed) {
      this.fail(name, parsed.problem);
      return fallback;
    }
    return parsed.value;
  }
}

function parseNearKey(raw: string): Parsed<Secret> {
  return NEAR_KEY.test(raw) ? { value: new Secret(raw) } : { problem: "must be an ed25519:<base58> key" };
}
