# Changelog

## 0.1.3

- Small fixes and clearer docs

## 0.1.2

- Not in npm top 40 for "moodle mcp"
- Raise the README setup errors with fixes and the Security keys path
- Update vitest to 5 and verify the 0.1.1 version across the pack
- Audit llms.txt and glama.json so all eight tools appear with parameters and one example call each
- Give each of the 8 tools in src/tools.ts a description with concrete inputs and a sample user prompt
- Rebuild the README first screen as an npx install block plus three example prompts above the fold
- Rewrite package.json description to lead with the phrase 'Moodle MCP' and add exact-match keywords
- Shorten the server.json description to 100 characters (it is 138)
- search-rank

## Unreleased

- Dependencies updated. Vitest is on 5 now, and the Model Context Protocol SDK and zod are on their newest releases. The older Vitest release had security advisories that npm reported. Those are gone now.
- Setup errors now carry the fix with them. The server raises the same messages as the README troubleshooting table for a wrong key, missing web services, access problems, an unknown course ID and a reply it can't read. The key messages name the Security keys page.

## 0.1.1

- Improved discoverability for "moodle mcp" searches. Updated description and keywords in package metadata and docs. README now lists every free student MCP server from the same author.

## 0.1.0

- First release. Read only tools for Moodle, a doctor command to check your setup, and tests that run against a fake server.
