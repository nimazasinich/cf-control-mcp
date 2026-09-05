import test from "node:test";
import assert from "node:assert/strict";
import { assertSafeUrl } from "../src/internet/ssrf";
import { InternetError } from "../src/internet/types";

function blocked(url: string) {
  try {
    assertSafeUrl(url);
    return false;
  } catch (e) {
    return e instanceof InternetError && e.code === "BLOCKED_TARGET";
  }
}

test("allows normal public https URLs", () => {
  assert.equal(assertSafeUrl("https://example.com/path?q=1").hostname, "example.com");
  assert.equal(assertSafeUrl("http://93.184.216.34/").hostname, "93.184.216.34");
});

test("blocks localhost and loopback literals", () => {
  assert.ok(blocked("http://localhost/"));
  assert.ok(blocked("http://127.0.0.1/"));
  assert.ok(blocked("http://127.99.1.2/"));
});

test("blocks loopback in obfuscated IPv4 notations", () => {
  assert.ok(blocked("http://2130706433/"));      // decimal 127.0.0.1
  assert.ok(blocked("http://0x7f000001/"));       // hex
  assert.ok(blocked("http://017700000001/"));      // octal
  assert.ok(blocked("http://0x7f.1/"));            // mixed short form
});

test("blocks RFC1918 private ranges", () => {
  assert.ok(blocked("http://10.0.0.5/"));
  assert.ok(blocked("http://192.168.1.1/"));
  assert.ok(blocked("http://172.16.0.1/"));
  assert.ok(blocked("http://172.31.255.255/"));
});

test("blocks link-local and cloud metadata", () => {
  assert.ok(blocked("http://169.254.169.254/latest/meta-data/"));
  assert.ok(blocked("http://metadata.google.internal/"));
  assert.ok(blocked("http://100.100.100.200/"));
});

test("blocks carrier-grade NAT and unspecified", () => {
  assert.ok(blocked("http://100.64.0.1/"));
  assert.ok(blocked("http://0.0.0.0/"));
});

test("blocks IPv6 loopback / ULA / link-local", () => {
  assert.ok(blocked("http://[::1]/"));
  assert.ok(blocked("http://[fc00::1]/"));
  assert.ok(blocked("http://[fe80::1]/"));
  assert.ok(blocked("http://[::ffff:127.0.0.1]/"));
});

test("blocks *.internal and *.local hostnames", () => {
  assert.ok(blocked("http://foo.internal/"));
  assert.ok(blocked("http://printer.local/"));
});

test("rejects non-http schemes as INVALID/BLOCKED", () => {
  let threw = false;
  try {
    assertSafeUrl("ftp://example.com/");
  } catch (e) {
    threw = e instanceof InternetError;
  }
  assert.ok(threw);
});
