import * as Sentry from "@sentry/node";

export type Service = "api" | "relayer";

const SECRET_HEADERS = [
  "authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-fliq-signature",
  "x-fliq-key",
  "x-relayer-token",
];
const SECRET_QUERY = /([?&](?:token|code|key|secret|signature)=)[^&#]*/gi;

export const scrubUrl = (url: string): string => url.replace(SECRET_QUERY, "$1[redacted]");

function scrubRequest(request: {
  url?: string;
  headers?: Record<string, unknown>;
  cookies?: unknown;
  data?: unknown;
  query_string?: unknown;
}): void {
  if (request.url) request.url = scrubUrl(request.url);
  if (typeof request.query_string === "string")
    request.query_string = scrubUrl(`?${request.query_string}`).slice(1);
  for (const name of Object.keys(request.headers ?? {})) {
    if (SECRET_HEADERS.includes(name.toLowerCase())) request.headers![name] = "[redacted]";
  }
  delete request.cookies;
  delete request.data;
}

// Events carry request metadata only. Bodies hold bank accounts, signed delegates and keys, so they never leave the process.
function scrub<T extends Sentry.Event>(event: T): T {
  if (event.request) scrubRequest(event.request);
  if (event.transaction) event.transaction = scrubUrl(event.transaction);
  const traced: Array<Record<string, unknown> | undefined> = [
    event.contexts?.trace?.data,
    ...(event.spans ?? []).map((span) => span.data),
  ];
  for (const data of traced) {
    for (const [key, value] of Object.entries(data ?? {}))
      if (typeof value === "string") data![key] = scrubUrl(value);
  }
  return event;
}

// Without SENTRY_DSN nothing is sent, so a fresh clone and the tests run as before. SENTRY_ENVIRONMENT tells local from production.
export function initSentry(service: Service, env: Record<string, string | undefined> = process.env): boolean {
  const dsn = env.SENTRY_DSN?.trim();
  if (!dsn) return false;
  const rate = Number(env.SENTRY_TRACES_SAMPLE_RATE ?? "1");
  Sentry.init({
    dsn,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (env.NODE_ENV === "production" ? "production" : "local"),
    release: env.SENTRY_RELEASE?.trim() || env.RAILWAY_GIT_COMMIT_SHA || env.RENDER_GIT_COMMIT || undefined,
    tracesSampleRate: Number.isFinite(rate) ? rate : 1,
    traceLifecycle: "static",
    integrations: [Sentry.consoleLoggingIntegration({ levels: ["log", "info", "warn", "error"] })],
    beforeSend: scrub,
    beforeSendTransaction: scrub,
    beforeBreadcrumb: (breadcrumb) => {
      if (typeof breadcrumb.data?.url === "string") breadcrumb.data.url = scrubUrl(breadcrumb.data.url);
      return breadcrumb;
    },
    initialScope: { tags: { service } },
  });
  return true;
}

export const watchApp = Sentry.setupFastifyErrorHandler;
export const flushSentry = (timeoutMs = 2_000) => Sentry.flush(timeoutMs);
