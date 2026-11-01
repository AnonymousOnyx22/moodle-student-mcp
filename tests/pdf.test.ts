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

import { vi, afterEach } from "vitest";
import { tools } from "../src/tools.js";

describe("get_file with a PDF", () => {
  const getFile = tools.find((t) => t.name === "get_file")!;
  const api: any = { baseUrl: "https://moodle.example.edu", token: "secret123" };
  const mockFetch = (body: Buffer, type = "application/pdf") => {
    const fn = vi.fn(async () => new Response(new Uint8Array(body), { headers: { "content-type": type } }));
    vi.stubGlobal("fetch", fn);
    return fn;
  };
  const run = (file_url: string) => (getFile.run as any)({ file_url }, api) as Promise<string>;

  afterEach(() => vi.unstubAllGlobals());

  it("refuses a link on another server without fetching it", async () => {
    const fn = mockFetch(Buffer.from("%PDF-1.4"));
    await expect(run("https://evil.example.com/file.pdf")).rejects.toThrow(/another server/);
    expect(fn).not.toHaveBeenCalled();
  });

  it("strips the token from the link of a PDF with no extractable text", async () => {
    const fn = mockFetch(pdfWith(deflateSync(Buffer.from("q 1 0 0 1 0 0 cm Q", "latin1"))));
    const out = await run("https://moodle.example.edu/webservice/pluginfile.php/5/slides.pdf?token=abc&forcedownload=1");
    expect(out).toContain("slides.pdf");
    expect(out).toContain("cannot be read as text");
    expect(out).not.toContain("abc");
    expect(out).not.toContain("secret123");
    expect(out).not.toMatch(/token=/);
    expect(out).toContain("forcedownload=1");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("sends the saved key when the link has none, but never shows it", async () => {
    const fn = mockFetch(pdfWith(deflateSync(Buffer.from("BT (Hello) Tj ET", "latin1"))));
    const out = await run("/webservice/pluginfile.php/5/a.pdf");
    expect(out).toBe("Hello");
    expect((fn.mock.calls[0] as any)[0]).toContain("token=secret123");
  });

  it("gives the too big note when the server reports a huge file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x", { headers: { "content-length": String(500 * 1024 * 1024) } })),
    );
    const out = await run("https://moodle.example.edu/pluginfile.php/5/big.pdf?token=abc");
    expect(out).toContain("was not downloaded");
    expect(out).not.toContain("abc");
  });
});
