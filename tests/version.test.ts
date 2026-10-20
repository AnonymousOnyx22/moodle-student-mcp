import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { VERSION, createServer } from "../src/server.js";
import { createMoodleApi } from "../src/moodle.js";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
const serverJson = JSON.parse(readFileSync(new URL("../server.json", import.meta.url), "utf8")) as {
  version: string;
  description: string;
  packages: { version: string }[];
};

describe("the version of the release", () => {
  it("is the same in package.json, server.json and the server code", () => {
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.packages[0].version).toBe(pkg.version);
    expect(VERSION).toBe(pkg.version);
  });

  it("is what the server tells a client when it connects", async () => {
    const server = createServer(createMoodleApi("http://127.0.0.1:1", "token"));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "test", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);
    expect(client.getServerVersion()?.version).toBe(pkg.version);
  });

  it("keeps the server.json description inside the registry limit", () => {
    expect(serverJson.description.length).toBeLessThanOrEqual(100);
  });
});
