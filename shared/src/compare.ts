import { createHash } from 'node:crypto';
import { AuditReport, Finding } from './types';
export function fingerprint(kind: string, url: string, viewport: string, selector = '') {
  return createHash('sha256').update(JSON.stringify([kind, url, viewport, selector])).digest('hex').slice(0,24);
}
export function compareWithBaseline(report: AuditReport, baseline?: AuditReport) {
  if (!baseline) return;
  const known = new Set(baseline.findings.map(f => f.fingerprint));
  report.findings.forEach(f => { f.change = known.has(f.fingerprint) ? 'existing' : 'new'; });
  const current = new Set(report.findings.map(f => f.fingerprint));
  const covered = new Set(report.pages.filter(p => p.status === 'done').map(p => p.url + '|' + p.viewport));
  // A failed or unvisited page cannot prove that an old problem disappeared.
  report.resolvedSinceBaseline = baseline.findings.filter(f => !current.has(f.fingerprint) && covered.has(f.url + '|' + f.viewport));
}
