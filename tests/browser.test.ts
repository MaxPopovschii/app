import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runAudit } from '../worker/src/audit';
import { report, fixtureClient } from './helpers';
test('real browser finds reproducible defects in two viewports and compares a fixed baseline', { timeout: 120_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'launchcheck-')); const requests: string[] = [];
  try {
    const first = await runAudit(report(), { artifactDir: dir, client: fixtureClient(false, requests) });
    assert.equal(first.status, 'complete', JSON.stringify({ error: first.error, pages: first.pages })); assert.equal(first.pages.length,4);
    assert.ok(first.findings.some(f => f.kind === 'broken-link'));
    assert.ok(first.findings.some(f => f.kind === 'broken-image'));
    assert.ok(first.findings.some(f => f.kind === 'javascript-error'));
    assert.ok(first.findings.some(f => f.kind === 'horizontal-overflow' && f.viewport === 'mobile'));
    assert.ok(!first.findings.some(f => f.kind === 'horizontal-overflow' && f.viewport === 'desktop'));
    assert.ok(!requests.some(url => url.includes('external.example')));
    assert.ok(!requests.some(url => url.endsWith('/private')));
    const second = await runAudit(report(), { artifactDir: dir, client: fixtureClient(true), baseline: first });
    assert.equal(second.status,'complete');
    assert.ok(second.resolvedSinceBaseline.some(f => f.kind === 'broken-image'));
    assert.ok(second.findings.some(f => f.source === 'visual-comparison'));
    assert.ok(second.pages.some(p => p.diffScreenshot));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
