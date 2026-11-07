import { lookup as dnsLookup } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Addresses a webhook must never reach: private networks, loopback, link-local (cloud metadata lives at
// 169.254.169.254), carrier NAT, documentation, multicast and reserved space, in both families.
// One list per family: a single BlockList also matches IPv4 addresses against IPv4-mapped IPv6 subnets.
const BLOCKED_V4 = new BlockList();
const BLOCKED_V6 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  BLOCKED_V4.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [
  ["::", 128],
  ["::1", 128],
  // IPv4-mapped and NAT64 addresses would reach an IPv4 host the checks above did not see.
  ["::ffff:0:0", 96],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
] as const) {
  BLOCKED_V6.addSubnet(network, prefix, "ipv6");
}

const BLOCKED_SUFFIXES = [".localhost", ".local", ".internal", ".lan", ".home.arpa"];
const MAX_URL_LENGTH = 2048;

export class BlockedDestination extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "BlockedDestination";
  }
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return family === 4 ? !BLOCKED_V4.check(address, "ipv4") : !BLOCKED_V6.check(address, "ipv6");
}

export type Resolve = (hostname: string) => Promise<string[]>;

export const systemResolve: Resolve = (hostname) =>
  new Promise((resolve, reject) =>
    dnsLookup(hostname, { all: true }, (error, addresses) =>
      error ? reject(error) : resolve(addresses.map((entry) => entry.address)),
    ),
  );

function bareHost(url: URL): string {
  return url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

// Shape rules only, no network: https, no credentials or fragment, a public-looking host.
export function parseWebhookUrl(raw: string): URL {
  if (raw.length > MAX_URL_LENGTH || !URL.canParse(raw))
    throw new BlockedDestination("url must be a valid URL");
  const url = new URL(raw);
  if (url.protocol !== "https:") throw new BlockedDestination("url must use https");
  if (url.username || url.password) throw new BlockedDestination("url must not contain credentials");
  if (url.hash) throw new BlockedDestination("url must not contain a fragment");
  const host = bareHost(url);
  if (
    host === "localhost" ||
    BLOCKED_SUFFIXES.some((suffix) => host.endsWith(suffix)) ||
    (!host.includes(".") && isIP(host) === 0)
  ) {
    throw new BlockedDestination("url must point at a public host");
  }
  if (isIP(host) !== 0 && !isPublicAddress(host))
    throw new BlockedDestination("url must point at a public address");
  return url;
}

// Every address the name resolves to must be public, so one private record cannot slip through.
export async function checkDestination(raw: string, resolve: Resolve = systemResolve): Promise<URL> {
  const url = parseWebhookUrl(raw);
  const host = bareHost(url);
  if (isIP(host) !== 0) return url;
  let addresses: string[];
  try {
    addresses = await resolve(host);
  } catch {
    throw new BlockedDestination("url host does not resolve");
  }
  if (addresses.length === 0 || !addresses.every(isPublicAddress))
    throw new BlockedDestination("url must point at a public address");
  return url;
}

// Used as the socket's lookup, so the address that is checked is the address that is connected to.
// A name that changes between the check and the connection (DNS rebinding) is refused here.
export function guardedLookup(resolve: Resolve = systemResolve): LookupFunction {
  return (hostname, options, callback) => {
    const done = callback as (
      error: Error | null,
      address: string | { address: string; family: number }[],
      family?: number,
    ) => void;
    resolve(hostname)
      .then((addresses) => {
        if (addresses.length === 0 || !addresses.every(isPublicAddress)) {
          done(new BlockedDestination("destination resolved to a non-public address"), "", 0);
          return;
        }
        const entries = addresses.map((address) => ({ address, family: isIP(address) }));
        if ((options as { all?: boolean }).all) {
          done(null, entries);
          return;
        }
        const first = entries[0] as { address: string; family: number };
        done(null, first.address, first.family);
      })
      .catch((error: Error) => done(error, "", 0));
  };
}
