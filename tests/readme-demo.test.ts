import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { demoTranscript } from "./demo.js";

// The transcript shows times in UTC so it reads the same wherever it is generated.
process.env.TZ = "UTC";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

/** The transcript block in the README demo section. */
function readmeBlock(): string {
  const section = (readme.split("## Demo")[1] ?? "").split("\n## ")[0];
  const match = /```text\n([\s\S]*?)```/.exec(section);
  if (!match) throw new Error("no demo transcript block in the README");
  return match[1].trimEnd();
}

/** Compare line by line, and let the clock style differ between Node builds. */
function lines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim().replace(/(\d)\s*([ap])\.?\s?m\.?/gi, "$1 $2m"))
    .filter((line) => line.length > 0);
}

describe("the README demo transcript matches what the server answers", () => {
  it("shows the same text the tools return", async () => {
    expect(lines(readmeBlock())).toEqual(lines(await demoTranscript()));
  });

  it("names tools that exist", async () => {
    const { tools } = await import("../src/tools.js");
    const names = new Set(tools.map((t) => t.name));
    for (const line of readmeBlock().split("\n")) {
      const m = /^Tool call: (\w+)$/.exec(line.trim());
      if (m) expect(names.has(m[1]), m[1]).toBe(true);
    }
  });
});
