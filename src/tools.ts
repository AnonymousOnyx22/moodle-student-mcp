import { z } from "zod";
import type { MoodleApi } from "./moodle.js";
import { type ToolDef, bullets, fmtUnix, stripHtml } from "./core/tools.js";
import { ApiError, describeStatus } from "./core/http.js";

type Api = MoodleApi;

const courseId = z.union([z.string(), z.number()]).describe("Moodle course ID. Use get_my_courses to find it.");
const DAY = 86400;

interface Course {
  id: number;
  fullname: string;
  shortname?: string;
  hidden?: boolean;
  enddate?: number;
}

async function myCourses(api: Api): Promise<Course[]> {
  const now = Math.floor(Date.now() / 1000);
  const all = await api.call<Course[]>("core_enrol_get_users_courses", { userid: await api.userId() });
  return (all ?? []).filter((c) => !c.hidden && !(c.enddate && c.enddate > 0 && c.enddate < now));
}

function statusText(s: any): string {
  if (s?.feedback?.gradefordisplay) return `graded ${stripHtml(s.feedback.gradefordisplay, 40)}`;
  const st = s?.lastattempt?.submission?.status;
  if (st === "submitted") return "submitted";
  if (st === "draft") return "draft, not submitted";
  if (st === "new" || !st) return "not submitted";
  return String(st);
}

export const tools: ToolDef<Api>[] = [
  {
    name: "get_my_courses",
    title: "My courses",
    description:
      "Answers 'what courses am I enrolled in?' Lists each current Moodle course with the ID other tools take as course_id. No input. Ask: 'Which courses do I have this term?'",
    inputSchema: {},
    run: async (_args, api) => {
      const courses = await myCourses(api);
      return bullets(courses.map((c) => `${c.fullname} [id ${c.id}]`), "No current courses found.");
    },
  },
  {
    name: "get_upcoming_due_dates",
    title: "Upcoming due dates",
    description:
      "Answers 'what is due soon?' Lists up to 50 items due in the next 60 days across all current courses, soonest first, with the course name and due date. No input. Ask: 'What's due in the next two weeks?'",
    inputSchema: {},
    run: async (_args, api) => {
      const now = Math.floor(Date.now() / 1000);
      const r = await api.call<{ events?: any[] }>("core_calendar_get_action_events_by_timeframe", {
        timesortfrom: now,
        timesortto: now + 60 * DAY,
        limitnum: 50,
      });
      const events = (r.events ?? []).sort((a, b) => a.timesort - b.timesort);
      return bullets(
        events.map((e) => `${e.name} (${e.course?.fullname ?? "course"}) due ${fmtUnix(e.timesort)}`),
        "No upcoming due dates.",
      );
    },
  },
  {
    name: "get_overdue",
    title: "Overdue work",
    description:
      "Answers 'is anything overdue?' Lists past due items from the last 45 days that still need action, with the course name and the date each was due. No input. Ask: 'Is anything overdue?'",
    inputSchema: {},
    run: async (_args, api) => {
      const now = Math.floor(Date.now() / 1000);
      const r = await api.call<{ events?: any[] }>("core_calendar_get_action_events_by_timeframe", {
        timesortfrom: now - 45 * DAY,
        timesortto: now,
        limitnum: 50,
      });
      const events = (r.events ?? []).filter((e) => e.action?.actionable);
      return bullets(
        events.map((e) => `${e.name} (${e.course?.fullname ?? "course"}) was due ${fmtUnix(e.timesort)}`),
        "Nothing overdue.",
      );
    },
  },
  {
    name: "get_assignments",
    title: "Course assignments",
    description:
      "Answers 'what do I still need to submit in this course?' Lists up to 25 assignments for one course with due dates and submission status: not submitted, draft, submitted or graded. Input: course_id, the ID from get_my_courses. Ask: 'Which assignments have I not submitted yet in Networking Basics?'",
    inputSchema: { course_id: courseId },
    run: async ({ course_id }, api) => {
      const r = await api.call<{ courses?: { assignments?: any[] }[] }>("mod_assign_get_assignments", { courseids: [course_id] });
      const list = (r.courses?.[0]?.assignments ?? []).sort((a, b) => (a.duedate || 9e12) - (b.duedate || 9e12)).slice(0, 25);
      const lines = await Promise.all(
        list.map(async (a) => {
          let status = "status unknown";
          try {
            status = statusText(await api.call("mod_assign_get_submission_status", { assignid: a.id }));
          } catch {
            /* some schools hide status, keep going */
          }
          return `${a.name} due ${fmtUnix(a.duedate)} ${status}`;
        }),
      );
      return bullets(lines, "No assignments found.");
    },
  },
  {
    name: "get_my_grades",
    title: "My grades",
    description:
      "Answers 'what's my grade in each course?' Shows the posted overall grade for every current course, or 'no grade posted yet'. No input. Ask: 'What's my grade in each course?'",
    inputSchema: {},
    run: async (_args, api) => {
      const courses = await myCourses(api);
      const r = await api.call<{ grades?: { courseid: number; grade: string }[] }>("gradereport_overview_get_course_grades", {
        userid: await api.userId(),
      });
      const byId = new Map((r.grades ?? []).map((g) => [g.courseid, g.grade]));
      return bullets(
        courses.map((c) => {
          const g = byId.get(c.id);
          return `${c.fullname} ${g && g !== "-" ? g : "no grade posted yet"}`;
        }),
        "No grades found.",
      );
    },
  },
  {
    name: "get_course_grade_items",
    title: "Grade breakdown",
    description:
      "Answers 'what's in the gradebook for this course?' Lists every graded item for one course with the mark and percentage, including the course total when there is one. Input: course_id, the ID from get_my_courses. Ask: 'Show me the gradebook for Networking Basics.'",
    inputSchema: { course_id: courseId },
    run: async ({ course_id }, api) => {
      const r = await api.call<{ usergrades?: { gradeitems?: any[] }[] }>("gradereport_user_get_grade_items", {
        courseid: course_id,
        userid: await api.userId(),
      });
      const items = r.usergrades?.[0]?.gradeitems ?? [];
      return bullets(
        items.map((i) => {
          const pct = i.percentageformatted && i.percentageformatted !== "-" ? ` (${i.percentageformatted})` : "";
          return `${i.itemname || "Course total"} ${i.gradeformatted ?? "-"}${pct}`;
        }),
        "No graded items yet.",
      );
    },
  },
  {
    name: "get_course_content",
    title: "Course content",
    description:
      "Answers 'what's in this course?' Lists the sections of one course, such as weeks or topics, with up to 40 activities in each, such as pages, quizzes and forums. Input: course_id, the ID from get_my_courses. Ask: 'What materials are posted in Networking Basics?'",
    inputSchema: { course_id: courseId },
    run: async ({ course_id }, api) => {
      const sections = await api.call<any[]>("core_course_get_contents", { courseid: course_id });
      if (!sections?.length) return "This course has no content.";
      return sections
        .map((s) => {
          const mods = (s.modules ?? []).slice(0, 40).map((m: any) => {
        const files = (m.contents ?? [])
          .filter((c: any) => c?.type === "file" && c?.fileurl)
          .map((c: any) => c.fileurl);
        return `  - ${m.name} (${m.modname})${files.length ? " files: " + files.join(", ") : ""}`;
      });
          return `${s.name || "Section"}\n${mods.join("\n") || "  (empty)"}`;
        })
        .join("\n\n");
    },
  },
  {
    name: "get_announcements",
    title: "Announcements",
    description:
      "Answers 'any new announcements?' Lists the latest news forum posts with subject and text, up to 5 posts from each of up to 10 news forums. Input: course_ids, an optional array of course IDs to limit the search; leave it out to cover all current courses. Ask: 'Any new announcements from my teachers?'",
    inputSchema: { course_ids: z.array(courseId).optional() },
    run: async ({ course_ids }, api) => {
      const ids: (string | number)[] = course_ids?.length ? course_ids : (await myCourses(api)).map((c) => c.id);
      if (!ids.length) return "No current courses found.";
      const forums = await api.call<any[]>("mod_forum_get_forums_by_courses", { courseids: ids });
      const news = (forums ?? []).filter((f) => f.type === "news").slice(0, 10);
      const lines: string[] = [];
      for (const f of news) {
        const r = await api.call<{ discussions?: any[] }>("mod_forum_get_forum_discussions", { forumid: f.id, perpage: 5 });
        for (const d of r.discussions ?? []) {
          lines.push(`${d.subject ?? d.name} (${fmtUnix(d.timemodified)})\n  ${stripHtml(d.message, 400).replace(/\n/g, " ")}`);
        }
      }
      return bullets(lines, "No recent announcements.");
    },
  },
  {
    name: "get_file",
    title: "Course file",
    description:
      "Answers 'what does this course file say?' Downloads one course file resource, such as a PDF, slide deck or handout, from its file_url and returns its readable text. Input: file_url, the link from get_course_content. Ask: 'Read the Week 3 slides PDF.'",
    inputSchema: { file_url: z.string().describe("URL of the course file to download. Use the link from get_course_content.") },
    run: async ({ file_url }, api) => {
      let url = String(file_url).trim();
      if (!/^https?:\/\//i.test(url)) url = api.baseUrl + "/" + url.replace(/^\/+/, "");
      const u = new URL(url);
      if (!u.searchParams.has("token") && api.token) u.searchParams.set("token", api.token);
      const res = await fetch(u.toString());
      if (!res.ok) throw new ApiError(describeStatus(res.status), res.status);
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf).trim();
      if (!text) return "This file is empty.";
      return text.length > 20000 ? text.slice(0, 20000) + "\n[truncated]" : text;
    },
  },
];
