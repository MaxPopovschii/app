import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPublicAddress,
  normalizeTarget,
  createSafeClient,
  compareWithBaseline,
  fingerprint,
} from "@launchcheck/shared";
import { report } from "./helpers";
test("rejects alternate IP encodings, credentials, private IPv4/IPv6 and unsupported ports", () => {
  for (const value of [
    "http://localhost/",
    "http://127.1/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://169.254.169.254/",
    "http://10.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://[fc00::1]/",
    "http://example.com:8080/",
    "file:///etc/passwd",
    "https://user:pass@example.com",
  ])
    assert.throws(() => normalizeTarget(value), undefined, value);
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("224.0.0.1"), false);
  assert.equal(isPublicAddress("2001:db8::1"), false);
  assert.equal(
    normalizeTarget("https://example.com/#secret").href,
    "https://example.com/",
  );
});
test("rejects mixed DNS answers before connecting, preventing private rebinding targets", async () => {
  const request = createSafeClient(async () => [
    { address: "93.184.216.34", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  await assert.rejects(request("https://example.com"), /DNS/);
});
test("failed and unvisited pages never count as resolved baseline issues", () => {
  const baseline = report(),
    next = report();
  baseline.findings = [
    {
      id: "a",
      fingerprint: fingerprint("image", baseline.url, "mobile"),
      url: baseline.url,
      viewport: "mobile",
      kind: "image",
      severity: "medium",
      title: "Image",
      detail: "error",
      recommendation: "fix",
      source: "automated",
      status: "open",
      change: "new",
    },
  ];
  next.pages = [
    { url: baseline.url, viewport: "mobile", status: "failed", durationMs: 1 },
  ];
  compareWithBaseline(next, baseline);
  assert.equal(next.resolvedSinceBaseline.length, 0);
  next.pages[0].status = "done";
  compareWithBaseline(next, baseline);
  assert.equal(next.resolvedSinceBaseline.length, 1);
  next.pages[0].httpStatus = 404;
  compareWithBaseline(next, baseline);
  assert.equal(next.resolvedSinceBaseline.length, 0);
  next.pages[0].httpStatus = 200;
  next.pages[0].comparisonEligible = false;
  compareWithBaseline(next, baseline);
  assert.equal(next.resolvedSinceBaseline.length, 0);
});

test("HTTP transport pins a public DNS result and rejects a redirect to cloud metadata before connecting", async () => {
  const http = await import("node:http");
  const { EventEmitter } = await import("node:events");
  const { mock } = await import("node:test");
  let calls = 0,
    lookups = 0;
  const requestMock = mock.method(
    http.default,
    "request",
    (_url: URL, options: any, onResponse: Function) => {
      calls++;
      options.lookup(
        "public.example",
        { all: true },
        (err: any, addresses: any) => {
          assert.equal(err, null);
          assert.deepEqual(addresses, [
            { address: "93.184.216.34", family: 4 },
          ]);
        },
      );
      const req: any = new EventEmitter();
      req.setTimeout = () => req;
      req.destroy = (err: Error) => {
        req.emit("error", err);
        req.emit("close");
      };
      req.end = () =>
        queueMicrotask(() => {
          const res: any = new EventEmitter();
          res.statusCode = 302;
          res.headers = {
            location: "http://169.254.169.254/latest/meta-data/",
          };
          onResponse(res);
          res.emit("end");
          req.emit("close");
        });
      return req;
    },
  );
  try {
    const request = createSafeClient(async () => {
      lookups++;
      return [{ address: "93.184.216.34", family: 4 }];
    });
    await assert.rejects(
      request("http://public.example/"),
      /privato|riservato/,
    );
    assert.equal(calls, 1);
    assert.equal(lookups, 1);
  } finally {
    requestMock.mock.restore();
  }
});
