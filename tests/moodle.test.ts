import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMoodleApi, flatten } from "../src/moodle.js";
import { createServer } from "../src/server.js";
import { normalizeBaseUrl } from "../src/config.js";
import { sameOrigin, setupMessage, type SetupProblemKey } from "../src/core/http.js";

const now = Math.floor(Date.now() / 1000);
let srv: http.Server;
let base = "";
const seenParams: Record<string, string>[] = [];
/** The forum whose discussions call fails, 0 for none. */
let failForum = 0;
/** The file requests the school server received. */
const seenFiles: { path: string; token?: string }[] = [];
/** A server that stands in for another site on the internet. */
let other: http.Server;
let otherUrl = "";
const otherHits: string[] = [];

beforeAll(async () => {
  other = http.createServer((req, res) => {
    otherHits.push(req.url ?? "");
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("stolen");
  });
  await new Promise<void>((r) => other.listen(0, "127.0.0.1", r));
  otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}`;

  srv = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const q = Object.fromEntries(url.searchParams.entries());
    seenParams.push(q);
    if (url.pathname.startsWith("/webservice/pluginfile.php")) {
      seenFiles.push({ path: url.pathname, token: q.token });
      if (url.pathname.endsWith("/binary.pdf")) {
        res.writeHead(200, { "content-type": "application/pdf" });
        return res.end("%PDF-1.4\n1 0 obj\nbinary noise\n%%EOF");
      }
      if (url.pathname.endsWith("/fake.txt")) {
        res.writeHead(200, { "content-type": "text/plain" });
        return res.end("%PDF-1.4\nnot really text\n%%EOF");
      }
      if (url.pathname.endsWith("/diagram.png")) {
        res.writeHead(200, { "content-type": "image/png" });
        return res.end("not text at all");
      }
      res.writeHead(200, { "content-type": "text/plain" });
      return res.end("Week 3 slides: how a packet travels");
    }
    const send = (data: unknown) => {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    if (url.pathname !== "/webservice/rest/server.php") {
      res.writeHead(404);
      return res.end();
    }
    if (q.wstoken === "http401") {
      res.writeHead(401);
      return res.end("Unauthorized");
    }
    if (q.wstoken === "http403") {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (q.wstoken === "http404") {
      res.writeHead(404);
      return res.end("Not found");
    }
    if (q.wstoken === "htmlpage") {
      res.writeHead(200, { "content-type": "text/html" });
      return res.end("<html><body>Web services are not enabled for this site.</body></html>");
    }
    if (q.wstoken === "noauth") {
      return send({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" });
    }
    if (q.wstoken === "noweb") {
      return send({ exception: "moodle_exception", errorcode: "webservicesnotenabled", message: "Web services are not enabled for this site." });
    }
    if (q.wstoken === "noservice") {
      return send({ exception: "moodle_exception", errorcode: "servicenotavailable", message: "Service not available" });
    }
    if (q.wstoken === "badrecord") {
      return send({ exception: "moodle_exception", errorcode: "invalidrecord", message: "Invalid record ID (record not found)" });
    }
    if (q.wstoken !== "good" && q.wstoken !== "forumtoken") {
      return send({ exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token - token not found" });
    }
    switch (q.wsfunction) {
      case "core_webservice_get_site_info":
        return send({ userid: 7, fullname: "Test Student", sitename: "Test Moodle" });
      case "core_enrol_get_users_courses":
        return send([
          { id: 11, fullname: "Networking Basics" },
          { id: 12, fullname: "Old Course", enddate: now - 100000 },
          { id: 13, fullname: "Hidden Course", hidden: true },
          { id: 14, fullname: "Data Structures" },
        ]);
      case "core_calendar_get_action_events_by_timeframe": {
        const from = Number(q.timesortfrom);
        const to = Number(q.timesortto);
        const events = [
          { name: "Lab 2 is due", timesort: now - 86400, courseid: 11, course: { id: 11, fullname: "Networking Basics" }, action: { actionable: true } },
          { name: "Quiz closed", timesort: now - 90000, courseid: 11, course: { id: 11, fullname: "Networking Basics" }, action: { actionable: false } },
          { name: "Essay draft", timesort: now - 200000, courseid: 14, course: { id: 14, fullname: "Data Structures" }, action: { actionable: true } },
          { name: "Lab 4 is due", timesort: now + 200000, courseid: 11, course: { id: 11, fullname: "Networking Basics" }, action: { actionable: true } },
          { name: "Quiz 1 closes", timesort: now + 100000, courseid: 11, course: { id: 11, fullname: "Networking Basics" }, action: { actionable: true } },
          { name: "Problem set 3", timesort: now + 300000, courseid: 14, course: { id: 14, fullname: "Data Structures" }, action: { actionable: true } },
          { name: "Course starts", timesort: now + 400000, courseid: 14, course: { id: 14, fullname: "Data Structures" }, action: { actionable: false } },
          { name: "Course ends", timesort: now + 500000, courseid: 11, course: { id: 11, fullname: "Networking Basics" } },
        ];
        return send({ events: events.filter((e) => e.timesort >= from && e.timesort <= to) });
      }
      case "mod_assign_get_assignments": {
        const ids = Object.keys(q).filter((k) => k.startsWith("courseids[")).map((k) => q[k]);
        const byCourse: Record<string, unknown[]> = {
          "11": [
            { id: 1, name: "Lab 3", duedate: now + 5000 },
            { id: 2, name: "Lab 2", duedate: now - 5000 },
            { id: 3, name: "Lab 1", duedate: now - 9000 },
            { id: 8, name: "Reading notes", duedate: 0 },
          ],
          "14": [
            { id: 4, name: "Essay 2", duedate: now - 2000 },
            { id: 5, name: "Reading list", duedate: now + 1000 },
            { id: 6, name: "Group project", duedate: now + 3000 },
          ],
        };
        if (ids.includes("12")) {
          return send({ exception: "moodle_exception", errorcode: "invalidrecord", message: "Invalid record ID (record not found)" });
        }
        return send({ courses: [{ assignments: ids.flatMap((id) => byCourse[id] ?? []) }] });
      }
      case "mod_assign_get_submission_status":
        if (q.assignid === "1" || q.assignid === "4" || q.assignid === "8") return send({ lastattempt: { submission: { status: "new" } } });
        if (q.assignid === "5") return send({ lastattempt: { submission: { status: "draft" } } });
        if (q.assignid === "6") {
          return send({ exception: "moodle_exception", errorcode: "invalidrecord", message: "Invalid record ID (record not found)" });
        }
        if (q.assignid === "2") return send({ lastattempt: { submission: { status: "submitted" } } });
        return send({ lastattempt: { submission: { status: "submitted" } }, feedback: { gradefordisplay: "8.00 / 10.00" } });
      case "gradereport_overview_get_course_grades":
        return send({ grades: [{ courseid: 11, grade: "88.5" }, { courseid: 12, grade: "70" }, { courseid: 14, grade: "-" }] });
      case "gradereport_user_get_grade_items":
        return send({ usergrades: [{ gradeitems: [
          { itemname: "Lab 1", gradeformatted: "8.00", percentageformatted: "80.00 %" },
          { itemname: null, gradeformatted: "88.50", percentageformatted: "88.50 %" },
        ] }] });
      case "core_course_get_contents":
        return send([{ name: "Week 1", modules: [
          {
            name: "Intro slides",
            modname: "resource",
            description: "<p>Read these <b>before</b> class. Bring questions.</p>",
            contents: [
              {
                type: "file",
                filename: "week1-slides.pdf",
                fileurl: `${base}/webservice/pluginfile.php/1/mod_resource/content/0/week1-slides.pdf?forcedownload=1&token=good`,
              },
              {
                type: "file",
                filename: "notes.txt",
                fileurl: `${base}/webservice/pluginfile.php/1/mod_resource/content/0/notes.txt?token=good`,
              },
            ],
          },
          { name: "Week 1 quiz", modname: "quiz", description: "<p>Covers chapters 1 and 2.</p>" },
        ] }]);
      case "mod_page_get_pages_by_courses":
        return send({ pages: [
          { name: "Week 1 reading", visible: 1, content: "<h2>Packets</h2><p>A packet <b>travels</b> in hops.</p>" },
          { name: "Hidden page", visible: 0, content: "<p>secret</p>" },
          { name: "Long page", visible: 1, content: "<p>" + "x".repeat(25000) + "</p>" },
        ] });
      case "mod_forum_get_forums_by_courses": {
        if (q.wstoken === "forumtoken") {
          return send({ exception: "moodle_exception", errorcode: "invalidtoken", message: "Invalid token - token not found" });
        }
        const ids = Object.keys(q).filter((k) => k.startsWith("courseids[")).map((k) => q[k]);
        if (ids.includes("12")) {
          return send({ exception: "moodle_exception", errorcode: "invalidrecord", message: "Invalid record ID (record not found)" });
        }
        if (ids.includes("13")) {
          return send({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" });
        }
        const forums: Record<string, unknown>[] = [];
        for (const id of ids) {
          if (id === "11") forums.push({ id: 5, course: 11, type: "news", name: "Announcements" }, { id: 6, course: 11, type: "general", name: "Chat" });
          if (id === "14") forums.push({ id: 7, course: 14, type: "news", name: "Course news" });
        }
        return send(forums);
      }
      case "mod_forum_get_forum_discussions": {
        if (String(failForum) === q.forumid) {
          return send({ exception: "moodle_exception", errorcode: "invalidrecord", message: "Invalid record ID (record not found)" });
        }
        if (q.forumid === "7") {
          return send({ discussions: [{ subject: "Lab due Friday", name: "Lab due Friday", timemodified: now - 2000, message: "<p>Bring your <b>laptop</b></p>" }] });
        }
        return send({ discussions: [{ subject: "Welcome", name: "Welcome", timemodified: now - 1000, message: "<p>Hello <b>class</b></p>" }] });
      }
      case "core_enrol_get_users_courses_fail":
        return send({});
    }
    return send({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

afterAll(() => Promise.all([
  new Promise<void>((r) => srv.close(() => r())),
  new Promise<void>((r) => other.close(() => r())),
]));

async function connect(token = "good") {
  const server = createServer(createMoodleApi(base, token));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const res: any = await client.callTool({ name, arguments: args });
  return { text: res.content[0].text as string, isError: Boolean(res.isError) };
}

describe("moodle-student-mcp", () => {
  it("exposes only read-only tools", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.length).toBe(12);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("describes every tool with the question it answers, its inputs and a sample prompt", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.length).toBe(12);
    for (const t of tools) {
      expect(t.description, t.name).toMatch(/^Answers '/);
      expect(t.description, t.name).toMatch(/Ask: '/);
      const props = Object.keys((t.inputSchema as { properties?: object }).properties ?? {});
      if (props.length) {
        for (const p of props) expect(t.description, `${t.name} mentions ${p}`).toContain(p);
      } else {
        expect(t.description, t.name).toContain("No input.");
      }
    }
  });

  it("lists current courses and hides old and hidden ones", async () => {
    const { text } = await call(await connect(), "get_my_courses");
    expect(text).toContain("Networking Basics");
    expect(text).not.toContain("Old Course");
    expect(text).not.toContain("Hidden Course");
  });

  it("sorts upcoming work and finds overdue actionable work only", async () => {
    const c = await connect();
    const up = (await call(c, "get_upcoming_due_dates")).text;
    expect(up.indexOf("Quiz 1")).toBeLessThan(up.indexOf("Lab 4"));
    const od = (await call(c, "get_overdue")).text;
    expect(od).toContain("Lab 2 is due");
    expect(od).not.toContain("Quiz closed");
    // oldest first, so Essay draft (2 days back) comes before Lab 2 (1 day back)
    expect(od.indexOf("Essay draft")).toBeLessThan(od.indexOf("Lab 2 is due"));
  });

  it("leaves out course events that need no action", async () => {
    const c = await connect();
    const up = (await call(c, "get_upcoming_due_dates")).text;
    expect(up).toContain("Quiz 1 closes");
    expect(up).not.toContain("Course starts");
    expect(up).not.toContain("Course ends");
  });

  it("keeps every course when no filter is given", async () => {
    const c = await connect();
    const up = (await call(c, "get_upcoming_due_dates")).text;
    expect(up).toContain("Quiz 1 closes");
    expect(up).toContain("Problem set 3");
    const od = (await call(c, "get_overdue")).text;
    expect(od).toContain("Lab 2 is due");
    expect(od).toContain("Essay draft");
  });

  it("limits due dates and overdue work to the courses asked for", async () => {
    const c = await connect();
    const up = (await call(c, "get_upcoming_due_dates", { course_ids: [14] })).text;
    expect(up).toContain("Problem set 3");
    expect(up).not.toContain("Quiz 1 closes");
    const od = (await call(c, "get_overdue", { course_ids: [14] })).text;
    expect(od).toContain("Essay draft");
    expect(od).not.toContain("Lab 2 is due");
  });

  it("shows an empty list when the courses asked for have nothing due", async () => {
    const c = await connect();
    expect((await call(c, "get_upcoming_due_dates", { course_ids: [99] })).text).toBe("No upcoming due dates.");
    expect((await call(c, "get_overdue", { course_ids: [99] })).text).toBe("Nothing overdue.");
  });

  it("takes course IDs as text as well as numbers", async () => {
    const c = await connect();
    const up = (await call(c, "get_upcoming_due_dates", { course_ids: ["11"] })).text;
    expect(up).toContain("Quiz 1 closes");
    expect(up).not.toContain("Problem set 3");
  });

  it("puts overdue work, work due soon, work with no due date and announcements in one digest", async () => {
    const { text, isError } = await call(await connect(), "get_todo");
    expect(isError).toBe(false);
    expect(text).toMatch(/^Start here: .*\n\nOverdue:/);
    expect(text).toContain("Overdue:");
    expect(text).toMatch(/Essay 2 \(Data Structures\) was due .* not submitted/);
    expect(text).toContain("Due soon:");
    expect(text).toMatch(/Reading list \(Data Structures\) is due .* draft, not submitted/);
    expect(text).toContain("No due date:");
    expect(text).toMatch(/Reading notes \(Networking Basics\) has no due date, not submitted/);
    expect(text).toContain("New announcements:");
    expect(text).toContain("Welcome (Networking Basics,");
    expect(text).toContain("Lab due Friday (Data Structures,");
  });

  it("shows work due soon in date order in the digest", async () => {
    const { text } = await call(await connect(), "get_todo", { course_ids: [11] });
    expect(text.indexOf("Lab 3")).toBeLessThan(text.indexOf("Quiz 1 closes"));
  });

  it("limits the digest to the courses asked for", async () => {
    const { text } = await call(await connect(), "get_todo", { course_ids: [11] });
    expect(text).toContain("Lab 3");
    expect(text).toContain("Reading notes");
    expect(text).not.toContain("Data Structures");
    expect(text).toContain("Welcome");
    expect(text).not.toContain("Lab due Friday");
  });

  it("honours the digest windows", async () => {
    const c = await connect();
    const near = (await call(c, "get_todo", { course_ids: [11], days_ahead: 1 })).text;
    expect(near).toContain("Lab 3");
    expect(near).not.toContain("Quiz 1 closes");
    const noPast = (await call(c, "get_todo", { course_ids: [14], overdue_days: 0 })).text;
    expect(noPast).not.toContain("Overdue:");
    expect(noPast).not.toContain("Essay 2");
    expect(noPast).toContain("Reading list");
  });

  it("says when there is nothing to do", async () => {
    const { text } = await call(await connect(), "get_todo", { course_ids: [99] });
    expect(text).toBe("Nothing to do right now.");
  });

  it("keeps the digest when one course will not open", async () => {
    const { text, isError } = await call(await connect(), "get_todo", { course_ids: [11, 12] });
    expect(isError).toBe(false);
    expect(text).toContain("Lab 3");
    expect(text).toContain("Could not read course 12");
  });

  it("asks for more events when a filter will drop some of them", async () => {
    const limitAsked = async (args: Record<string, unknown>) => {
      seenParams.length = 0;
      await call(await connect(), "get_upcoming_due_dates", args);
      const ask = seenParams.find((p) => p.wsfunction === "core_calendar_get_action_events_by_timeframe");
      return Number(ask?.limitnum);
    };
    expect(await limitAsked({})).toBe(50);
    expect(await limitAsked({ course_ids: [14] })).toBeGreaterThan(50);
  });

  it("shows assignments with submission status", async () => {
    const { text } = await call(await connect(), "get_assignments", { course_id: 11 });
    expect(text).toMatch(/Lab 3.*not submitted/);
    expect(text).toMatch(/Lab 2.*submitted/);
    expect(text).toMatch(/Lab 1.*graded 8.00 \/ 10.00/);
  });

  it("sends array parameters the way Moodle expects", async () => {
    seenParams.length = 0;
    await call(await connect(), "get_assignments", { course_id: 11 });
    expect(seenParams.some((p) => p.wsfunction === "mod_assign_get_assignments" && p["courseids[0]"] === "11")).toBe(true);
    expect(flatten({ courseids: [1, 2], opts: { a: 1 } })).toEqual({ "courseids[0]": "1", "courseids[1]": "2", "opts[a]": "1" });
  });

  it("lists the work that was never handed in", async () => {
    const { text, isError } = await call(await connect(), "get_missing_work");
    expect(isError).toBe(false);
    expect(text).toMatch(/Essay 2 \(Data Structures\) was due .* not submitted/);
    expect(text).toMatch(/Lab 3 \(Networking Basics\) is due .* not submitted/);
    expect(text).toMatch(/Reading list \(Data Structures\) is due .* draft, not submitted/);
  });

  it("leaves out work that was already handed in or graded", async () => {
    const { text } = await call(await connect(), "get_missing_work");
    expect(text).not.toContain("Lab 2");
    expect(text).not.toContain("Lab 1");
  });

  it("limits missing work to the courses asked for", async () => {
    const { text } = await call(await connect(), "get_missing_work", { course_ids: [11] });
    expect(text).toContain("Lab 3");
    expect(text).not.toContain("Essay 2");
  });

  it("says when there is no missing work", async () => {
    const { text } = await call(await connect(), "get_missing_work", { course_ids: [99] });
    expect(text).toBe("No missing work found.");
  });

  it("keeps the missing work when one course will not open", async () => {
    const { text, isError } = await call(await connect(), "get_missing_work", { course_ids: [11, 12] });
    expect(isError).toBe(false);
    expect(text).toContain("Lab 3");
    expect(text).toContain("Could not read course 12");
    expect(text).toContain("Invalid record ID (record not found)");
  });

  it("says when the submission status of an assignment cannot be read", async () => {
    const { text } = await call(await connect(), "get_missing_work");
    expect(text).not.toContain("Group project");
    expect(text).toContain("Could not read the submission status of 1 assignment.");
  });

  it("reports a sign in problem instead of an empty list of missing work", async () => {
    const { text, isError } = await call(await connect("bad"), "get_missing_work");
    expect(isError).toBe(true);
    expect(text).toBe(setupMessage("notSignedIn"));
  });

  it("reports grades only for current courses", async () => {
    const { text } = await call(await connect(), "get_my_grades");
    expect(text).toContain("Networking Basics 88.5");
    expect(text).not.toContain("Old Course");
  });

  it("shows grade items, content and announcements", async () => {
    const c = await connect();
    const gi = (await call(c, "get_course_grade_items", { course_id: 11 })).text;
    expect(gi).toContain("Lab 1 8.00 (80.00 %)");
    expect(gi).toContain("Course total 88.50");
    expect((await call(c, "get_course_content", { course_id: 11 })).text).toContain("Intro slides");
    const ann = (await call(c, "get_announcements")).text;
    expect(ann).toContain("Welcome");
    expect(ann).toContain("Hello class");
    expect(ann).toContain("Welcome (Networking Basics,");
  });

  it("reads page activities and filters by title", async () => {
    const c = await connect();
    const all = (await call(c, "get_course_page", { course_id: 11 })).text;
    expect(all).toContain("Week 1 reading\nPackets\nA packet travels in hops.");
    expect(all).not.toContain("secret");
    expect(all).not.toContain("<b>");
    expect(all).toContain("[truncated]");
    const one = (await call(c, "get_course_page", { course_id: 11, page_name: "week 1" })).text;
    expect(one).toContain("A packet travels");
    expect(one).not.toContain("xxxx");
    const none = await call(c, "get_course_page", { course_id: 11, page_name: "nothing" });
    expect(none.text).toContain("No page in this course");
  });

  it("shows the intro text of each activity in course content", async () => {
    const { text } = await call(await connect(), "get_course_content", { course_id: 11 });
    expect(text).toMatch(/Intro slides \(resource\).*\n\s+Read these before class\. Bring questions\./);
    expect(text).toMatch(/Week 1 quiz \(quiz\)\n\s+Covers chapters 1 and 2\./);
    expect(text).not.toContain("<b>");
    expect(text).not.toContain("<p>");
  });

  it("shows file names and links without the key in course content", async () => {
    const { text, isError } = await call(await connect(), "get_course_content", { course_id: 11 });
    expect(isError).toBe(false);
    expect(text).toContain("week1-slides.pdf");
    expect(text).toContain("notes.txt");
    expect(text).not.toContain("token");
    expect(text).toContain("forcedownload=1");

    const link = /week1-slides\.pdf \((http[^)]+)\)/.exec(text)?.[1];
    expect(link).toBeTruthy();
    seenFiles.length = 0;
    const file = await call(await connect(), "get_file", { file_url: link });
    expect(file.isError).toBe(false);
    expect(file.text).toContain("Week 3 slides");
    expect(seenFiles[0]?.token).toBe("good");
  });

  it("downloads a file from the school's own site and sends the key there", async () => {
    seenFiles.length = 0;
    const { text, isError } = await call(await connect(), "get_file", {
      file_url: `${base}/webservice/pluginfile.php/1/mod_resource/content/0/slides.pdf`,
    });
    expect(isError).toBe(false);
    expect(text).toContain("Week 3 slides");
    expect(seenFiles).toHaveLength(1);
    expect(seenFiles[0].token).toBe("good");
  });

  it("downloads a file from a link with no host in it", async () => {
    seenFiles.length = 0;
    const { text, isError } = await call(await connect(), "get_file", {
      file_url: "/webservice/pluginfile.php/1/mod_resource/content/0/slides.pdf",
    });
    expect(isError).toBe(false);
    expect(text).toContain("Week 3 slides");
    expect(seenFiles[0].token).toBe("good");
  });

  it("explains a PDF instead of returning its bytes", async () => {
    seenFiles.length = 0;
    const { text, isError } = await call(await connect(), "get_file", {
      file_url: `${base}/webservice/pluginfile.php/1/mod_resource/content/0/binary.pdf`,
    });
    expect(isError).toBe(false);
    expect(text).toContain("File: binary.pdf");
    expect(text).toContain("Open it in Moodle");
    expect(text).toContain(`${base}/webservice/pluginfile.php/1/mod_resource/content/0/binary.pdf`);
    expect(text).not.toContain("%PDF");
    expect(text).not.toContain("binary noise");
    expect(text).not.toContain("token");
    expect(seenFiles[0]?.token).toBe("good");
  });

  it("spots a PDF even when the server calls it text", async () => {
    const { text, isError } = await call(await connect(), "get_file", {
      file_url: `${base}/webservice/pluginfile.php/1/mod_resource/content/0/fake.txt`,
    });
    expect(isError).toBe(false);
    expect(text).toContain("File: fake.txt");
    expect(text).toContain("This is a PDF");
    expect(text).not.toContain("%PDF");
  });

  it("explains a file with a content type that is not text", async () => {
    const { text, isError } = await call(await connect(), "get_file", {
      file_url: `${base}/webservice/pluginfile.php/1/mod_resource/content/0/diagram.png`,
    });
    expect(isError).toBe(false);
    expect(text).toContain("File: diagram.png");
    expect(text).toContain("image/png");
    expect(text).toContain("Open it in Moodle");
    expect(text).not.toContain("not text at all");
  });

  it("refuses a file link on another server and keeps the key off it", async () => {
    otherHits.length = 0;
    const { text, isError } = await call(await connect(), "get_file", { file_url: `${otherUrl}/steal` });
    expect(isError).toBe(true);
    expect(text).toContain("your Moodle key was not sent");
    expect(otherHits).toEqual([]);
  });

  it("refuses a file link that only looks like the school one", async () => {
    const { text, isError } = await call(await connect(), "get_file", {
      file_url: "https://moodle.school.edu.evil.example/slides.pdf",
    });
    expect(isError).toBe(true);
    expect(text).toContain("your Moodle key was not sent");
  });

  it("knows which addresses are the school's own", () => {
    expect(sameOrigin("https://moodle.school.edu/x", "https://moodle.school.edu")).toBe(true);
    expect(sameOrigin("https://moodle.school.edu:443/x", "https://moodle.school.edu")).toBe(true);
    expect(sameOrigin("/pluginfile.php/1/x", "https://moodle.school.edu")).toBe(false);
    expect(sameOrigin("https://evil.example/x", "https://moodle.school.edu")).toBe(false);
    expect(sameOrigin("https://moodle.school.edu.evil.example/x", "https://moodle.school.edu")).toBe(false);
    expect(sameOrigin("https://files.moodle.school.edu/x", "https://moodle.school.edu")).toBe(false);
    expect(sameOrigin("http://moodle.school.edu/x", "https://moodle.school.edu")).toBe(false);
  });

  it("keeps the announcements when one course will not open", async () => {
    const { text, isError } = await call(await connect(), "get_announcements", { course_ids: [11, 12] });
    expect(isError).toBe(false);
    expect(text).toContain("Welcome");
    expect(text).toContain("Could not read course 12");
    expect(text).toContain("Invalid record ID (record not found)");
  });

  it("keeps the announcements when one course denies access", async () => {
    const { text, isError } = await call(await connect(), "get_announcements", { course_ids: [11, 13] });
    expect(isError).toBe(false);
    expect(text).toContain("Welcome");
    expect(text).toContain("Could not read course 13");
    expect(text).toContain("Access control exception");
  });

  it("keeps the announcements when one news forum will not open", async () => {
    failForum = 5;
    try {
      const { text, isError } = await call(await connect(), "get_announcements", { course_ids: [11, 14] });
      expect(isError).toBe(false);
      expect(text).toContain("Lab due Friday");
      expect(text).toContain("Could not read the Announcements forum");
      expect(text).not.toContain("Welcome");
    } finally {
      failForum = 0;
    }
  });

  it("reports the problem when no announcement can be read at all", async () => {
    const { text, isError } = await call(await connect(), "get_announcements", { course_ids: [12] });
    expect(isError).toBe(true);
    expect(text).toBe(setupMessage("notFound"));
  });

  it("still reports a sign in problem instead of an empty list", async () => {
    const { text, isError } = await call(await connect("forumtoken"), "get_announcements");
    expect(isError).toBe(true);
    expect(text).toBe(setupMessage("notSignedIn"));
  });

  it("turns Moodle's 200 error responses into friendly messages", async () => {
    const { text, isError } = await call(await connect("bad"), "get_my_courses");
    expect(isError).toBe(true);
    expect(text).toContain("Not signed in");
  });

  it("raises each setup problem with its fix", async () => {
    const cases: [string, SetupProblemKey][] = [
      ["bad", "notSignedIn"],
      ["noauth", "accessDenied"],
      ["noweb", "webServicesNotEnabled"],
      ["noservice", "webServicesNotEnabled"],
      ["badrecord", "notFound"],
    ];
    for (const [token, key] of cases) {
      const { text, isError } = await call(await connect(token), "get_my_courses");
      expect(isError, token).toBe(true);
      expect(text, token).toBe(setupMessage(key));
    }
  });

  it("raises the same message for HTTP status errors", async () => {
    const cases: [string, SetupProblemKey][] = [
      ["http401", "notSignedIn"],
      ["http403", "accessDenied"],
      ["http404", "notFound"],
    ];
    for (const [token, key] of cases) {
      const { text, isError } = await call(await connect(token), "get_my_courses");
      expect(isError, token).toBe(true);
      expect(text, token).toBe(setupMessage(key));
    }
  });

  it("points at the Security keys page when the key is the problem", async () => {
    const signedOut = (await call(await connect("bad"), "get_my_courses")).text;
    expect(signedOut).toContain("Preferences > User account > Security keys");
    const noWeb = (await call(await connect("noweb"), "get_my_courses")).text;
    expect(noWeb).toContain("Preferences > User account > Security keys");
    expect(noWeb).toContain("Web services not enabled");
  });

  it("reads an HTML error page as a setup problem", async () => {
    const { text, isError } = await call(await connect("htmlpage"), "get_my_courses");
    expect(isError).toBe(true);
    expect(text).toBe(setupMessage("webServicesNotEnabled"));
  });

  it("normalizes school URLs", () => {
    expect(normalizeBaseUrl("moodle.myschool.edu/")).toBe("https://moodle.myschool.edu");
    expect(normalizeBaseUrl("https://m.edu/webservice/rest/server.php")).toBe("https://m.edu");
  });
});
