import { ConfigError } from "./errors";
import { Reader, type Deployment, type Env } from "./reader";

export type Section<T> = (read: Reader) => T;
type Sections = Record<string, Section<unknown>>;

export type Config<S extends Sections> = { deployment: Deployment } & {
  [K in keyof S]: ReturnType<S[K]>;
};

export function defineSection<T>(section: Section<T>): Section<T> {
  return section;
}

export function loadConfig<S extends Sections>(sections: S, env: Env = process.env): Config<S> {
  const reader = new Reader(env);
  const values = Object.fromEntries(Object.entries(sections).map(([key, section]) => [key, section(reader)]));
  if (reader.issues.length > 0) throw new ConfigError(reader.issues);
  return { deployment: reader.deployment, ...values } as Config<S>;
}

export type ExitDeps = { exit: (code: number) => never; log: (message: string) => void };

export function loadConfigOrExit<S extends Sections>(
  sections: S,
  env: Env = process.env,
  deps: ExitDeps = { exit: process.exit, log: console.error },
): Config<S> {
  try {
    return loadConfig(sections, env);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    deps.log(error.message);
    return deps.exit(1);
  }
}

export function listVariables(sections: Sections): string[] {
  const reader = new Reader({});
  for (const section of Object.values(sections)) section(reader);
  return [...reader.variables].sort();
}
