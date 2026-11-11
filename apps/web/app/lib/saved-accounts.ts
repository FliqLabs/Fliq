"use client";

/* Saved recipients come back from the API with only the last four digits, as on iOS, which keeps the full number
   it verified on the device. The browser does the same so a second payout to someone needs no retyping. */

const KEY = "fliq-accounts";

function readAll(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}");
  } catch {
    return {};
  }
}

export function savedNumber(recipientId: string): string | null {
  return readAll()[recipientId] ?? null;
}

export function rememberNumber(recipientId: string, number: string) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readAll(), [recipientId]: number }));
  } catch {}
}

export function forgetNumber(recipientId: string) {
  try {
    const all = readAll();
    delete all[recipientId];
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {}
}
