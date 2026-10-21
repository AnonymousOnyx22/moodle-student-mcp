import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMoodleApi } from "../src/moodle.js";
import { createServer } from "../src/server.js";

/**
 * The moment the sample site is built around. It is fixed so the demo transcript
 * reads the same every time it is generated, however far the calendar moves.
 */
const NOW = Math.floor(new Date("2026-10-21T12:00:00Z").getTime() / 1000);

function ts(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

const EVENTS = [
  { name: "Quiz 1 closes", timesort: ts("2026-10-23T23:59:00Z"), course: { fullname: "Networking Basics" } },
  { name: "Lab 4 report", timesort: ts("2026-10-28T23:59:00Z"), course: { fullname: "Networking Basics" } },
  { name: "Problem set 3", timesort: ts("2026-11-02T23:59:00Z"), course: { fullname: "Data Structures" } },
  {
    name: "Lab 2 report",
    timesort: ts("2026-10-16T23:59:00Z"),
    course: { fullname: "Networking Basics" },
    action: { actionable: true },
  },
  {
    name: "Reading quiz",
    timesort: ts("2026-10-19T17:00:00Z"),
    course: { fullname: "Data Structures" },
    action: { actionable: false },
  },
];

/** A Moodle site with made up but fixed course data. */
function handler(req: http.IncomingMessage, res: http.ServerResponse): void {
  const url = new URL(req.url!, "http://x");
  const q = Object.fromEntries(url.searchParams.entries());
  const send = (data: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(data));
  };
  if (url.pathname !== "/webservice/rest/server.php") {
    res.writeHead(404);
    res.end();
    return;
  }
  switch (q.wsfunction) {
    case "core_webservice_get_site_info":
      return send({ userid: 7, fullname: "Test Student", sitename: "Test Moodle" });
    case "core_enrol_get_users_courses":
      return send([
        { id: 11, fullname: "Networking Basics" },
        { id: 12, fullname: "Data Structures" },
      ]);
    case "core_calendar_get_action_events_by_timeframe": {
      // The tool asks for a 60 day window for what is coming and a 45 day window
      // for what is late. The window length tells the two apart.
      const span = Number(q.timesortto) - Number(q.timesortfrom);
      const coming = span > 50 * 86400;
      const events = EVENTS.filter((e) => (coming ? e.timesort > NOW : e.timesort <= NOW)).sort(
        (a, b) => a.timesort - b.timesort,
      );
      return send({ events });
    }
    case "mod_assign_get_assignments":
      return send({
        courses: [
          {
            assignments: [
              { id: 1, name: "Lab 1: LAN cabling", duedate: ts("2026-10-09T23:59:00Z") },
              { id: 2, name: "Lab 2: subnetting worksheet", duedate: ts("2026-10-16T23:59:00Z") },
              { id: 3, name: "Lab 3: routing table", duedate: ts("2026-10-28T23:59:00Z") },
              { id: 4, name: "Lab 4: report draft", duedate: ts("2026-11-02T23:59:00Z") },
            ],
          },
        ],
      });
    case "mod_assign_get_submission_status":
      if (q.assignid === "1")
        return send({ lastattempt: { submission: { status: "submitted" } }, feedback: { gradefordisplay: "8.00 / 10.00" } });
      if (q.assignid === "2") return send({ lastattempt: { submission: { status: "submitted" } } });
      if (q.assignid === "3") return send({ lastattempt: { submission: { status: "new" } } });
      return send({ lastattempt: { submission: { status: "draft" } } });
    case "gradereport_overview_get_course_grades":
      return send({ grades: [{ courseid: 11, grade: "88.50" }, { courseid: 12, grade: "-" }] });
    case "gradereport_user_get_grade_items":
      return send({
        usergrades: [
          {
            gradeitems: [
              { itemname: "Lab 1: LAN cabling", gradeformatted: "8.00", percentageformatted: "80.00 %" },
              { itemname: "Lab 2: subnetting worksheet", gradeformatted: "9.00", percentageformatted: "90.00 %" },
              { itemname: null, gradeformatted: "88.50", percentageformatted: "88.50 %" },
            ],
          },
        ],
      });
    case "mod_forum_get_forums_by_courses": {
      const ids = Object.keys(q)
        .filter((k) => k.startsWith("courseids["))
        .map((k) => q[k]);
      const forums: Record<string, unknown>[] = [];
      for (const id of ids) {
        if (id === "11") forums.push({ id: 5, type: "news", name: "Announcements" });
        if (id === "12") forums.push({ id: 7, type: "news", name: "Course news" });
      }
      return send(forums);
    }
    case "mod_forum_get_forum_discussions":
      if (q.forumid === "5")
        return send({
          discussions: [
            {
              subject: "Lab 3 is due Friday",
              timemodified: ts("2026-10-21T09:15:00Z"),
              message: "<p>Bring your <b>laptop</b> and the patched topology sheet.</p>",
            },
            {
              subject: "Week 6 reading",
              timemodified: ts("2026-10-20T14:05:00Z"),
              message: "<p>Read chapters 4 and 5 before the quiz.</p>",
            },
          ],
        });
      return send({
        discussions: [
          {
            subject: "Room change for Thursday",
            timemodified: ts("2026-10-19T16:40:00Z"),
            message: "<p>Data Structures meets in room B12 this week.</p>",
          },
        ],
      });
    default:
      return send({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" });
  }
}

interface Step {
  tool: string;
  /** The arguments for the call. Later calls can use what an earlier call answered. */
  args: (earlier: string[]) => Record<string, unknown>;
}

interface Turn {
  question: string;
  steps: Step[];
  reply: string;
}

/** The course ID the app took from the answer to get_my_courses. */
function courseIdFrom(answer: string): number {
  const m = /\[id (\d+)\]/.exec(answer);
  if (!m) throw new Error(`no course ID in the answer: ${answer}`);
  return Number(m[1]);
}

const TURNS: Turn[] = [
  {
    question: "What's due this week?",
    steps: [{ tool: "get_upcoming_due_dates", args: () => ({}) }],
    reply:
      "Three things are due soon. Quiz 1 closes on Friday, the Lab 4 report is due on Wednesday, and Problem set 3 in Data Structures is due on Monday.",
  },
  {
    question: "Is anything overdue?",
    steps: [{ tool: "get_overdue", args: () => ({}) }],
    reply: "One thing is overdue: the Lab 2 report in Networking Basics, which was due on Friday, Oct 16.",
  },
  {
    question: "Which assignments have I not submitted in Networking Basics?",
    steps: [
      { tool: "get_my_courses", args: () => ({}) },
      { tool: "get_assignments", args: (earlier) => ({ course_id: courseIdFrom(earlier[0]) }) },
    ],
    reply:
      "Networking Basics is course 11. Lab 3 routing table has not been submitted, and Lab 4 report draft is still a draft, so it is saved but not handed in. Lab 2 was submitted and Lab 1 is graded 8.00 out of 10.",
  },
  {
    question: "How am I doing in Networking Basics?",
    steps: [
      { tool: "get_my_courses", args: () => ({}) },
      { tool: "get_my_grades", args: () => ({}) },
      { tool: "get_course_grade_items", args: (earlier) => ({ course_id: courseIdFrom(earlier[0]) }) },
    ],
    reply:
      "Networking Basics has a course total of 88.50, which is 88.50 percent. Lab 1 is 8.00 (80.00 percent) and Lab 2 is 9.00 (90.00 percent). Data Structures has no grade posted yet.",
  },
  {
    question: "Any new announcements?",
    steps: [{ tool: "get_announcements", args: () => ({}) }],
    reply:
      "Three announcements. Lab 3 is due Friday, so bring your laptop and the patched topology sheet. Week 6 reading says to read chapters 4 and 5 before the quiz. Data Structures has a room change for Thursday.",
  },
];

/**
 * Run the turns against the sample site and return the transcript as plain text.
 * Every "The server answers" block is the exact text the tool returned.
 */
export async function demoTranscript(): Promise<string> {
  const srv = http.createServer(handler);
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  try {
    const server = createServer(createMoodleApi(base, "demotoken"));
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: "demo", version: "0" });
    await Promise.all([server.connect(a), client.connect(b)]);

    const out: string[] = [];
    for (const turn of TURNS) {
      out.push(`You: ${turn.question}`, "");
      const answers: string[] = [];
      for (const step of turn.steps) {
        const args = step.args(answers);
        const res: any = await client.callTool({ name: step.tool, arguments: args });
        const text = res.content[0].text as string;
        if (res.isError) throw new Error(`${step.tool} failed: ${text}`);
        answers.push(text);
        out.push(`Tool call: ${step.tool}`);
        out.push(JSON.stringify({ name: step.tool, arguments: args }));
        out.push("");
        out.push("The server answers:");
        out.push(text);
        out.push("");
      }
      out.push(`The app replies: ${turn.reply}`);
      out.push("");
    }
    return out.join("\n").trimEnd();
  } finally {
    await new Promise<void>((r) => srv.close(() => r()));
  }
}
