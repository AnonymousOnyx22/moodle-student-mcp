import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ApiError } from "./http.js";

export type Shape = Record<string, z.ZodTypeAny>;

export interface ToolDef<Api> {
  name: string;
  title: string;
  description: string;
  inputSchema: Shape;
  run: (args: any, api: Api) => Promise<string>;
}

export interface ToolResult {
  [key: string]: unknown;
  content: { type: "text"; text: string }[];
  isError?: boolean;
}

export async function runTool<Api>(tool: ToolDef<Api>, args: unknown, api: Api): Promise<ToolResult> {
  try {
    const text = await tool.run(args, api);
    return { content: [{ type: "text", text }] };
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : `Something went wrong: ${(err as Error).message}`;
    return { content: [{ type: "text", text: msg }], isError: true };
  }
}

export function registerTools<Api>(server: McpServer, tools: ToolDef<Api>[], api: Api): void {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args: unknown) => runTool(tool, args, api),
    );
  }
}

/** Format an ISO date as a short readable string, or "no due date". */
export function fmtDate(iso?: string | null): string {
  if (!iso) return "no due date";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString("en-CA", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function fmtUnix(seconds?: number | null): string {
  if (!seconds) return "no due date";
  return fmtDate(new Date(seconds * 1000).toISOString());
}

/** Strip HTML tags and collapse whitespace so rich text is readable in a chat. */
export function stripHtml(html?: string | null, max = 4000): string {
  if (!html) return "";
  const text = html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return text.length > max ? text.slice(0, max) + "\n[truncated]" : text;
}

export function bullets(lines: string[], empty = "Nothing to show."): string {
  return lines.length ? lines.map((l) => `- ${l}`).join("\n") : empty;
}

export function requireEnv(name: string, hint: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing ${name}. ${hint}`);
    process.exit(1);
  }
  return v;
}
