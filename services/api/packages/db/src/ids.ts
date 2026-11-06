import { randomBytes } from "node:crypto";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export type IdPrefix =
  | "usr"
  | "pk"
  | "chl"
  | "ses"
  | "eml"
  | "ws"
  | "key"
  | "q"
  | "qr"
  | "po"
  | "tr"
  | "hc"
  | "inc"
  | "pev"
  | "rcp"
  | "acc"
  | "je"
  | "jl"
  | "obx"
  | "tmr"
  | "dlq"
  | "ine"
  | "aud"
  | "whe"
  | "whd"
  | "wha"
  | "evt";

function encodeBase32(value: bigint, length: number): string {
  let out = "";
  let rest = value;
  for (let i = 0; i < length; i++) {
    out = CROCKFORD[Number(rest & 31n)] + out;
    rest >>= 5n;
  }
  return out;
}

export function ulid(now: number = Date.now()): string {
  const randomPart = BigInt(`0x${randomBytes(10).toString("hex")}`);
  return encodeBase32(BigInt(now), 10) + encodeBase32(randomPart, 16);
}

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${ulid().toLowerCase()}`;
}
