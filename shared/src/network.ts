import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import ipaddr from 'ipaddr.js';

export function isPublicAddress(address: string): boolean {
  try { return ipaddr.process(address).range() === 'unicast'; } catch { return false; }
}
export function normalizeTarget(value: string): URL {
  if (value.length > 2048) throw new Error('URL troppo lungo');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
    throw new Error('Sono ammessi solo URL HTTP/HTTPS senza credenziali');
  if (url.port && !['80', '443'].includes(url.port)) throw new Error('Porta non consentita');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || !host.includes('.') && !host.includes(':'))
    throw new Error('Host locale non consentito');
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new Error('Indirizzo privato o riservato non consentito');
  url.hash = ''; return url;
}
export interface SafeResponse { status: number; headers: Record<string, string>; body: Buffer; url: string; }
export interface RequestOptions { maxBytes?: number; timeoutMs?: number; followRedirects?: boolean; method?: 'GET' | 'HEAD'; }
export type SafeClient = (url: string, options?: RequestOptions) => Promise<SafeResponse>;
export type Resolver = (host: string) => Promise<{ address: string; family: number }[]>;
export function createSafeClient(resolve: Resolver = host => dns.lookup(host, { all: true, verbatim: true })): SafeClient {
  async function request(value: string, options: RequestOptions = {}, redirects = 0, expiresAt = Date.now() + (options.timeoutMs ?? 10_000)): Promise<SafeResponse> {
    if (Date.now() >= expiresAt) throw new Error('Tempo massimo della richiesta superato');
    const url = normalizeTarget(value);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    let dnsTimer: ReturnType<typeof setTimeout> | undefined;
    const lookup = () => Promise.race([resolve(host), new Promise<never>((_resolve, reject) => { dnsTimer = setTimeout(() => reject(new Error('Timeout DNS')), Math.min(5000, expiresAt - Date.now())); })]).finally(() => clearTimeout(dnsTimer));
    const addresses = ipaddr.isValid(host) ? [{ address: host, family: ipaddr.parse(host).kind() === 'ipv6' ? 6 : 4 }] : await lookup();
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('DNS verso una rete privata o riservata: richiesta bloccata');
    const pinned = addresses.find(a => a.family === 4) || addresses[0];
    const response = await new Promise<SafeResponse>((resolveResponse, reject) => {
      const req = (url.protocol === 'https:' ? https : http).request(url, {
        method: options.method || 'GET', agent: false,
        headers: { 'user-agent': 'LaunchCheck/0.1 (+authorized-website-audits)', 'accept-encoding': 'identity' },
        // Pin the validated address: do not perform a second DNS lookup at connection time.
        lookup: ((_host: string, options: any, callback: Function) => options?.all ? callback(null, [pinned]) : callback(null, pinned.address, pinned.family)) as any
      }, res => {
        const chunks: Buffer[] = []; let bytes = 0;
        res.on('data', chunk => {
          bytes += chunk.length;
          if (bytes > (options.maxBytes ?? 5_000_000)) req.destroy(new Error('Risorsa oltre il limite di dimensione'));
          else chunks.push(Buffer.from(chunk));
        });
        res.on('error', reject);
        res.on('end', () => {
          const headers: Record<string,string> = {};
          for (const [key, value] of Object.entries(res.headers)) if (value !== undefined) headers[key] = Array.isArray(value) ? value.join(', ') : value;
          delete headers['transfer-encoding']; delete headers['content-length'];
          resolveResponse({ status: res.statusCode || 502, headers, body: Buffer.concat(chunks), url: url.href });
        });
      });
      const deadline = setTimeout(() => req.destroy(new Error('Tempo massimo della richiesta superato')), Math.max(1, expiresAt - Date.now()));
      req.on('close', () => clearTimeout(deadline));
      req.setTimeout(options.timeoutMs ?? 10_000, () => req.destroy(new Error('Timeout di rete')));
      req.on('error', reject); req.end();
    });
    if (options.followRedirects !== false && [301,302,303,307,308].includes(response.status) && response.headers.location) {
      if (redirects >= 5) throw new Error('Troppi redirect');
      return request(new URL(response.headers.location, url).href, options, redirects + 1, expiresAt);
    }
    return response;
  }
  return request;
}
export const safeRequest = createSafeClient();
