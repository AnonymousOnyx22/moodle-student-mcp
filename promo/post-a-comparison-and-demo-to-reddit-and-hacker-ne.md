Where this goes: a text post in r/Moodle on Reddit, and the same body as a Show HN post on Hacker News.

Titles:
- Reddit: I built a read only MCP server for Moodle so I can stop hunting for due dates
- Hacker News: Show HN: Moodle MCP, read only access to your courses for AI apps

Body:

I'm a student and I kept missing things in Moodle. Due dates, drafts and announcements live in different places, and the dashboard does not tell you what is still open.

So I built a small MCP server that lets an AI app read my Moodle account and answer questions like "what is due this week", "is anything overdue" and "what have I not handed in yet".

What it covers:

- Your courses, assignments and real submission status, drafts included
- Due dates for the next 60 days, overdue work and one to do digest
- Grades per course and every graded item with its percentage
- Announcements with the course name and date
- Course sections, activity names and course files

It is read only. It cannot submit, edit or delete anything. Your Moodle mobile web service key stays on your computer and is only sent to your own school's Moodle address. Files are only downloaded from links that point at that same address, so a link in a course page or an announcement cannot take your key somewhere else.

It needs Node 20 or newer, and a school that has the mobile web service turned on. You copy the key from Preferences > User account > Security keys, then install with npx:

```bash
npx -y moodle-student-mcp
```

The README has the config block for Claude Desktop, Claude Code, Cursor and VS Code. There is also `npx moodle-student-mcp doctor` to check the setup before you wire it into an app.

Here is a real answer from the sample Moodle site the tests use. The courses and dates are made up.

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

How it compares: I also maintain Brightspace MCP for D2L Brightspace. Both are free, open source and read only, and both cover courses, due dates, grades, submission status, announcements and course files. The difference is the platform and the sign in. Moodle uses the mobile web service key from your Security keys page, and your school has to have that service turned on. Brightspace uses a browser sign in that works with school single sign on. Brightspace also has discussions, roster, calendar, grade outlook and a target grade calculator, which this server does not. If your school uses both platforms, you can run both servers side by side under different names in your config.

Moodle MCP is not affiliated with Moodle Pty Ltd.

Code and setup: https://github.com/AnonymousOnyx22/moodle-student-mcp

If it saves you time digging through Moodle, a star helps the next student find it.
