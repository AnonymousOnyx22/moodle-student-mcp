# Moodle MCP for students

Add the server to your AI app with npx. Paste this into your MCP config (for Claude Desktop that's `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "moodle": {
      "command": "npx",
      "args": ["-y", "moodle-student-mcp"],
      "env": {
        "MOODLE_BASE_URL": "https://moodle.yourschool.edu",
        "MOODLE_TOKEN": "paste-your-key-here"
      }
    }
  }
}
```

Restart the app, then ask:

- "What's due this week?"
- "Is anything overdue?"
- "What's my grade in Networking?"

Ask your AI what's actually left to do in Moodle with the Moodle MCP server.

This is a free, open source [Moodle MCP](https://modelcontextprotocol.io) server. It lets Claude, ChatGPT, Cursor and other AI apps read your Moodle courses, due dates, grades and announcements. It is **read only**. It can never submit, edit or delete anything.

Works with Moodle sites that have the mobile web service turned on. Not affiliated with Moodle Pty Ltd.

Free forever. No sign up and no subscription. Your login details only ever go to your own school.

## Demo

Here is a whole exchange from start to finish. The lines under "The server answers" are the exact text the tools send back, copied from a run of this code against the test Moodle site that ships with the tests. The courses, dates and announcements are made up sample data, and the times are UTC. Copy the block into any chat app to see what an answer looks like before you install anything.

```text
You: What's due this week?

Tool call: get_upcoming_due_dates
{"name":"get_upcoming_due_dates","arguments":{}}

The server answers:
- Quiz 1 closes (Networking Basics) due Fri, Oct 23, 11:59 p.m. UTC
- Lab 4 report (Networking Basics) due Wed, Oct 28, 11:59 p.m. UTC
- Problem set 3 (Data Structures) due Mon, Nov 2, 11:59 p.m. UTC

The app replies: Three things are due soon. Quiz 1 closes on Friday, the Lab 4 report is due on Wednesday, and Problem set 3 in Data Structures is due on Monday.

You: Is anything overdue?

Tool call: get_overdue
{"name":"get_overdue","arguments":{}}

The server answers:
- Lab 2 report (Networking Basics) was due Fri, Oct 16, 11:59 p.m. UTC

The app replies: One thing is overdue: the Lab 2 report in Networking Basics, which was due on Friday, Oct 16.

You: Which assignments have I not submitted in Networking Basics?

Tool call: get_my_courses
{"name":"get_my_courses","arguments":{}}

The server answers:
- Networking Basics [id 11]
- Data Structures [id 12]

Tool call: get_assignments
{"name":"get_assignments","arguments":{"course_id":11}}

The server answers:
- Lab 1: LAN cabling due Fri, Oct 9, 11:59 p.m. UTC graded 8.00 / 10.00
- Lab 2: subnetting worksheet due Fri, Oct 16, 11:59 p.m. UTC submitted
- Lab 3: routing table due Wed, Oct 28, 11:59 p.m. UTC not submitted
- Lab 4: report draft due Mon, Nov 2, 11:59 p.m. UTC draft, not submitted

The app replies: Networking Basics is course 11. Lab 3 routing table has not been submitted, and Lab 4 report draft is still a draft, so it is saved but not handed in. Lab 2 was submitted and Lab 1 is graded 8.00 out of 10.

You: How am I doing in Networking Basics?

Tool call: get_my_courses
{"name":"get_my_courses","arguments":{}}

The server answers:
- Networking Basics [id 11]
- Data Structures [id 12]

Tool call: get_my_grades
{"name":"get_my_grades","arguments":{}}

The server answers:
- Networking Basics 88.50
- Data Structures no grade posted yet

Tool call: get_course_grade_items
{"name":"get_course_grade_items","arguments":{"course_id":11}}

The server answers:
- Lab 1: LAN cabling 8.00 (80.00 %)
- Lab 2: subnetting worksheet 9.00 (90.00 %)
- Course total 88.50 (88.50 %)

The app replies: Networking Basics has a course total of 88.50, which is 88.50 percent. Lab 1 is 8.00 (80.00 percent) and Lab 2 is 9.00 (90.00 percent). Data Structures has no grade posted yet.

You: Any new announcements?

Tool call: get_announcements
{"name":"get_announcements","arguments":{}}

The server answers:
- Lab 3 is due Friday (Wed, Oct 21, 9:15 a.m. UTC)
  Bring your laptop and the patched topology sheet.
- Week 6 reading (Tue, Oct 20, 2:05 p.m. UTC)
  Read chapters 4 and 5 before the quiz.
- Room change for Thursday (Mon, Oct 19, 4:40 p.m. UTC)
  Data Structures meets in room B12 this week.

The app replies: Three announcements. Lab 3 is due Friday, so bring your laptop and the patched topology sheet. Week 6 reading says to read chapters 4 and 5 before the quiz. Data Structures has a room change for Thursday.
```

## Quick start

1. In Moodle, open your profile menu, go to **Preferences > User account > Security keys**. Copy the key for **Moodle mobile web service**.
2. Put your school's Moodle address and that key into the config block above.
3. Restart your AI app and ask one of the questions above.

To check your setup first, run `npx moodle-student-mcp doctor` with the two environment variables set.

> If you can't find a Security keys page, your school has turned off the mobile web service, or signs you in through single sign on without exposing keys. In that case this server can't connect to your account.

## What you can ask

- "What's due this week?"
- "What's due in the next two weeks?"
- "Is anything overdue?"
- "What's my grade in each course, and what's in the gradebook for Networking?"
- "Any new announcements?"
- "Which assignments have I not submitted yet?"

## Tools

All tools are read only.

| Tool | What it does |
| --- | --- |
| `get_my_courses` | Your current courses and their IDs |
| `get_upcoming_due_dates` | Everything due in the next 60 days, soonest first |
| `get_overdue` | Past due items that still need action |
| `get_assignments` | Assignments for a course with due dates and submission status |
| `get_my_grades` | Current grade for each course |
| `get_course_grade_items` | Every graded item in a course with mark and percentage |
| `get_course_content` | Sections and activities for a course |
| `get_file` | Download a course file and return its text |
| `get_announcements` | Recent announcements, with any course Moodle will not open left out |

## Privacy and security

- Your key stays on your computer. It is only sent to your own school's Moodle address.
- Nothing is sent to any other server by this project.
- Every tool is marked read only. You can reset your key any time on the Security keys page.

## Troubleshooting

Every tool returns these messages when the setup is off. Each one comes with the fix.

| Message | Fix |
| --- | --- |
| Not signed in | Your key expired or was reset. Copy the new one from **Preferences > User account > Security keys** and update `MOODLE_TOKEN`. |
| Access denied | Your school turned that feature off for students. If you copied the key yourself, make sure it is the Moodle mobile web service one on **Preferences > User account > Security keys**. |
| Web services not enabled | Your school hasn't turned on the mobile web service, so there is no Moodle mobile web service key on **Preferences > User account > Security keys**. Ask your school to turn it on. |
| Not found | Check the course ID with `get_my_courses`. |
| The school's server sent a reply this server can't read | Check that `MOODLE_BASE_URL` points at your Moodle site's address. |

## Development

```bash
npm install
npm run build
npm test
```

Development needs Node 22.12 or newer, because the test runner needs it. The server itself runs on Node 20 or newer.

Tests run against a fake Moodle server, so they need no account or network.

The demo transcript above comes from the same code. Run `npm run demo` to print it again after you change a tool, and `npm test` checks that the README still matches what the tools answer.

If this saved you time digging through Moodle, please [give the repo a star](https://github.com/AnonymousOnyx22/moodle-student-mcp). It sits at 0 stars, and one star helps the next student find it.

## Moodle vs Brightspace

Both are free, open source, read only MCP servers for students. Use the one that matches your school's learning platform. If your school uses both, or you move between schools, you can run both side by side under different server names in your MCP config.

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

## More free student MCP servers

All free, open source and read only where they touch your accounts. Browse the full list at [brightspacemcp.com/more-mcps](https://brightspacemcp.com/more-mcps/).

| Server | What it does |
| --- | --- |
| [Brightspace MCP](https://github.com/AnonymousOnyx22/brightspace-d2l-mcp) | D2L Brightspace for AI. Due dates with real submission status, grades, a target grade calculator and course files. |
| [Canvas MCP](https://github.com/AnonymousOnyx22/canvas-lms-student-mcp) | Read-only Canvas LMS for AI. Due dates, missing work, grades and announcements. |
| [Google Classroom MCP](https://github.com/AnonymousOnyx22/google-classroom-student-mcp) | Read-only Google Classroom for AI. To-do, due dates, missing work and grades. |
| [GPA Calculator MCP](https://github.com/AnonymousOnyx22/gpa-calculator-mcp) | GPA, grade conversion and what-do-I-need-on-the-final math for AI. Works offline, no account. |
| [Citations MCP](https://github.com/AnonymousOnyx22/student-citations-mcp) | APA, MLA and Chicago citations from a DOI, an ISBN or typed details. No account. |
| [Study Planner MCP](https://github.com/AnonymousOnyx22/study-planner-mcp) | Exam study schedules, spaced repetition dates, pomodoro plans and assignment milestones. Works offline. |
| [Paper Finder MCP](https://github.com/AnonymousOnyx22/paper-finder-student-mcp) | Search scholarly papers, find open access copies and related work through OpenAlex. No key needed. |

## License

MIT
