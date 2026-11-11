const NO_STORE = { "Cache-Control": "no-store" };
const TIMEOUT_MS = 15_000;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+[0-9]{8,15}$/;
const OTP = /^[0-9]{4,8}$/;
const MAX_FIELD = 100;

type Contact = { email: string } | { phone: string };
type Device = { uuid: string; device: string; os?: string; browser?: string };
type Invalid = { invalid: string };

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

function invalid(message: string) {
  return json({ error: "invalid_request", message }, 400);
}

function isText(value: unknown, max = MAX_FIELD): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

async function hasFliqSession(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!/^Bearer \S+$/.test(authorization)) return false;
  const apiBase = process.env.FLIQ_API_BASE_URL ?? "https://api-production-54e10.up.railway.app/v1";
  try {
    const result = await fetch(`${apiBase}/me`, {
      headers: { Authorization: authorization },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return result.status === 200;
  } catch {
    return false;
  }
}

function readContact(body: Record<string, unknown>): Contact | Invalid {
  const hasEmail = body.email !== undefined;
  const hasPhone = body.phone !== undefined;
  if (hasEmail === hasPhone) return { invalid: "Send exactly one of email or phone." };
  if (hasEmail) {
    return isText(body.email, 254) && EMAIL.test(body.email)
      ? { email: body.email }
      : { invalid: "email is not a valid address." };
  }
  return typeof body.phone === "string" && PHONE.test(body.phone)
    ? { phone: body.phone }
    : { invalid: "phone must be in E.164 format, for example +2348012345678." };
}

function readDevice(value: unknown): Device | Invalid {
  if (typeof value !== "object" || value === null) return { invalid: "device is required." };
  const { uuid, device, os, browser } = value as Record<string, unknown>;
  if (!isText(uuid)) return { invalid: `device.uuid must be a string of 1 to ${MAX_FIELD} characters.` };
  if (!isText(device)) return { invalid: `device.device must be a string of 1 to ${MAX_FIELD} characters.` };
  if (os !== undefined && !isText(os)) return { invalid: "device.os must be a short string." };
  if (browser !== undefined && !isText(browser)) return { invalid: "device.browser must be a short string." };
  return {
    uuid,
    device,
    ...(os === undefined ? {} : { os }),
    ...(browser === undefined ? {} : { browser }),
  };
}

function pajMessage(body: unknown) {
  const message = (body as { message?: unknown } | null)?.message;
  if (Array.isArray(message)) return message.join("; ");
  return typeof message === "string" ? message : "Paj refused the request.";
}

async function forwardToPaj(path: string, payload: object) {
  const apiKey = process.env.PAJ_BUSINESS_API_KEY;
  if (!apiKey) return json({ error: "paj_not_configured" }, 503);
  const pajBase = process.env.PAJ_API_BASE_URL || "https://api.paj.cash";

  try {
    const result = await fetch(`${pajBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(payload),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (result.status >= 500) return json({ error: "paj_unavailable" }, 502);
    const body = await result.json().catch(() => null);
    if (result.ok && body !== null) return json(body, result.status);
    if (result.status >= 400) return json({ error: "paj_refused", message: pajMessage(body) }, 400);
    return json({ error: "paj_unavailable" }, 502);
  } catch {
    return json({ error: "paj_unavailable" }, 502);
  }
}

async function readBody(request: Request) {
  const body = await request.json().catch(() => null);
  return typeof body === "object" && body !== null && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

export async function initiatePajSession(request: Request) {
  if (!(await hasFliqSession(request))) return json({ error: "sign_in_required" }, 401);
  const body = await readBody(request);
  if (!body) return invalid("Send a JSON object.");
  const contact = readContact(body);
  if ("invalid" in contact) return invalid(contact.invalid);
  return forwardToPaj("/pub/initiate", contact);
}

export async function verifyPajSession(request: Request) {
  if (!(await hasFliqSession(request))) return json({ error: "sign_in_required" }, 401);
  const body = await readBody(request);
  if (!body) return invalid("Send a JSON object.");
  const contact = readContact(body);
  if ("invalid" in contact) return invalid(contact.invalid);
  if (typeof body.otp !== "string" || !OTP.test(body.otp)) return invalid("otp must be 4 to 8 digits.");
  const device = readDevice(body.device);
  if ("invalid" in device) return invalid(device.invalid);
  return forwardToPaj("/pub/verify", { ...contact, otp: body.otp, device });
}
