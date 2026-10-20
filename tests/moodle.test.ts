import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMoodleApi, flatten } from "../src/moodle.js";
import { createServer } from "../src/server.js";
import { normalizeBaseUrl } from "../src/config.js";
import { setupMessage, type SetupProblemKey } from "../src/core/http.js";

const now = Math.floor(Date.now() / 1000);
let srv: http.Server;
let base = "";
const seenParams: Record<string, string>[] = [];

beforeAll(async () => {
  srv = http.createServer((req, res) => {
    const url = new URL(req.url!, "http://x");
    const q = Object.fromEntries(url.searchParams.entries());
    seenParams.push(q);
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
    if (q.wstoken !== "good") {
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
        ]);
      case "core_calendar_get_action_events_by_timeframe": {
        const from = Number(q.timesortfrom);
        if (from < now - 86400) {
          return send({ events: [
            { name: "Lab 2 is due", timesort: now - 86400, course: { fullname: "Networking Basics" }, action: { actionable: true } },
            { name: "Quiz closed", timesort: now - 90000, course: { fullname: "Networking Basics" }, action: { actionable: false } },
          ] });
        }
        return send({ events: [
          { name: "Lab 4 is due", timesort: now + 200000, course: { fullname: "Networking Basics" } },
          { name: "Quiz 1 closes", timesort: now + 100000, course: { fullname: "Networking Basics" } },
        ] });
      }
      case "mod_assign_get_assignments":
        return send({ courses: [{ assignments: [
          { id: 1, name: "Lab 3", duedate: now + 5000 },
          { id: 2, name: "Lab 2", duedate: now - 5000 },
          { id: 3, name: "Lab 1", duedate: now - 9000 },
        ] }] });
      case "mod_assign_get_submission_status":
        if (q.assignid === "1") return send({ lastattempt: { submission: { status: "new" } } });
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
        return send([{ name: "Week 1", modules: [{ name: "Intro slides", modname: "resource" }] }]);
      case "mod_forum_get_forums_by_courses":
        return send([{ id: 5, type: "news", name: "Announcements" }, { id: 6, type: "general", name: "Chat" }]);
      case "mod_forum_get_forum_discussions":
        return send({ discussions: [{ subject: "Welcome", name: "Welcome", timemodified: now - 1000, message: "<p>Hello <b>class</b></p>" }] });
      case "core_enrol_get_users_courses_fail":
        return send({});
    }
    return send({ exception: "webservice_access_exception", errorcode: "accessexception", message: "Access control exception" });
  });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => srv.close(() => r())));

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
    expect(tools.length).toBe(8);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
  });

  it("describes every tool with the question it answers, its inputs and a sample prompt", async () => {
    const { tools } = await (await connect()).listTools();
    expect(tools.length).toBe(8);
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
