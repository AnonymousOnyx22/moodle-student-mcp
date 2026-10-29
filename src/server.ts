import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "./core/tools.js";
import type { MoodleApi } from "./moodle.js";
import { tools } from "./tools.js";

export const VERSION = "0.1.8";

export function createServer(api: MoodleApi): McpServer {
  const server = new McpServer({ name: "moodle-student-mcp", version: VERSION });
  registerTools(server, tools, api);
  return server;
}
