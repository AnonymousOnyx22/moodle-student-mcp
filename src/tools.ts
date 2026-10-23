import { z } from "zod";
import type { MoodleApi } from "./moodle.js";
import { type ToolDef, bullets, fmtUnix, stripHtml } from "./core/tools.js";
import { ApiError, describeStatus, isSiteWideError, sameOrigin, statusSetupKey } from "./core/http.js";

type Api = MoodleApi;

const courseId = z.union([z.string(), z.number()]).describe("Moodle course ID. Use get_my_courses to find it.");
const DAY = 86400;
/** The most items a due date list shows. */
const MAX_ITEMS = 50;
/** The most assignments looked at in one course. */
const MAX_COURSE_ASSIGNMENTS = 25;
/** Events asked for when a course filter will drop some of them. */
const FILTERED_EVENTS = 200;

/** The file name Moodle sent, or the last part of the link when it sent none. */
function fileName(file: any): string {
  if (file?.filename) return String(file.filename);
  try {
    const u = new URL(String(file?.fileurl ?? ""), "https://placeholder.invalid");
    const last = u.pathname.split("/").filter(Boolean).pop();
    if (!last) return "file";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return "file";
  }
}

/** Remove the user's key from a query string, even when the link cannot be parsed. */
function stripKeyParams(raw: string): string {
  return raw
    .replace(/([?&])(?:wstoken|token)=[^&#]*/gi, "$1")
    .replace(/\?&/, "?")
    .replace(/&&/g, "&")
    .replace(/[?&](?=$|#)/, "");
}

/** A course file link with the user's key removed, so it is safe to show in a chat. */
function fileLink(file: any): string {
  const raw = String(file?.fileurl ?? "");
  try {
    const u = new URL(raw, "https://placeholder.invalid");
    for (const name of [...u.searchParams.keys()]) {
      if (/^(ws)?token$/i.test(name)) u.searchParams.delete(name);
    }
    // Keep a relative link relative, so the answer does not name a made up host.
    return /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//") ? u.toString() : u.pathname + u.search + u.hash;
  } catch {
    return stripKeyParams(raw);
  }
}

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

/** The submission state of one assignment, as the school server reports it. */
function submissionState(status: any): string | undefined {
  const state = status?.submission?.status ?? status?.lastattempt?.submission?.status;
  return state === undefined || state === null || state === "" ? undefined : String(state);
}

/** True when the assignment was never handed in. */
function isUnsubmitted(state: string): boolean {
  return state === "new" || state === "draft";
}

/** How work that was never handed in is described. */
function unsubmittedText(state: string): string {
  return state === "draft" ? "draft, not submitted" : "not submitted";
}

/** How the due date of work that is still owed is described. */
function dueText(duedate: number | undefined, now: number): string {
  if (!duedate) return "has no due date";
  return duedate < now ? `was due ${fmtUnix(duedate)}` : `is due ${fmtUnix(duedate)}`;
}

/** Why one course or forum was left out, in the words the school server used. */
function reasonText(err: unknown): string {
  if (err instanceof ApiError) return err.detail ?? err.message;
  return (err as Error).message;
}

/** The course a calendar event belongs to, or 0 when it has none. */
function eventCourseId(event: any): number {
  const id = event?.courseid ?? event?.course?.id;
  return Number(id) || 0;
}

/**
 * The calendar events in a window. The school server sends the events of every
 * course, so the courses the student asked for are kept here. Without a filter
 * every event comes back.
 */
async function calendarEvents(api: Api, from: number, to: number, courseIds?: (string | number)[]): Promise<any[]> {
  const asked = courseIds ?? [];
  const wanted = asked.map((id) => Number(id)).filter((id) => Number.isFinite(id));
  const r = await api.call<{ events?: any[] }>("core_calendar_get_action_events_by_timeframe", {
    timesortfrom: from,
    timesortto: to,
    // Events of other courses will be dropped, so ask for more of them.
    limitnum: asked.length ? FILTERED_EVENTS : MAX_ITEMS,
  });
  const events = r.events ?? [];
  return asked.length ? events.filter((e) => wanted.includes(eventCourseId(e))) : events;
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
      "Answers 'what is due soon?' Lists up to 50 items due in the next 60 days across your courses that still need action, soonest first, with the course name and due date. Course events such as 'Course starts' and 'Course ends' are left out because there is nothing to do about them. Input: course_ids, an optional array of course IDs to limit the list; leave it out to cover all current courses. Ask: 'What's due in the next two weeks?'",
    inputSchema: { course_ids: z.array(courseId).optional() },
    run: async ({ course_ids }, api) => {
      const now = Math.floor(Date.now() / 1000);
      const events = (await calendarEvents(api, now, now + 60 * DAY, course_ids))
        .filter((e) => e.action?.actionable)
        .sort((a, b) => a.timesort - b.timesort)
        .slice(0, MAX_ITEMS);
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
      "Answers 'is anything overdue?' Lists past due items from the last 45 days that still need action, with the course name and the date each was due. Input: course_ids, an optional array of course IDs to limit the list; leave it out to cover all current courses. Ask: 'Is anything overdue?'",
    inputSchema: { course_ids: z.array(courseId).optional() },
    run: async ({ course_ids }, api) => {
      const now = Math.floor(Date.now() / 1000);
      const events = (await calendarEvents(api, now - 45 * DAY, now, course_ids))
        .filter((e) => e.action?.actionable)
        .slice(0, MAX_ITEMS);
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
    name: "get_missing_work",
    title: "Missing work",
    description:
      "Answers 'what do I still owe?' Lists the assignments in your courses that you have not handed in yet, with the course name and the due date. Drafts that were never handed in are included, and work that was already handed in or graded is left out. Up to 25 assignments in each course are checked and the list holds up to 50 items. Input: course_ids, an optional array of course IDs to limit the list; leave it out to cover all current courses. Ask: 'What work am I still missing?'",
    inputSchema: { course_ids: z.array(courseId).optional() },
    run: async ({ course_ids }, api) => {
      const courses = await myCourses(api);
      const names = new Map(courses.map((c) => [c.id, c.fullname]));
      const asked: (string | number)[] = course_ids?.length ? course_ids : courses.map((c) => c.id);
      const ids = [...new Set(asked.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
      if (!ids.length) return "No current courses found.";

      const now = Math.floor(Date.now() / 1000);
      const owed: { name: string; course: string; duedate: number; state: string }[] = [];
      const problems: string[] = [];
      let unread = 0;

      for (const id of ids) {
        const label = names.get(id) ?? `course ${id}`;
        let assignments: any[] = [];
        try {
          const r = await api.call<{ courses?: { assignments?: any[] }[] }>("mod_assign_get_assignments", { courseids: [id] });
          assignments = r.courses?.[0]?.assignments ?? [];
        } catch (err) {
          if (isSiteWideError(err)) throw err;
          problems.push(`Could not read ${label}: ${reasonText(err)}`);
          continue;
        }
        const list = [...assignments]
          .sort((a, b) => (a.duedate || 9e12) - (b.duedate || 9e12))
          .slice(0, MAX_COURSE_ASSIGNMENTS);
        for (const a of list) {
          if (!a || a.requiresubmission === 0 || a.uservisible === 0) continue;
          let state: string | undefined;
          try {
            state = submissionState(await api.call("mod_assign_get_submission_status", { assignid: a.id }));
          } catch (err) {
            if (isSiteWideError(err)) throw err;
            unread++;
            continue;
          }
          if (!state) {
            unread++;
            continue;
          }
          if (!isUnsubmitted(state)) continue;
          owed.push({ name: a.name ?? `assignment ${a.id}`, course: label, duedate: a.duedate ?? 0, state });
        }
      }

      const lines = owed
        .sort((a, b) => (a.duedate || 9e12) - (b.duedate || 9e12))
        .slice(0, MAX_ITEMS)
        .map((o) => `${o.name} (${o.course}) ${dueText(o.duedate, now)}, ${unsubmittedText(o.state)}`);
      const notes = [...problems];
      if (unread) notes.push(`Could not read the submission status of ${unread} assignment${unread === 1 ? "" : "s"}.`);
      const body = bullets(lines, "No missing work found.");
      return notes.length ? `${body}\n${bullets(notes)}` : body;
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
      "Answers 'what's in this course?' Lists the sections of one course, such as weeks or topics, with up to 40 activities in each, such as pages, quizzes and forums. Each file shows its name and a link with your key removed, so the link is safe to show in a chat and get_file can still open it. Input: course_id, the ID from get_my_courses. Ask: 'What materials are posted in Networking Basics?'",
    inputSchema: { course_id: courseId },
    run: async ({ course_id }, api) => {
      const sections = await api.call<any[]>("core_course_get_contents", { courseid: course_id });
      if (!sections?.length) return "This course has no content.";
      return sections
        .map((s) => {
          const mods = (s.modules ?? []).slice(0, 40).map((m: any) => {
            const files = (m.contents ?? [])
              .filter((c: any) => c?.type === "file" && c?.fileurl)
              .map((c: any) => `${fileName(c)} (${fileLink(c)})`);
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
      "Answers 'any new announcements?' Lists the latest news forum posts with subject and text, up to 5 posts from each of up to 10 news forums. A course or forum the school server will not open is left out and the rest still shows. Input: course_ids, an optional array of course IDs to limit the search; leave it out to cover all current courses. Ask: 'Any new announcements from my teachers?'",
    inputSchema: { course_ids: z.array(courseId).optional() },
    run: async ({ course_ids }, api) => {
      const courses = course_ids?.length ? [] : await myCourses(api);
      const ids: (string | number)[] = course_ids?.length ? course_ids : courses.map((c) => c.id);
      if (!ids.length) return "No current courses found.";
      const courseLabel = (id: string | number) => courses.find((c) => c.id === Number(id))?.fullname ?? `course ${id}`;

      const forums: any[] = [];
      const seen = new Set<number>();
      const leftOut: string[] = [];
      let firstError: unknown;

      const addForums = (list: any[]) => {
        for (const f of list ?? []) {
          if (!f) continue;
          if (f.id !== undefined) {
            if (seen.has(f.id)) continue;
            seen.add(f.id);
          }
          forums.push(f);
        }
      };

      let coursesRead = 0;
      try {
        addForums(await api.call<any[]>("mod_forum_get_forums_by_courses", { courseids: ids }));
        coursesRead = ids.length;
      } catch (err) {
        if (isSiteWideError(err)) throw err;
        // One course can break the call for all of them, so ask for each course on its own.
        for (const id of ids) {
          try {
            addForums(await api.call<any[]>("mod_forum_get_forums_by_courses", { courseids: [id] }));
            coursesRead++;
          } catch (courseErr) {
            if (isSiteWideError(courseErr)) throw courseErr;
            firstError ??= courseErr;
            leftOut.push(`Could not read ${courseLabel(id)}: ${reasonText(courseErr)}`);
          }
        }
      }

      const news = forums.filter((f) => f.type === "news").slice(0, 10);
      const lines: string[] = [];
      let forumsRead = 0;
      for (const f of news) {
        let discussions: any[] = [];
        try {
          const r = await api.call<{ discussions?: any[] }>("mod_forum_get_forum_discussions", { forumid: f.id, perpage: 5 });
          discussions = r.discussions ?? [];
        } catch (err) {
          if (isSiteWideError(err)) throw err;
          firstError ??= err;
          leftOut.push(`Could not read the ${f.name ?? `forum ${f.id}`} forum: ${reasonText(err)}`);
          continue;
        }
        forumsRead++;
        for (const d of discussions) {
          lines.push(`${d.subject ?? d.name} (${fmtUnix(d.timemodified)})\n  ${stripHtml(d.message, 400).replace(/\n/g, " ")}`);
        }
      }

      // Nothing at all came back, so the first problem is the answer.
      if (!lines.length && firstError && (coursesRead === 0 || (news.length > 0 && forumsRead === 0))) {
        throw firstError;
      }

      const body = bullets(lines, "No recent announcements.");
      return leftOut.length ? `${body}\n${bullets(leftOut)}` : body;
    },
  },
  {
    name: "get_file",
    title: "Course file",
    description:
      "Answers 'what does this course file say?' Downloads one course file resource, such as a PDF, slide deck or handout, from its file_url and returns its readable text. Only a link on your school's Moodle site is downloaded, so your key is never sent to another server. Input: file_url, the link from get_course_content. Ask: 'Read the Week 3 slides PDF.'",
    inputSchema: { file_url: z.string().describe("URL of the course file to download. Use the link from get_course_content.") },
    run: async ({ file_url }, api) => {
      let url = String(file_url).trim();
      if (!/^https?:\/\//i.test(url)) url = api.baseUrl + "/" + url.replace(/^\/+/, "");
      let u: URL;
      try {
        u = new URL(url);
      } catch {
        throw new ApiError("That is not a link I can read. Use the link from get_course_content.", 0);
      }
      // The key only ever travels to the school's own Moodle server.
      if (!sameOrigin(u.toString(), api.baseUrl)) {
        throw new ApiError(
          "That link points at another server, so your Moodle key was not sent with it. get_file only reads files from your school's Moodle site. Use the link from get_course_content.",
          0,
        );
      }
      if (!u.searchParams.has("token") && api.token) u.searchParams.set("token", api.token);
      const res = await fetch(u.toString());
      if (!res.ok) throw new ApiError(describeStatus(res.status), res.status, undefined, statusSetupKey(res.status));
      const buf = await res.arrayBuffer();
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf).trim();
      if (!text) return "This file is empty.";
      return text.length > 20000 ? text.slice(0, 20000) + "\n[truncated]" : text;
    },
  },
];
