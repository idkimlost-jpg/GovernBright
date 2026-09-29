import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

// Addresses an organization's admin must never be able to point the server at (SSRF):
// loopback, private networks, link-local (including cloud metadata at 169.254.169.254),
// carrier-grade NAT, unique-local IPv6 and IPv4-mapped forms of all of these.
const blocked = new BlockList();
for (const [network, prefix] of [["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8], ["169.254.0.0", 16],
  ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["224.0.0.0", 4], ["240.0.0.0", 4]] as const) {
  blocked.addSubnet(network, prefix, "ipv4");
}
for (const [network, prefix] of [["::", 128], ["::1", 128], ["fc00::", 7], ["fe80::", 10], ["ff00::", 8]] as const) blocked.addSubnet(network, prefix, "ipv6");

export class UnsafeDestinationError extends Error {
  readonly statusCode = 400;
}

export function isBlockedAddress(address: string): boolean {
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address)?.[1];
  if (mapped) return blocked.check(mapped, "ipv4");
  const family = isIP(address);
  return family === 4 ? blocked.check(address, "ipv4") : family === 6 ? blocked.check(address, "ipv6") : true;
}

// Resolves the URL's host and rejects it if any address is internal. allowLoopback lets tests
// talk to local test servers; production never sets it.
export async function assertPublicUrl(url: string, options: { allowLoopback?: boolean } = {}): Promise<void> {
  const { hostname, protocol } = new URL(url);
  const host = hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map(a => a.address);
  if (!addresses.length) throw new UnsafeDestinationError(`Could not resolve ${hostname}`);
  const loopbackOnly = addresses.every(a => a === "127.0.0.1" || a === "::1");
  if (options.allowLoopback && loopbackOnly && protocol === "http:") return;
  if (protocol !== "https:") throw new UnsafeDestinationError(`${hostname} must be reached over https`);
  if (addresses.some(isBlockedAddress)) throw new UnsafeDestinationError(`${hostname} points to a private or internal network address`);
}
