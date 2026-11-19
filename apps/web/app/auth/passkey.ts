import { passkeyKeySalt } from "../claim-name/near-key";
import { adoptPasskeyKey } from "../lib/device-signer";
import { fliqApi, type User } from "../lib/fliq-api";

type Challenge<T> = { challenge_id: string; options: T };
type JsonDescriptor = Omit<PublicKeyCredentialDescriptor, "id"> & { id: string };
type CreationJson = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: JsonDescriptor[];
};
type RequestJson = Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & {
  challenge: string;
  allowCredentials?: JsonDescriptor[];
};

export class PasskeyPromptError extends Error {}

type PrfOutputs = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };

// The PRF secret makes the user's NEAR signing key, so it never goes to the API.
function withoutPrf(credential: PublicKeyCredential) {
  const { prf, ...rest } = credential.getClientExtensionResults() as AuthenticationExtensionsClientOutputs & PrfOutputs;
  void prf;
  return rest;
}

function prfSecret(credential: PublicKeyCredential) {
  return (credential.getClientExtensionResults() as PrfOutputs).prf?.results?.first ?? null;
}

function decode(value: string): ArrayBuffer {
  const binary = atob(value.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

function encode(value: ArrayBuffer | null): string | null {
  if (!value) return null;
  const bytes = new Uint8Array(value);
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function assertBrowserReady(rpId?: string) {
  if (!window.isSecureContext || !window.PublicKeyCredential) {
    throw new Error("Passkeys require a supported browser on HTTPS or localhost.");
  }
  if (rpId && location.hostname !== rpId && !location.hostname.endsWith(`.${rpId}`)) {
    throw new Error(`Passkeys are configured for ${rpId}. The backend RP ID must match this site.`);
  }
}

async function requestCredential(
  request: Promise<Credential | null>,
  mode: "login" | "register",
): Promise<PublicKeyCredential | null> {
  try {
    return (await request) as PublicKeyCredential | null;
  } catch (error) {
    if (error instanceof DOMException && ["NotAllowedError", "NotFoundError"].includes(error.name)) {
      throw new PasskeyPromptError(
        mode === "login"
          ? "Passkey sign-in did not complete. Use the device where you saved your passkey. If using a phone, check that it has a passkey for this site and that Bluetooth and internet are available on both devices."
          : "Passkey setup did not complete. If you used a phone, check Bluetooth and internet on both devices, then try again. You can also save the passkey on this computer.",
      );
    }
    throw error;
  }
}

type SignalApi = {
  signalCurrentUserDetails?: (details: {
    rpId: string;
    userId: string;
    name: string;
    displayName: string;
  }) => Promise<void>;
};

// Passkeys are created before a name exists, so they are saved under the opaque user id. Once the
// account has a name, browsers that support it relabel the saved passkey so the picker is readable.
export function labelPasskey(user: User) {
  const signal = (window.PublicKeyCredential as unknown as SignalApi | undefined)?.signalCurrentUserDetails;
  if (!signal || !user.near_account) return;
  const userId = encode(new TextEncoder().encode(user.user_id).buffer);
  if (!userId) return;
  signal({
    rpId: location.hostname,
    userId,
    name: user.near_account,
    displayName: user.display_name || user.near_account,
  }).catch(() => undefined);
}

export async function signInWithPasskey(mode: "login" | "register"): Promise<User> {
  assertBrowserReady();
  const base = `auth/passkeys/${mode}`;
  if (mode === "register") {
    const challenge = await fliqApi<Challenge<CreationJson>>(`${base}/options`, { method: "POST" });
    assertBrowserReady(challenge.options.rp.id);
    const credential = await requestCredential(
      navigator.credentials.create({
        publicKey: {
          ...challenge.options,
          timeout: 180_000,
          challenge: decode(challenge.options.challenge),
          user: {
            ...challenge.options.user,
            id: decode(challenge.options.user.id),
            displayName: challenge.options.user.displayName?.trim() || challenge.options.user.name,
          },
          excludeCredentials: challenge.options.excludeCredentials?.map((item) => ({
            ...item,
            id: decode(item.id),
          })),
          // Lets the passkey make the same NEAR signing key in any browser. Ignored where it is not supported.
          extensions: { ...challenge.options.extensions, prf: {} } as AuthenticationExtensionsClientInputs,
        },
      }),
      "register",
    );
    if (!credential) throw new Error("Passkey creation was cancelled.");
    const response = credential.response as AuthenticatorAttestationResponse;
    const result = await fliqApi<{ user: User }>(`${base}/verify`, {
      method: "POST",
      body: JSON.stringify({
        challenge_id: challenge.challenge_id,
        credential: {
          id: credential.id,
          rawId: encode(credential.rawId),
          type: credential.type,
          authenticatorAttachment: credential.authenticatorAttachment,
          clientExtensionResults: withoutPrf(credential),
          response: {
            clientDataJSON: encode(response.clientDataJSON),
            attestationObject: encode(response.attestationObject),
            transports: response.getTransports?.() ?? [],
          },
        },
      }),
    });
    return result.user;
  }

  const [challenge, salt] = await Promise.all([
    fliqApi<Challenge<RequestJson>>(`${base}/options`, { method: "POST" }),
    passkeyKeySalt(),
  ]);
  assertBrowserReady(challenge.options.rpId);
  const credential = await requestCredential(
    navigator.credentials.get({
      publicKey: {
        ...challenge.options,
        timeout: 180_000,
        challenge: decode(challenge.options.challenge),
        allowCredentials: challenge.options.allowCredentials?.map((item) => ({
          ...item,
          id: decode(item.id),
        })),
        extensions: { ...challenge.options.extensions, prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    }),
    "login",
  );
  if (!credential) throw new PasskeyPromptError("Passkey sign-in was cancelled.");
  const response = credential.response as AuthenticatorAssertionResponse;
  const result = await fliqApi<{ user: User }>(`${base}/verify`, {
    method: "POST",
    body: JSON.stringify({
      challenge_id: challenge.challenge_id,
      credential: {
        id: credential.id,
        rawId: encode(credential.rawId),
        type: credential.type,
        authenticatorAttachment: credential.authenticatorAttachment,
        clientExtensionResults: withoutPrf(credential),
        response: {
          clientDataJSON: encode(response.clientDataJSON),
          authenticatorData: encode(response.authenticatorData),
          signature: encode(response.signature),
          userHandle: encode(response.userHandle),
        },
      },
    }),
  });
  // A passkey that can make the signing key lets this browser pay with no recovery code. Never blocks sign-in.
  const secret = prfSecret(credential);
  if (secret) await adoptPasskeyKey(result.user, secret).catch(() => undefined);
  return result.user;
}
