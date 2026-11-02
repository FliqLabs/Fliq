const waitlistEndpoint = "https://backend-waitlist-b1z2.onrender.com/api/waitlist";

export async function POST(request: Request) {
  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const email =
    typeof body === "object" && body !== null && "email" in body
      ? body.email
      : undefined;

  if (typeof email !== "string" || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return Response.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const response = await fetch(waitlistEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
      cache: "no-store",
    });

    if (response.status === 409) {
      return Response.json({ error: "This email may already be on the list." }, { status: 409 });
    }

    if (!response.ok) {
      return Response.json({ error: "Waitlist signup failed." }, { status: 502 });
    }

    return new Response(null, { status: 204 });
  } catch {
    return Response.json({ error: "Waitlist service is unavailable." }, { status: 502 });
  }
}
