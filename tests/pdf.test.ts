import { describe, it, expect } from "vitest";
import { deflateSync } from "node:zlib";
import { extractPdfText } from "../src/core/pdf.js";

const pdfWith = (stream: Buffer, filter = "/FlateDecode") =>
  Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj << /Filter ${filter} >>\nstream\n`, "latin1"),
    stream,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);

describe("extractPdfText", () => {
  it("reads the text of a compressed content stream", () => {
    const text = extractPdfText(pdfWith(deflateSync(Buffer.from("BT /F1 12 Tf (Week 3 reading list) Tj ET", "latin1"))));
    expect(text).toContain("Week 3 reading list");
  });

  it("returns null for a file that is not a PDF", () => {
    expect(extractPdfText(Buffer.from("just some text"))).toBeNull();
  });

  it("refuses a small stream that would expand into hundreds of megabytes", () => {
    const bomb = deflateSync(Buffer.alloc(200 * 1024 * 1024, 65));
    expect(bomb.length).toBeLessThan(1024 * 1024);
    const before = process.memoryUsage().rss;
    const started = Date.now();
    extractPdfText(pdfWith(bomb));
    expect(Date.now() - started).toBeLessThan(2000);
    expect(process.memoryUsage().rss - before).toBeLessThan(100 * 1024 * 1024);
  });
});

import { readCapped } from "../src/tools.js";

describe("readCapped", () => {
  const stream = (chunks: number, size: number) =>
    new Response(new ReadableStream({ start(c) { for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(size)); c.close(); } }));

  it("reads a body that fits", async () => {
    const buf = await readCapped(stream(4, 1000), 10_000);
    expect(buf?.byteLength).toBe(4000);
  });

  it("gives up once the body passes the limit", async () => {
    expect(await readCapped(stream(20, 1000), 10_000)).toBeNull();
  });

  it("refuses a file the server says is too big before reading it", async () => {
    const res = new Response("x", { headers: { "content-length": String(500 * 1024 * 1024) } });
    expect(await readCapped(res, 25 * 1024 * 1024)).toBeNull();
  });
});
