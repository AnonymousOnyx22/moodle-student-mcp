Where this goes: a pull request to an awesome-mcp-servers style list, and the description box on MCP directory sites. Pick the entry that matches the list's format and paste it. Check the list's contributing page first, because some lists want a category, an emoji or a certain order.

Name:
Moodle MCP (moodle-student-mcp)

Category to pick: education, or learning platforms, or "other" if the list has no such section.

One line description:
Read only MCP server that lets AI apps see your Moodle courses, due dates, grades, announcements and course files.

Awesome list entry (the usual markdown line format):

- [AnonymousOnyx22/moodle-student-mcp](https://github.com/AnonymousOnyx22/moodle-student-mcp) 📇 ☁️ - Read only Moodle MCP server for students. Ask what is due, what is overdue, what is still missing, your grades, announcements and course content. It cannot submit, edit or delete anything.

The icons are the common ones for a TypeScript server that talks to a hosted service. Change or drop them to match the list.

Short directory blurb (2 to 3 sentences):

Moodle MCP is a free, open source, read only MCP server for students. It reads your courses, assignments with real submission status, due dates, overdue work, grades, announcements, course sections, pages and files from your school's Moodle, and it can never submit, edit or delete anything. It needs Node 20 or newer and a Moodle site with the mobile web service turned on.

Tools it provides:
get_my_courses, get_upcoming_due_dates, get_overdue, get_todo, get_assignments, get_missing_work, get_my_grades, get_course_grade_items, get_course_content, get_course_page, get_announcements, get_file

Install block (works in any app that runs a local MCP server, such as Claude Desktop, Claude Code, Cursor, VS Code and Windsurf):

```json
{
  "mcpServers": {
    "moodle": {
      "command": "npx",
      "args": ["-y", "moodle-student-mcp"],
      "env": {
        "MOODLE_BASE_URL": "https://moodle.yourschool.edu",
        "MOODLE_TOKEN": "your-key"
      }
    }
  }
}
```

Claude Code one liner:

```bash
claude mcp add moodle --env MOODLE_BASE_URL=https://moodle.yourschool.edu --env MOODLE_TOKEN=your-key -- npx -y moodle-student-mcp
```

Setup notes to paste if the form has room:
- MOODLE_BASE_URL is your school's Moodle address.
- MOODLE_TOKEN is the mobile web service key from Preferences > User account > Security keys.
- Run `npx moodle-student-mcp doctor` to check the setup before wiring it into an app.

Links:
- Code and setup: https://github.com/AnonymousOnyx22/moodle-student-mcp
- npm: https://www.npmjs.com/package/moodle-student-mcp
- MCP Registry name: io.github.AnonymousOnyx22/moodle-student-mcp
- License: MIT

Moodle MCP is not affiliated with Moodle Pty Ltd.
