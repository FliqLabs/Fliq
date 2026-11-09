import { NextRequest, NextResponse } from "next/server";

const API_BASE = process.env.FLIQ_API_BASE_URL ?? "https://api-production-54e10.up.railway.app/v1";
const ACCESS_COOKIE = "fliq_access";
const REFRESH_COOKIE = "fliq_refresh";
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60;
const NO_STORE = { "Cache-Control": "no-store" };

const publicRoutes = new Set([
  "GET status",
  "POST auth/passkeys/register/options",
  "POST auth/passkeys/register/verify",
  "POST auth/passkeys/login/options",
  "POST auth/passkeys/login/verify",
  "POST auth/email-links",
  "POST auth/email-links/verify",
  "GET institutions",
  "GET rates/usdc/ngn",
  "GET rates/usdc/ngn/providers",
  "GET rates/usdc/ngn/history",
]);

const protectedRoutes = new Set([
  "GET me",
  "PATCH me",
  "POST me/name",
  "POST workspaces",
  "GET workspaces/current",
  "GET keys",
  "GET onboarding",
  "GET payouts",
  "GET payouts/stats",
  "GET payouts/export",
  "GET usage",
  "GET workspaces/current/live-access",
  "GET webhook-endpoints",
  "POST webhook-endpoints",
  "GET webhook-deliveries",
  "POST quotes",
  "POST accounts/verify",
  "POST payouts",
  "POST auth/logout",
]);

type RouteContext = { params: Promise<{ path: string[] }> };
type Session = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user: unknown;
};

function isAllowed(method: string, path: string) {
  const route = `${method} ${path}`;
  return (
    publicRoutes.has(route) ||
    protectedRoutes.has(route) ||
    (method === "GET" && /^payouts\/[^/]+$/.test(path)) ||
    (method === "GET" && /^webhook-deliveries\/[^/]+$/.test(path)) ||
    (method === "POST" && /^webhook-deliveries\/[^/]+\/replay$/.test(path)) ||
    (method === "GET" && /^names\/[a-z0-9-]+$/.test(path))
  );
}

function isPublic(method: string, path: string) {
  return publicRoutes.has(`${method} ${path}`);
}

function cookieOptions(request: NextRequest, maxAge: number) {
  return {
    httpOnly: true,
    secure: request.nextUrl.protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
    maxAge,
  };
}

function saveSession(response: NextResponse, request: NextRequest, session: Session) {
  response.cookies.set(ACCESS_COOKIE, session.access_token, cookieOptions(request, session.expires_in));
  response.cookies.set(REFRESH_COOKIE, session.refresh_token, cookieOptions(request, REFRESH_MAX_AGE));
}

function clearSession(response: NextResponse) {
  response.cookies.delete(ACCESS_COOKIE);
  response.cookies.delete(REFRESH_COOKIE);
}

async function upstream(
  method: string,
  path: string,
  body?: string,
  token?: string,
  query = "",
  idempotencyKey?: string,
) {
  try {
    return await fetch(`${API_BASE}/${path}${query}`, {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(method === "POST" && ["me/name", "workspaces", "payouts"].includes(path)
          ? { "Idempotency-Key": idempotencyKey ?? crypto.randomUUID() }
          : {}),
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    return null;
  }
}

async function refresh(request: NextRequest) {
  const token = request.cookies.get(REFRESH_COOKIE)?.value;
  if (!token) return null;
  const result = await upstream("POST", "auth/refresh", JSON.stringify({ refresh_token: token }));
  if (!result?.ok) return null;
  return (await result.json()) as Session;
}

async function handle(request: NextRequest, context: RouteContext) {
  const { path: segments } = await context.params;
  const path = segments.join("/");
  const method = request.method;

  if (!isAllowed(method, path)) {
    return NextResponse.json(
      { error: { message: "Route unavailable." } },
      { status: 404, headers: NO_STORE },
    );
  }

  if (method !== "GET" && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json(
      { error: { message: "Invalid request origin." } },
      { status: 403, headers: NO_STORE },
    );
  }

  const body = method === "GET" ? undefined : await request.text();
  let session: Session | null = null;
  let accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  if (!isPublic(method, path) && !accessToken) {
    session = await refresh(request);
    accessToken = session?.access_token;
  }
  if (!isPublic(method, path) && !accessToken) {
    const response = NextResponse.json(
      { error: { message: "Sign in to continue." } },
      { status: 401, headers: NO_STORE },
    );
    clearSession(response);
    return response;
  }

  const query = method === "GET" ? request.nextUrl.search : "";
  const idempotencyKey = request.headers.get("idempotency-key") ?? undefined;
  let result = await upstream(method, path, body, accessToken, query, idempotencyKey);
  if (result?.status === 401 && !isPublic(method, path) && path !== "auth/logout" && !session) {
    session = await refresh(request);
    if (session) result = await upstream(method, path, body, session.access_token, query, idempotencyKey);
  }
  if (!result) {
    const response = NextResponse.json(
      { error: { message: "The API is unavailable. Try again." } },
      { status: 503, headers: NO_STORE },
    );
    if (session) saveSession(response, request, session);
    return response;
  }

  if (result.status === 204) {
    const response = new NextResponse(null, { status: 204, headers: NO_STORE });
    clearSession(response);
    return response;
  }

  if (path === "payouts/export" && result.ok) {
    const response = new NextResponse(await result.text(), {
      status: result.status,
      headers: {
        ...NO_STORE,
        "Content-Type": result.headers.get("content-type") ?? "text/csv; charset=utf-8",
        "Content-Disposition":
          result.headers.get("content-disposition") ?? "attachment; filename=fliq-payouts.csv",
      },
    });
    if (session) saveSession(response, request, session);
    return response;
  }

  const payload = await result.json().catch(() => ({ error: { message: "Unexpected API response." } }));
  const isSession =
    method === "POST" &&
    ["auth/passkeys/register/verify", "auth/passkeys/login/verify", "auth/email-links/verify"].includes(path);
  const traceId = result.headers.get("x-trace-id");
  const response = NextResponse.json(isSession && result.ok ? { user: (payload as Session).user } : payload, {
    status: result.status,
    headers: { ...NO_STORE, ...(traceId ? { "x-trace-id": traceId } : {}) },
  });
  if (isSession && result.ok) saveSession(response, request, payload as Session);
  else if (session) saveSession(response, request, session);
  else if (result.status === 401) clearSession(response);
  return response;
}

export async function GET(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function POST(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  return handle(request, context);
}
