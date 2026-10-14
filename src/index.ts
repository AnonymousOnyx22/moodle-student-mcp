#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { requireEnv } from "./core/tools.js";
import { normalizeBaseUrl } from "./config.js";
import { createMoodleApi } from "./moodle.js";
import { createServer, VERSION } from "./server.js";

function usage(): void {
  console.log(`moodle-student-mcp ${VERSION}

Read-only Moodle server for AI apps (MCP).

Environment
  MOODLE_BASE_URL    Your school's Moodle address, for example https://moodle.myschool.edu
  MOODLE_TOKEN       Your Moodle web service token (Preferences > Security keys)

Commands
  (no command)       Start the MCP server over stdio
  doctor             Check that your URL and token work
  --help, --version`);
}

async function main(): Promise<void> {
  const cmd = process.argv[2];
  if (cmd === "--help" || cmd === "-h") return usage();
  if (cmd === "--version" || cmd === "-v") return console.log(VERSION);

  const baseUrl = normalizeBaseUrl(
    requireEnv("MOODLE_BASE_URL", "Set it to your school's Moodle address, for example https://moodle.myschool.edu"),
  );
  const token = requireEnv("MOODLE_TOKEN", "Get it from Moodle under Preferences, Security keys.");
  const api = createMoodleApi(baseUrl, token);

  if (cmd === "doctor") {
    try {
      const info = await api.call<{ fullname?: string; sitename?: string }>("core_webservice_get_site_info");
      console.log(`Connected to ${info.sitename ?? baseUrl} as ${info.fullname ?? "your account"}.`);
    } catch (e) {
      console.error(`Could not connect. ${(e as Error).message}`);
      process.exit(1);
    }
    return;
  }

  const server = createServer(api);
  await server.connect(new StdioServerTransport());
  console.error(`moodle-student-mcp ${VERSION} running for ${baseUrl}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
