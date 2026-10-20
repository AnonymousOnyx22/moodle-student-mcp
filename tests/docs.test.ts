import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { z } from "zod";
import { tools } from "../src/tools.js";

const llms = readFileSync(new URL("../llms.txt", import.meta.url), "utf8");
const glama = JSON.parse(readFileSync(new URL("../glama.json", import.meta.url), "utf8")) as {
  tools?: { name: string; parameters?: { name: string; required?: boolean }[]; example?: { name: string; arguments: unknown } }[];
};

interface LlmsTool {
  name: string;
  params: string;
  example: { name: string; arguments: unknown };
}

function parseLlmsTools(text: string): LlmsTool[] {
  return text
    .split(/^### /m)
    .slice(1)
    .map((section) => {
      const name = section.slice(0, section.indexOf("\n")).trim();
      const params = /^Parameters: (.*)$/m.exec(section)?.[1] ?? "";
      const json = /^Example call: `(.*)`$/m.exec(section)?.[1];
      if (!json) throw new Error(`llms.txt: no example call for ${name}`);
      return { name, params, example: JSON.parse(json) };
    });
}

const llmsTools = parseLlmsTools(llms);
const glamaTools = glama.tools ?? [];

/** A property is required when an object missing only that property fails to parse. */
function isRequired(tool: (typeof tools)[number], key: string): boolean {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const k of Object.keys(tool.inputSchema)) shape[k] = k === key ? tool.inputSchema[k] : z.any();
  return !z.object(shape).safeParse({}).success;
}

describe("llms.txt and glama.json match the real tool list", () => {
  it("llms.txt lists every tool and no extras", () => {
    expect(llmsTools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  it("glama.json lists every tool and no extras", () => {
    expect(glamaTools.map((t) => t.name).sort()).toEqual(tools.map((t) => t.name).sort());
  });

  for (const tool of tools) {
    it(`llms.txt documents ${tool.name} with its parameters and a valid example call`, () => {
      const doc = llmsTools.find((t) => t.name === tool.name)!;
      const props = Object.keys(tool.inputSchema);
      if (props.length) {
        for (const p of props) expect(doc.params, `${tool.name} mentions ${p}`).toContain(p);
      } else {
        expect(doc.params, tool.name).toMatch(/^none/i);
      }
      expect(doc.example.name).toBe(tool.name);
      expect(z.object(tool.inputSchema).safeParse(doc.example.arguments).success, `${tool.name} example`).toBe(true);
    });

    it(`glama.json documents ${tool.name} with its parameters and a valid example call`, () => {
      const doc = glamaTools.find((t) => t.name === tool.name)!;
      const props = Object.keys(tool.inputSchema);
      const params = doc.parameters ?? [];
      expect(params.map((p) => p.name).sort(), `${tool.name} parameter names`).toEqual([...props].sort());
      for (const p of params) expect(p.required, `${tool.name}.${p.name} required flag`).toBe(isRequired(tool, p.name));
      expect(doc.example?.name).toBe(tool.name);
      expect(z.object(tool.inputSchema).safeParse(doc.example?.arguments).success, `${tool.name} example`).toBe(true);
    });
  }
});
