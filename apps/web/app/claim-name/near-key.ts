const DATABASE_NAME = "fliq-near-keys";
const STORE_NAME = "keys";
const RECOVERY_PREFIX = "fliq-";
const RECOVERY_VERSION = 1;
const KEY_LENGTH = 32;
const CHECKSUM_LENGTH = 4;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

export type StoredNearKey = {
  userId: string;
  publicKey: string;
  privateKey: CryptoKey;
  claim?: { name: string; accountName: string; idempotencyKey: string };
};

export type NewNearKey = Pick<StoredNearKey, "publicKey" | "privateKey"> & {
  recoveryCode: string;
};

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase58(bytes: Uint8Array): string {
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index++) {
      carry += digits[index] * 256;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += "1";
  }
  for (let index = digits.length - 1; index >= 0; index--) {
    if (index === 0 && digits[index] === 0 && result) break;
    result += BASE58_ALPHABET[digits[index]];
  }
  return result;
}

async function checksum(bytes: Uint8Array): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest).slice(0, CHECKSUM_LENGTH);
}

async function importPrivateKey(secret: Uint8Array, publicBytes: Uint8Array): Promise<CryptoKey> {
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    {
      kty: "OKP",
      crv: "Ed25519",
      d: encodeBase64Url(secret),
      x: encodeBase64Url(publicBytes),
    },
    "Ed25519",
    false,
    ["sign"],
  );
  const publicKey = await crypto.subtle.importKey("raw", publicBytes, "Ed25519", false, ["verify"]);
  const challenge = crypto.getRandomValues(new Uint8Array(KEY_LENGTH));
  const signature = await crypto.subtle.sign("Ed25519", privateKey, challenge);
  if (!(await crypto.subtle.verify("Ed25519", publicKey, signature, challenge))) {
    throw new Error("The recovery code does not contain a matching NEAR key pair.");
  }
  return privateKey;
}

export async function createNearKey(): Promise<NewNearKey> {
  if (!crypto.subtle || typeof indexedDB === "undefined") {
    throw new Error("This browser cannot securely store a NEAR key.");
  }

  const pair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const privateJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  if (!privateJwk.d || !privateJwk.x) throw new Error("The browser could not export the recovery code.");

  const secret = decodeBase64Url(privateJwk.d);
  const publicBytes = decodeBase64Url(privateJwk.x);
  if (secret.length !== KEY_LENGTH || publicBytes.length !== KEY_LENGTH) {
    throw new Error("The browser returned an invalid NEAR key.");
  }

  const payload = new Uint8Array(1 + KEY_LENGTH * 2);
  payload[0] = RECOVERY_VERSION;
  payload.set(secret, 1);
  payload.set(publicBytes, 1 + KEY_LENGTH);
  const code = new Uint8Array(payload.length + CHECKSUM_LENGTH);
  code.set(payload);
  code.set(await checksum(payload), payload.length);

  const privateKey = await importPrivateKey(secret, publicBytes);
  secret.fill(0);

  return {
    publicKey: `ed25519:${encodeBase58(publicBytes)}`,
    privateKey,
    recoveryCode: RECOVERY_PREFIX + encodeBase64Url(code),
  };
}

export async function recoverNearKey(
  recoveryCode: string,
): Promise<Pick<StoredNearKey, "publicKey" | "privateKey">> {
  const normalized = recoveryCode.trim();
  if (!normalized.startsWith(RECOVERY_PREFIX)) throw new Error("Enter a valid fliq recovery code.");

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64Url(normalized.slice(RECOVERY_PREFIX.length));
  } catch {
    throw new Error("Enter a valid fliq recovery code.");
  }

  const payloadLength = 1 + KEY_LENGTH * 2;
  if (bytes.length !== payloadLength + CHECKSUM_LENGTH || bytes[0] !== RECOVERY_VERSION) {
    throw new Error("Enter a valid fliq recovery code.");
  }
  const payload = bytes.slice(0, payloadLength);
  const expected = await checksum(payload);
  if (!expected.every((byte, index) => byte === bytes[payloadLength + index])) {
    throw new Error("The recovery code has a typo. Check it and try again.");
  }

  const secret = payload.slice(1, 1 + KEY_LENGTH);
  const publicBytes = payload.slice(1 + KEY_LENGTH);
  const privateKey = await importPrivateKey(secret, publicBytes);
  secret.fill(0);
  payload.fill(0);
  bytes.fill(0);

  return { publicKey: `ed25519:${encodeBase58(publicBytes)}`, privateKey };
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "userId" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open secure browser storage."));
  });
}

export async function loadNearKey(userId: string): Promise<StoredNearKey | undefined> {
  const database = await openDatabase();
  try {
    return await new Promise((resolve, reject) => {
      const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(userId);
      request.onsuccess = () => resolve(request.result as StoredNearKey | undefined);
      request.onerror = () => reject(new Error("Could not read the NEAR key from this browser."));
    });
  } finally {
    database.close();
  }
}

export async function saveNearKey(key: StoredNearKey): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).put(key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(new Error("Could not save the NEAR key on this device."));
      transaction.onabort = () => reject(new Error("Could not save the NEAR key on this device."));
    });
  } finally {
    database.close();
  }
}
