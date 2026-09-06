#!/usr/bin/env node
/**
 * Forwards manufacturer devicebroker callbacks to PayrollPH and injects
 * BIOMETRIC_GATEWAY_SECRET. The SDK is not modified.
 *
 * devicebroker --webapp-url http://127.0.0.1:8082
 * proxy        -> http://127.0.0.1:3000/api/device/*
 */
import http from "node:http";

const listenPort = Number(process.env.BIOMETRIC_GATEWAY_PROXY_PORT || 8082);
const target = new URL(process.env.PAYROLLPH_URL || "http://127.0.0.1:3000");
const secret = String(process.env.BIOMETRIC_GATEWAY_SECRET || "").trim();

if (!secret) {
  console.error("BIOMETRIC_GATEWAY_SECRET is required for the biometric gateway proxy.");
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const incoming = new URL(req.url, `http://127.0.0.1:${listenPort}`);
  const pathname = incoming.pathname.startsWith("/api/")
    ? incoming.pathname
    : `/api${incoming.pathname}`;
  const chunks = [];
  req.on("data", (chunk) => chunks.push(chunk));
  req.on("end", () => {
    const body = Buffer.concat(chunks);
    const forwarded = http.request({
      hostname: target.hostname,
      port: target.port || (target.protocol === "https:" ? 443 : 80),
      path: `${pathname}${incoming.search}`,
      method: req.method,
      headers: {
        "content-type": req.headers["content-type"] || "application/json",
        "content-length": Buffer.byteLength(body),
        authorization: `Bearer ${secret}`,
      },
    }, (upstream) => {
      res.writeHead(upstream.statusCode || 502, upstream.headers);
      upstream.pipe(res);
    });
    forwarded.on("error", (error) => {
      res.writeHead(502, { "content-type": "application/json" });
      res.end(JSON.stringify({ reason: "GATEWAY_PROXY_UPSTREAM_FAILED", error: error.message }));
    });
    forwarded.end(body);
  });
});

server.listen(listenPort, "0.0.0.0", () => {
  console.log(`Biometric gateway proxy listening on ${listenPort} -> ${target.origin}/api/device/*`);
});
