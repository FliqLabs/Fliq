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
    if (error instanceof DOMException && error.name === "NotAllowedError") {
      throw new Error(
        mode === "login"
          ? "Passkey sign-in did not complete. Use the device where you saved your passkey. If using a phone, check that it has a passkey for this site and that Bluetooth and internet are available on both devices."
          : "Passkey setup did not complete. If you used a phone, check Bluetooth and internet on both devices, then try again. You can also save the passkey on this computer.",
      );
    }
    throw error;
  }
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
          clientExtensionResults: credential.getClientExtensionResults(),
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

  const challenge = await fliqApi<Challenge<RequestJson>>(`${base}/options`, { method: "POST" });
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
      },
    }),
    "login",
  );
  if (!credential) throw new Error("Passkey sign-in was cancelled.");
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
        clientExtensionResults: credential.getClientExtensionResults(),
        response: {
          clientDataJSON: encode(response.clientDataJSON),
          authenticatorData: encode(response.authenticatorData),
          signature: encode(response.signature),
          userHandle: encode(response.userHandle),
        },
      },
    }),
  });
  return result.user;
}
