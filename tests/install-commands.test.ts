import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { name: string };

const PACKAGE = pkg.name;
const SERVER = "moodle";
const ENV_NAMES = ["MOODLE_BASE_URL", "MOODLE_TOKEN"];

/** The apps the README gives an install line for. */
const APPS = ["Claude Code", "Cursor", "VS Code", "Claude Desktop"];

/** The README from the Install heading down to the next heading of the same level. */
function installSection(): string {
  const start = readme.indexOf("## Install");
  if (start === -1) throw new Error("README.md has no Install section");
  const end = readme.indexOf("\n## ", start + 1);
  return readme.slice(start, end === -1 ? readme.length : end);
}

/** The part of the install section under one heading, up to the next heading. */
function part(heading: string): string {
  const lines = installSection().split("\n");
  const start = lines.findIndex((line) => line.trim() === `### ${heading}`);
  if (start === -1) throw new Error(`README.md has no ${heading} part in the install section`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("### "));
  return rest.slice(0, end === -1 ? rest.length : end).join("\n");
}

/** The fenced code blocks of one language in a piece of text. */
function blocks(text: string, language: string): string[] {
  const pattern = new RegExp("```" + language + "\\r?\\n([\\s\\S]*?)```", "g");
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/** The one command in a part of the install section. */
function command(heading: string): string {
  const bash = blocks(part(heading), "bash");
  expect(bash.length, `the number of bash commands for ${heading}`).toBe(1);
  return bash[0].trim();
}

/** The JSON inside a code --add-mcp command, with the escaped quotes put back. */
function addedServer(command: string): {
  name: string;
  type: string;
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const match = /^code --add-mcp (?:"|')(.+)(?:"|')$/.exec(command);
  if (!match) throw new Error(`not a code --add-mcp command: ${command}`);
  const json = match[1].replace(/\\"/g, '"');
  return JSON.parse(json) as {
    name: string;
    type: string;
    command: string;
    args: string[];
    env: Record<string, string>;
  };
}

/** The node script the Cursor command runs. */
function cursorScript(): string {
  const match = /^node -e "([\s\S]+)"$/.exec(command("Cursor"));
  if (!match) throw new Error("the Cursor command is not a node -e command");
  return match[1];
}

/** Run the Cursor script with the home folder pointing at a fresh folder. */
function runCursorScript(home: string): void {
  execFileSync(process.execPath, ["-e", cursorScript()], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
}

/** The home folders the Cursor command was run in, so they can be cleaned up. */
const tempHomes: string[] = [];

/** A fresh home folder to run the Cursor command in. */
function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), "moodle-mcp-"));
  tempHomes.push(home);
  return home;
}

afterEach(() => {
  while (tempHomes.length) {
    rmSync(tempHomes.pop()!, { recursive: true, force: true });
  }
});

describe("the install section of the README", () => {
  it("has a part for every app", () => {
    const headings = installSection()
      .split("\n")
      .map((line) => line.trim());
    for (const app of APPS) {
      expect(headings, `the README has a ${app} part`).toContain(`### ${app}`);
    }
  });

  it("gives every app one line that starts the server", () => {
    for (const app of ["Claude Code", "Cursor", "VS Code"]) {
      const lines = command(app).split("\n").filter((line) => line.trim().length > 0);
      expect(lines.length, `the number of lines for ${app}`).toBe(1);
    }
  });

  it("names the package that is on npm in every line", () => {
    for (const app of ["Claude Code", "Cursor", "VS Code"]) {
      expect(command(app), `the command for ${app}`).toContain(PACKAGE);
      for (const line of blocks(part(app), "powershell")) {
        expect(line.trim(), `the PowerShell line for ${app}`).toContain(PACKAGE);
      }
    }
  });

  it("sets both environment variables in every line", () => {
    for (const app of ["Claude Code", "Cursor", "VS Code"]) {
      for (const line of [command(app), ...blocks(part(app), "powershell")]) {
        for (const name of ENV_NAMES) expect(line, `${name} in the line for ${app}`).toContain(name);
      }
    }
  });
});

describe("the Claude Code command", () => {
  it("adds the server with both environment variables", () => {
    expect(command("Claude Code")).toBe(
      `claude mcp add ${SERVER} --env MOODLE_BASE_URL=https://moodle.yourschool.edu --env MOODLE_TOKEN=your-key -- npx -y ${PACKAGE}`,
    );
  });

  it("says how to keep the server in every project", () => {
    expect(part("Claude Code")).toContain("--scope user");
  });
});

describe("the VS Code command", () => {
  it("adds the server to the user profile as a stdio server", () => {
    const server = addedServer(command("VS Code"));
    expect(server.name).toBe(SERVER);
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", PACKAGE]);
    for (const name of ENV_NAMES) expect(server.env, name).toHaveProperty(name);
  });

  it("has a PowerShell line with the same server for Windows", () => {
    const powershell = blocks(part("VS Code"), "powershell");
    expect(powershell.length, "the number of powershell commands").toBe(1);
    const server = addedServer(powershell[0].trim());
    expect(server.name).toBe(SERVER);
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", PACKAGE]);
    for (const name of ENV_NAMES) expect(server.env, name).toHaveProperty(name);
  });
});

describe("the Cursor command", () => {
  it("writes the server into the Cursor config file", () => {
    const home = tempHome();
    runCursorScript(home);
    const file = join(home, ".cursor", "mcp.json");
    expect(existsSync(file), file).toBe(true);
    const config = JSON.parse(readFileSync(file, "utf8")) as {
      mcpServers: Record<string, { type: string; command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = config.mcpServers[SERVER];
    expect(server, SERVER).toBeTruthy();
    expect(server.type).toBe("stdio");
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", PACKAGE]);
    for (const name of ENV_NAMES) expect(server.env, name).toHaveProperty(name);
  });

  it("keeps the servers that are already in the config file", () => {
    const home = tempHome();
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({ mcpServers: { other: { command: "node", args: ["other.js"] } } }),
    );
    runCursorScript(home);
    const config = JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(config.mcpServers.other, "other").toBeTruthy();
    expect(config.mcpServers[SERVER], SERVER).toBeTruthy();
  });
});

describe("the Claude Desktop config", () => {
  it("starts the same server with both environment variables", () => {
    const json = blocks(part("Claude Desktop"), "json");
    expect(json.length, "the number of json configs").toBe(1);
    const config = JSON.parse(json[0]) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    const server = config.mcpServers[SERVER];
    expect(server, SERVER).toBeTruthy();
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", PACKAGE]);
    for (const name of ENV_NAMES) expect(server.env, name).toHaveProperty(name);
  });
});
