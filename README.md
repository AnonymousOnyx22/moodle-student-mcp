# Moodle MCP for students

Add the server to your AI app with npx. Put your school's Moodle address and your key in the line for your app below, then run it.

Ask your AI what's actually left to do in Moodle with the Moodle MCP server.

This is a free, open source [Moodle MCP](https://modelcontextprotocol.io) server. It lets Claude Desktop, Claude Code, Cursor, VS Code and other AI apps that run a local MCP server read your Moodle courses, due dates, grades and announcements. It is **read only**. It can never submit, edit or delete anything.

Works with Moodle sites that have the mobile web service turned on. Not affiliated with Moodle Pty Ltd.

Free forever. No sign up and no subscription. Your login details only ever go to your own school.

## Install

### Claude Code

Run this in a terminal:

```bash
claude mcp add moodle --env MOODLE_BASE_URL=https://moodle.yourschool.edu --env MOODLE_TOKEN=your-key -- npx -y moodle-student-mcp
```

Add `--scope user` if you want the server in every project.

### Cursor

Run this in a terminal. Cursor keeps its servers in `mcp.json`, so this line writes the server into `~/.cursor/mcp.json` and leaves the servers you already have alone. On Windows that file is `%USERPROFILE%\.cursor\mcp.json`.

```bash
node -e "const fs=require('fs'),os=require('os'),path=require('path'),file=path.join(os.homedir(),'.cursor','mcp.json');let config={};try{config=JSON.parse(fs.readFileSync(file,'utf8'))}catch(error){}config.mcpServers={...(config.mcpServers||{}),moodle:{type:'stdio',command:'npx',args:['-y','moodle-student-mcp'],env:{MOODLE_BASE_URL:'https://moodle.yourschool.edu',MOODLE_TOKEN:'your-key'}}};fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(config,null,2));"
```

### VS Code

Run this in a terminal:

```bash
code --add-mcp "{\"name\":\"moodle\",\"type\":\"stdio\",\"command\":\"npx\",\"args\":[\"-y\",\"moodle-student-mcp\"],\"env\":{\"MOODLE_BASE_URL\":\"https://moodle.yourschool.edu\",\"MOODLE_TOKEN\":\"your-key\"}}"
```

The quotes inside the JSON are escaped, so the command runs the same way in a Mac or Linux terminal and in the Windows Command Prompt. In PowerShell on Windows, use this line instead:

```powershell
code --add-mcp '{\"name\":\"moodle\",\"type\":\"stdio\",\"command\":\"npx\",\"args\":[\"-y\",\"moodle-student-mcp\"],\"env\":{\"MOODLE_BASE_URL\":\"https://moodle.yourschool.edu\",\"MOODLE_TOKEN\":\"your-key\"}}'
```

This adds the server to your user profile, so it is there in every project.

### Claude Desktop

Paste this into your MCP config (for Claude Desktop that's `claude_desktop_config.json`):

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

Restart the app if it was already running, then ask:

- "What's due this week?"
- "Is anything overdue?"
- "What work am I still missing?"
- "What's my grade in Networking?"

## Demo

Here is a whole exchange from start to finish. The lines under "The server answers" are the exact text the tools send back, copied from a run of this code against the test Moodle site that ships with the tests. The courses, dates and announcements are made up sample data, and the times are UTC. Copy the block into any chat app to see what an answer looks like before you install anything.

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

The app replies: Start with Problem set 1 in Data Structures, which was due Monday. Quiz 1 closes Friday, the Lab 3 routing table is due Wednesday, and the Lab 4 report draft and Problem set 3 are due Nov 2. The latest announcements mention the Lab 3 deadline, the Week 6 reading and a room change for Data Structures.

You: What's due this week?

Tool call: get_upcoming_due_dates
{"name":"get_upcoming_due_dates","arguments":{}}

The server answers:
- Quiz 1 closes (Networking Basics) due Fri, Oct 23, 11:59 p.m. UTC
- Lab 4 report (Networking Basics) due Wed, Oct 28, 11:59 p.m. UTC
- Problem set 3 (Data Structures) due Mon, Nov 2, 11:59 p.m. UTC

The app replies: Three things are due soon. Quiz 1 closes on Friday, the Lab 4 report is due on Wednesday, and Problem set 3 in Data Structures is due on Monday.

You: What's due in Networking Basics?

Tool call: get_my_courses
{"name":"get_my_courses","arguments":{}}

The server answers:
- Networking Basics [id 11]
- Data Structures [id 12]

Tool call: get_upcoming_due_dates
{"name":"get_upcoming_due_dates","arguments":{"course_ids":[11]}}

The server answers:
- Quiz 1 closes (Networking Basics) due Fri, Oct 23, 11:59 p.m. UTC
- Lab 4 report (Networking Basics) due Wed, Oct 28, 11:59 p.m. UTC

The app replies: Networking Basics has two things due soon: Quiz 1 closes on Friday and the Lab 4 report is due on Wednesday.

You: Is anything overdue?

Tool call: get_overdue
{"name":"get_overdue","arguments":{}}

The server answers:
- Problem set 1 (Data Structures) was due Mon, Oct 19, 11:59 p.m. UTC

The app replies: One thing is overdue: Problem set 1 in Data Structures, which was due on Monday, Oct 19.

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

You: What work am I still missing?

Tool call: get_missing_work
{"name":"get_missing_work","arguments":{}}

The server answers:
- Problem set 1 (Data Structures) was due Mon, Oct 19, 11:59 p.m. UTC, not submitted
- Lab 3: routing table (Networking Basics) is due Wed, Oct 28, 11:59 p.m. UTC, not submitted
- Lab 4: report draft (Networking Basics) is due Mon, Nov 2, 11:59 p.m. UTC, draft, not submitted
- Problem set 2 (Data Structures) is due Fri, Nov 6, 11:59 p.m. UTC, not submitted

The app replies: Four assignments are still not handed in. Problem set 1 in Data Structures was due on Oct 19, Lab 3 routing table in Networking Basics is due on Oct 28, the Lab 4 report draft in Networking Basics is due on Nov 2 and is still only a draft, and Problem set 2 in Data Structures is due on Nov 6.

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
- Lab 3 is due Friday (Networking Basics, Wed, Oct 21, 9:15 a.m. UTC)
  Bring your laptop and the patched topology sheet.
- Week 6 reading (Networking Basics, Tue, Oct 20, 2:05 p.m. UTC)
  Read chapters 4 and 5 before the quiz.
- Room change for Thursday (Data Structures, Mon, Oct 19, 4:40 p.m. UTC)
  Data Structures meets in room B12 this week.

The app replies: Three announcements. Lab 3 is due Friday, so bring your laptop and the patched topology sheet. Week 6 reading says to read chapters 4 and 5 before the quiz. Data Structures has a room change for Thursday.
```

## Quick start

1. In Moodle, open your profile menu, go to **Preferences > User account > Security keys**. Copy the key for **Moodle mobile web service**. The [guide to getting your Moodle mobile web service key](https://github.com/AnonymousOnyx22/moodle-student-mcp/blob/main/docs/get-moodle-mobile-web-service-key.md) has each step, plus what to do when the page or the key is missing.
2. Put your school's Moodle address and that key into the command or the config block above.
3. Restart your AI app and ask one of the questions above.

To check your setup first, run `npx moodle-student-mcp doctor` with the two environment variables set.

> If you can't find a Security keys page, your school has turned off the mobile web service, or signs you in through single sign on without exposing keys. In that case this server can't connect to your account.

## What you can ask

- "What's due this week?"
- "What's due in Networking Basics?"
- "What's due in the next two weeks?"
- "What should I do today?"
- "Is anything overdue?"
- "Anything overdue in Networking Basics?"
- "What work am I still missing?"
- "What's my grade in each course, and what's in the gradebook for Networking?"
- "Any new announcements?"
- "Which assignments have I not submitted yet?"

## Tools

All tools are read only.

| Tool | What it does |
| --- | --- |
| `get_my_courses` | Your current courses and their IDs |
| `get_upcoming_due_dates` | Items that still need action and are due in the next 60 days, soonest first. Plain course events such as 'Course starts' are left out. Takes an optional `course_ids` list of course IDs |
| `get_overdue` | Past due items that still need action. Takes an optional `course_ids` list of course IDs |
| `get_todo` | One digest for what to do next: overdue work, work due soon, assignments with no due date and the latest announcement subjects, each with the course name and due date. Takes an optional `course_ids` list, plus `days_ahead` and `overdue_days` to set the window |
| `get_assignments` | Assignments for a course with due dates and submission status. Takes a `course_id` from `get_my_courses` |
| `get_missing_work` | Assignments you have not handed in yet, drafts included, with the course name and the due date. Takes an optional `course_ids` list of course IDs |
| `get_my_grades` | Current grade for each course |
| `get_course_grade_items` | Every graded item in a course with mark and percentage. Takes a `course_id` from `get_my_courses` |
| `get_course_content` | Sections and activities for a course, with file names and links that leave your key out. Takes a `course_id` from `get_my_courses` |
| `get_file` | Download a course file from your school's Moodle site and return its text. Plain text, HTML and PDF files with readable text come back as text. A PDF with no extractable text comes back with its file name, a link with your key removed and a note to open it in Moodle. Any other file type comes back with its file name, a link with your key removed and a note that only plain text, HTML and PDF are supported, with a note to open it in Moodle. Takes a `file_url` from `get_course_content` |
| `get_announcements` | Recent announcements with the course name and date on each one, and any course Moodle will not open left out. Takes an optional `course_ids` list of course IDs |

## Privacy and security

- Your key stays on your computer. It is only sent to your own school's Moodle address.
- Nothing is sent to any other server by this project.
- `get_file` downloads files up to 25 MB. A bigger file, such as a lecture video, is not downloaded; you get its name and link to open it in Moodle instead.
- `get_file` only downloads a link that points at your school's Moodle address. A link that points somewhere else is refused, so a link in a course page or an announcement can never take your key.
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
| [Canvas MCP](https://github.com/AnonymousOnyx22/canvas-lms-student-mcp) | Canvas LMS for AI, read only. Due dates, missing work, grades and announcements. |
| [Google Classroom MCP](https://github.com/AnonymousOnyx22/google-classroom-student-mcp) | Google Classroom for AI, read only. Todos, due dates, missing work and grades. |
| [GPA Calculator MCP](https://github.com/AnonymousOnyx22/gpa-calculator-mcp) | GPA, grade conversion and the grade you need on the final, for AI. Works offline, no account. |
| [Citations MCP](https://github.com/AnonymousOnyx22/student-citations-mcp) | APA, MLA and Chicago citations from a DOI, an ISBN or typed details. No account. |
| [Study Planner MCP](https://github.com/AnonymousOnyx22/study-planner-mcp) | Exam study schedules, spaced repetition dates, pomodoro plans and assignment milestones. Works offline. |
| [Paper Finder MCP](https://github.com/AnonymousOnyx22/paper-finder-student-mcp) | Search scholarly papers, find open access copies and related work through OpenAlex. No key needed. |

## License

MIT
