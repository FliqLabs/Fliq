export type AlertConfig = { botToken: string; chatId: string };

export type AlertDeps = {
  config: AlertConfig | null;
  log: (message: string) => void;
  now?: () => number;
  send?: (config: AlertConfig, text: string) => Promise<void>;
};

const REPEAT_AFTER_MS = 30 * 60_000;
const MAX_PER_MINUTE = 20;
const SEND_TIMEOUT_MS = 4_000;

export function alertConfigFromEnv(env: Record<string, string | undefined>): AlertConfig | null {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  const chatId = env.TELEGRAM_ALERT_CHAT_ID?.trim();
  return botToken && chatId ? { botToken, chatId } : null;
}

async function sendToTelegram(config: AlertConfig, text: string): Promise<void> {
  const reply = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: config.chatId, text, disable_web_page_preview: true }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!reply.ok) throw new Error(`telegram ${reply.status}`);
}

// Everything is logged; with a Telegram bot configured it also reaches a person. The same line is not repeated for
// half an hour and a burst is capped, so a sweep that fails every 20 s cannot bury the channel. Sending never throws
// and is never awaited by the caller: an alert must not slow or break the money path it reports on.
export function createAlerts(deps: AlertDeps): (message: string) => void {
  const now = deps.now ?? Date.now;
  const send = deps.send ?? sendToTelegram;
  const lastSent = new Map<string, number>();
  let windowStart = 0;
  let sentInWindow = 0;
  return (message) => {
    deps.log(message);
    const config = deps.config;
    if (!config) return;
    const at = now();
    if (at - (lastSent.get(message) ?? -Infinity) < REPEAT_AFTER_MS) return;
    if (at - windowStart >= 60_000) [windowStart, sentInWindow] = [at, 0];
    if (sentInWindow >= MAX_PER_MINUTE) return;
    sentInWindow += 1;
    lastSent.set(message, at);
    if (lastSent.size > 5_000) lastSent.clear();
    void send(config, `fliq: ${message}`).catch((error: Error) => deps.log(`[alerts] not delivered: ${error.name}`));
  };
}

// True on the call that makes `count` events within `windowMs`. One user typing an amount no provider takes is not an
// outage; several failures close together are.
export function createBurst(count: number, windowMs: number, now: () => number = Date.now): () => boolean {
  let times: number[] = [];
  return () => {
    const at = now();
    times = times.filter((time) => at - time < windowMs);
    times.push(at);
    if (times.length < count) return false;
    times = [];
    return true;
  };
}
