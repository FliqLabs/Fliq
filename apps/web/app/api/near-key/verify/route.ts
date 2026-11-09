import { NextRequest, NextResponse } from "next/server";

const ACCOUNT_ID = /^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/;
const PUBLIC_KEY = /^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: NextRequest) {
  if (request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin." }, { status: 403, headers: NO_STORE });
  }

  const body = await request.json().catch(() => null);
  const accountId = body?.account_id;
  const publicKey = body?.public_key;
  if (
    typeof accountId !== "string" ||
    !ACCOUNT_ID.test(accountId) ||
    typeof publicKey !== "string" ||
    !PUBLIC_KEY.test(publicKey)
  ) {
    return NextResponse.json(
      { error: "Invalid NEAR account or public key." },
      { status: 400, headers: NO_STORE },
    );
  }

  const rpcUrl = accountId.endsWith(".testnet")
    ? "https://rpc.testnet.near.org"
    : "https://rpc.mainnet.near.org";

  try {
    const result = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "fliq-key-check",
        method: "query",
        params: {
          request_type: "view_access_key",
          finality: "final",
          account_id: accountId,
          public_key: publicKey,
        },
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!result.ok) throw new Error("NEAR RPC is unavailable.");
    const response = await result.json();
    if (response.error) throw new Error("NEAR RPC could not check this key.");
    if (response.result?.error && !String(response.result.error).includes("does not exist")) {
      throw new Error("NEAR RPC could not check this key.");
    }
    return NextResponse.json(
      { matches: response.result?.permission === "FullAccess" },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json(
      { error: "Could not verify this key on NEAR. Try again shortly." },
      { status: 503, headers: NO_STORE },
    );
  }
}
