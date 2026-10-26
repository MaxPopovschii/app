export type ViewportName = 'desktop' | 'mobile';
export type Severity = 'high' | 'medium' | 'low';
export interface Finding {
  id: string; fingerprint: string; kind: string; severity: Severity;
  url: string; viewport: ViewportName; title: string; detail: string;
  selector?: string; evidence?: string; recommendation: string;
  status: 'open' | 'resolved' | 'ignored'; change: 'new' | 'existing';
  source: 'automated' | 'visual-comparison';
}
export interface PageResult {
  url: string; viewport: ViewportName; status: 'done' | 'failed' | 'blocked';
  screenshot?: string; diffScreenshot?: string; error?: string;
  httpStatus?: number; durationMs: number; changedPixelsPercent?: number;
}
export interface AuditReport {
  id: string; url: string; agency: string; client: string; logo?: string;
  status: 'queued' | 'running' | 'complete' | 'partial' | 'failed';
  createdAt: string; updatedAt: string; completedAt?: string;
  maxPages: number; scannedPages: number; totalPages: number;
  baselineId?: string; pages: PageResult[]; findings: Finding[];
  resolvedSinceBaseline: Finding[]; notes: string[]; error?: string;
}
export const VIEWPORTS = [
  { name: 'desktop' as const, width: 1440, height: 900 },
  { name: 'mobile' as const, width: 390, height: 844 }
];
export function isFinished(status: AuditReport['status']) {
  return ['complete', 'partial', 'failed'].includes(status);
}
