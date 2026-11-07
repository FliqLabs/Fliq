import { request as httpsRequest } from "node:https";
import {
  BlockedDestination,
  guardedLookup,
  parseWebhookUrl,
  systemResolve,
  type Resolve,
} from "./destination.js";

export interface OutboundRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  // Idle time on the socket.
  timeoutMs: number;
  // Total time for the whole exchange, response body included.
  deadlineMs: number;
}

export type ErrorKind = "timeout" | "connection" | "blocked_destination" | "tls" | "internal";

export type Outcome = { status: number } | { error: ErrorKind };

export type Transport = (request: OutboundRequest) => Promise<Outcome>;

const MAX_RESPONSE_BYTES = 64 * 1024;

// Redirects are not followed: a 3xx counts as a failed attempt, so a redirect cannot lead to an internal host.
export function httpsTransport(resolve: Resolve = systemResolve): Transport {
  const lookup = guardedLookup(resolve);
  return (outbound) =>
    new Promise<Outcome>((resolve) => {
      let deadline: NodeJS.Timeout | undefined;
      let settled = false;
      const done = (outcome: Outcome) => {
        if (settled) return;
        settled = true;
        clearTimeout(deadline);
        resolve(outcome);
      };
      let url: URL;
      try {
        url = parseWebhookUrl(outbound.url);
      } catch {
        done({ error: "blocked_destination" });
        return;
      }
      const request = httpsRequest(
        url,
        {
          method: "POST",
          headers: { ...outbound.headers, "content-length": Buffer.byteLength(outbound.body).toString() },
          lookup,
          timeout: outbound.timeoutMs,
        },
        (response) => {
          let received = 0;
          response.on("data", (chunk: Buffer) => {
            received += chunk.length;
            if (received > MAX_RESPONSE_BYTES) response.destroy();
          });
          response.on("close", () => done({ status: response.statusCode ?? 0 }));
          response.on("error", () => done({ status: response.statusCode ?? 0 }));
        },
      );
      request.on("timeout", () => request.destroy(new Error("timeout")));
      // The idle timeout resets on every byte, so a receiver that drips its response would never hit it.
      deadline = setTimeout(() => {
        done({ error: "timeout" });
        request.destroy(new Error("timeout"));
      }, outbound.deadlineMs);
      request.on("error", (error: Error & { code?: string }) => {
        if (error instanceof BlockedDestination) return done({ error: "blocked_destination" });
        if (error.message === "timeout") return done({ error: "timeout" });
        if (error.code?.startsWith("ERR_TLS") || error.code?.includes("CERT")) return done({ error: "tls" });
        done({ error: "connection" });
      });
      request.end(outbound.body);
    });
}
