Where this goes: a text post in r/Moodle on Reddit.

Title: I built a read only Moodle MCP server that answers what should I do today

Body:

I'm a student, and I kept losing track of Moodle. Due dates are on one page, drafts are buried in the assignment list, and announcements sit in a forum I forget to open. So I built a small MCP server that lets an app such as Claude Desktop or Cursor read my Moodle account and answer questions about it.

The newest tool is `get_todo`. One question, "What should I do today?", returns overdue work, work due soon, assignments with no due date and the latest announcement subjects, each with the course name and date. It takes optional `course_ids`, `days_ahead` and `overdue_days` arguments if you want a narrower window.

Here is the exact output from the sample Moodle site the tests use. The courses and dates are made up.

```text
You: What should I do today?

Tool call: get_todo
{"name":"get_todo","arguments":{}}

The server answers:
Overdue:
- Problem set 1 (Data Structures) was due Mon, Oct 19, 11:59 p.m. UTC, not submitted

Due soon:
- Quiz 1 closes (Networking Basics) is due Fri, Oct 23, 11:59 p.m. UTC
- Lab 3: routing table (Networking Basics) is due Wed, Oct 28, 11:59 p.m. UTC, not submitted
- Lab 4: report draft (Networking Basics) is due Mon, Nov 2, 11:59 p.m. UTC, draft, not submitted
- Problem set 3 (Data Structures) is due Mon, Nov 2, 11:59 p.m. UTC

New announcements:
- Lab 3 is due Friday (Networking Basics, Wed, Oct 21, 9:15 a.m. UTC)
- Week 6 reading (Networking Basics, Tue, Oct 20, 2:05 p.m. UTC)
- Room change for Thursday (Data Structures, Mon, Oct 19, 4:40 p.m. UTC)
```

It is read only. It cannot submit, edit or delete anything. Your Moodle mobile web service key stays on your computer and is only sent to your school's Moodle address. A file link that points somewhere else is refused, so a link in a course page or an announcement cannot take your key.

Install is:

```bash
npx -y moodle-student-mcp
```

Set `MOODLE_BASE_URL` to your school's Moodle address and `MOODLE_TOKEN` to the key from Preferences > User account > Security keys. Your school needs the mobile web service turned on. The README has the one line setup for Claude Code, Cursor and VS Code, plus the config block for Claude Desktop.

I also maintain Brightspace MCP for D2L Brightspace, so here is the comparison:

| | Moodle MCP | [Brightspace MCP](https://github.com/AnonymousOnyx22/brightspace-d2l-mcp) |
| --- | --- | --- |
| Learning platform | Moodle | D2L Brightspace |
| Sign in | Moodle mobile web service key from your Security keys page | Browser sign in, works with Microsoft, Duo, Okta and Shibboleth |
| School setup needed | Mobile web service must be turned on | None |
| Courses, due dates, grades | Yes | Yes |
| Submission status per assignment | Yes | Yes |
| Course files | Yes | Yes |
| Announcements | Yes | Yes |
| Discussions, roster, calendar, grade outlook | No | Yes |
| Target grade calculator | No | Yes |
| Cost | Free | Free |

Both are free, open source and read only. Use the one that matches your school's platform. If your school uses both, or you move between schools, you can run both under different server names in your config.

Code and setup: https://github.com/AnonymousOnyx22/moodle-student-mcp

If it saves you time digging through Moodle, a star helps the next student find it.
