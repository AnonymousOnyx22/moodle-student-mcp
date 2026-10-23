# Changelog

## 0.1.5

- get_announcements now puts the course name on each line next to the date, so announcements from different courses are easy to tell apart.
- New tool get_todo answers "what should I do today?" in one call. It brings together work that is overdue, work that is due soon, assignments with no due date and the latest announcement subjects, each with the course name and due date. It takes the same optional course_ids filter as the other tools, plus days_ahead and overdue_days to set the window.

## 0.1.4

- get_file now tells you when a file is a PDF or another kind of file it cannot read as text. It shows the file name, a link with your key removed and a note to open it in Moodle, instead of a long block of garbled characters.
- get_course_content now shows each course file by name and gives a link with your key removed. The key no longer appears in the chat, and get_file adds it back when it opens a link on your school's own site.
- The README Tools table is checked against src/tools.ts in the tests. A new tool needs a row in that table, and every row names the parameters the tool takes.
- The README has an Install section with one line for Claude Code, Cursor and VS Code, next to the Claude Desktop config block. A reader can copy one line and start the server instead of writing the JSON by hand.
- New tool get_missing_work. It answers "what do I still owe?" in one call. It looks through the assignments of your current courses and lists the ones you have not handed in yet, drafts included, with the course name and the due date. It takes the same optional course_ids filter as the other tools. A course the school server will not open is named at the end of the list and the rest still shows.
- server.json now carries the display title, the npx launch and the two environment variables. A registry page or an add from registry client asks for MOODLE_BASE_URL and MOODLE_TOKEN instead of starting the server without them and failing.

- get_upcoming_due_dates now lists only the items that need action. Plain course events such as 'Course starts' and 'Course ends' are left out, the same way get_overdue leaves out events with nothing to do.
- get_file only downloads a link that points at your school's Moodle site. A link from a course page or an announcement that points at another server is refused, so your key can no longer be sent to a third party.
- get_upcoming_due_dates and get_overdue take an optional course_ids list, the same filter get_announcements already had. A question about one course no longer brings back every course.
- The README has a demo transcript. It shows seven questions with the tool calls and the exact text the tools answer, copied from a run against the test Moodle site. `npm run demo` prints the transcript and the tests check that the README still matches it.
- get_announcements no longer stops at the first course the school server will not open. When that happens each course is asked for on its own, and the courses and forums that could not be read are named at the end of the list. A sign in problem is still reported as an error.
- The npm package now ships server.json and glama.json next to llms.txt, so the registry and Glama metadata travel with the tarball.
- Dependencies updated. Vitest is on 5 now, and the Model Context Protocol SDK and zod are on their newest releases. The older Vitest release had security advisories that npm reported. Those are gone now.
- Setup errors now carry the fix with them. The server raises the same messages as the README troubleshooting table for a wrong key, missing web services, access problems, an unknown course ID and a reply it can't read. The key messages name the Security keys page.

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

## 0.1.1

- Improved discoverability for "moodle mcp" searches. Updated description and keywords in package metadata and docs. README now lists every free student MCP server from the same author.

## 0.1.0

- First release. Read only tools for Moodle, a doctor command to check your setup, and tests that run against a fake server.
