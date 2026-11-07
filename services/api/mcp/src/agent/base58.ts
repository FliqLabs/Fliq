const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const INDEX = new Map([...ALPHABET].map((char, i) => [char, BigInt(i)]));

export function base58Decode(text: string): Uint8Array {
  let value = 0n;
  for (const char of text) {
    const digit = INDEX.get(char);
    if (digit === undefined) throw new Error("Not a base58 string.");
    value = value * 58n + digit;
  }
  const bytes: number[] = [];
  for (; value > 0n; value >>= 8n) bytes.unshift(Number(value & 0xffn));
  const zeros = text.length - text.replace(/^1+/, "").length;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

export function base58Encode(bytes: Uint8Array): string {
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let text = "";
  for (; value > 0n; value /= 58n) text = ALPHABET[Number(value % 58n)] + text;
  const zeros = bytes.findIndex((byte) => byte !== 0);
  return "1".repeat(zeros < 0 ? bytes.length : zeros) + text;
}
