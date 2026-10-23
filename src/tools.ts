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
/** Default days ahead for the get_todo digest. */
const TODO_DAYS_AHEAD = 14;
/** Default days back for overdue work in the get_todo digest. */
const TODO_OVERDUE_DAYS = 14;
/** How many announcement subjects the get_todo digest shows. */
const TODO_ANNOUNCEMENTS = 5;
/** How many days back the get_todo digest looks for announcements. */
const TODO_ANNOUNCEMENT_DAYS = 7;

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

/** True when the content type is one a text decoder can read. */
function isTextType(type: string): boolean {
  return type.startsWith("text/") || /(json|xml|javascript|ecmascript)/.test(type);
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

/** A key that matches the same piece of work from the calendar and the assignment list. */
function todoKey(courseid: number, name: unknown): string {
  return `${courseid}:${String(name ?? "").trim().toLowerCase()}`;
}

interface Owed {
  id: number;
  name: string;
  course: string;
  courseid: number;
  duedate: number;
  state: string;
}

interface MissingWork {
  owed: Owed[];
  problems: string[];
  unread: number;
  ids: number[];
  names: Map<number, string>;
  /** Assignments whose submission status was read, so the digest can drop their calendar events. */
  known: Set<number>;
}

/** The assignments in the courses that still need a submission, with the course and due date. */
async function collectMissingWork(api: Api, courseIds?: (string | number)[]): Promise<MissingWork> {
  const courses = await myCourses(api);
  const names = new Map(courses.map((c) => [c.id, c.fullname]));
  const asked: (string | number)[] = courseIds?.length ? courseIds : courses.map((c) => c.id);
  const ids = [...new Set(asked.map((id) => Number(id)).filter((id) => Number.isFinite(id)))];
  const owed: Owed[] = [];
  const problems: string[] = [];
  const known = new Set<number>();
  let unread = 0;

  if (!ids.length) return { owed, problems, unread, ids, names, known };

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
      known.add(Number(a.id));
      if (!isUnsubmitted(state)) continue;
      owed.push({
        id: Number(a.id),
        name: a.name ?? `assignment ${a.id}`,
        course: label,
        courseid: id,
        duedate: a.duedate ?? 0,
        state,
      });
    }
  }

  return { owed, problems, unread, ids, names, known };
}

interface NewsPost {
  course: string;
  subject: string;
  message: string;
  modified: number;
}

interface NewsRead {
  posts: NewsPost[];
  leftOut: string[];
  firstError?: unknown;
  coursesRead: number;
  newsForums: number;
  forumsRead: number;
}

/**
 * The latest posts in the news forums of the courses asked for. A course or forum
 * the school server will not open is named in leftOut and the rest still shows.
 */
async function readNews(
  api: Api,
  ids: (string | number)[],
  courseLabel: (id: string | number) => string,
  postsPerForum = 5,
  maxForums = 10,
): Promise<NewsRead> {
  const forums: any[] = [];
  const seen = new Set<number>();
  const forumCourse = new Map<number, string | number>();
  const leftOut: string[] = [];
  let firstError: unknown;

  const addForums = (list: any[], onlyCourse?: string | number) => {
    for (const f of list ?? []) {
      if (!f) continue;
      if (f.id !== undefined) {
        if (seen.has(f.id)) continue;
        seen.add(f.id);
      }
      const cid = onlyCourse ?? f.course;
      if (f.id !== undefined && cid !== undefined) forumCourse.set(f.id, cid);
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
        addForums(await api.call<any[]>("mod_forum_get_forums_by_courses", { courseids: [id] }), id);
        coursesRead++;
      } catch (courseErr) {
        if (isSiteWideError(courseErr)) throw courseErr;
        firstError ??= courseErr;
        leftOut.push(`Could not read ${courseLabel(id)}: ${reasonText(courseErr)}`);
      }
    }
  }

  const news = forums.filter((f) => f.type === "news").slice(0, maxForums);
  const posts: NewsPost[] = [];
  let forumsRead = 0;
  for (const f of news) {
    let discussions: any[] = [];
    try {
      const r = await api.call<{ discussions?: any[] }>("mod_forum_get_forum_discussions", {
        forumid: f.id,
        perpage: postsPerForum,
      });
      discussions = r.discussions ?? [];
    } catch (err) {
      if (isSiteWideError(err)) throw err;
      firstError ??= err;
      leftOut.push(`Could not read the ${f.name ?? `forum ${f.id}`} forum: ${reasonText(err)}`);
      continue;
    }
    forumsRead++;
    for (const d of discussions) {
      const cid = forumCourse.get(f.id) ?? f.course;
      posts.push({
        course: cid !== undefined ? courseLabel(cid) : "course",
        subject: String(d.subject ?? d.name ?? "Announcement"),
        message: String(d.message ?? ""),
        modified: Number(d.timemodified) || 0,
      });
    }
  }

  return { posts, leftOut, firstError, coursesRead, newsForums: news.length, forumsRead };
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
    name: "get_todo",
    title: "What to do next",
    description:
      "Answers 'what should I do today?' One digest across your courses: overdue work, work due soon, assignments with no due date, and the latest announcement subjects, each with the course name and due date. Submission status comes from the assignment list and the calendar adds quizzes and other activities. Input: course_ids, an optional array of course IDs to limit the digest; days_ahead, how many days ahead to look, default 14; overdue_days, how many days back to look for overdue work, default 14. Ask: 'What should I do today?'",
    inputSchema: {
      course_ids: z.array(courseId).optional(),
      days_ahead: z.number().int().min(1).max(60).optional().describe("How many days ahead to look. Default 14."),
      overdue_days: z.number().int().min(0).max(30).optional().describe("How many days back to include overdue work. Default 14."),
    },
    run: async ({ course_ids, days_ahead, overdue_days }, api) => {
      const now = Math.floor(Date.now() / 1000);
      const ahead = days_ahead ?? TODO_DAYS_AHEAD;
      const back = overdue_days ?? TODO_OVERDUE_DAYS;
      const work = await collectMissingWork(api, course_ids);
      if (!work.ids.length) return "No current courses found.";

      let events: any[] = [];
      let calendarProblem: string | undefined;
      try {
        events = await calendarEvents(api, now - back * DAY, now + ahead * DAY, course_ids);
      } catch (err) {
        if (isSiteWideError(err)) throw err;
        calendarProblem = `Could not read the calendar: ${reasonText(err)}`;
      }

      // The assignment list already covers each assignment it knows, so only add
      // calendar events for other work or for assignments whose status was unread.
      const owed = new Set(work.owed.map((o) => todoKey(o.courseid, o.name)));
      const extra = events.filter(
        (e) =>
          e.action?.actionable &&
          !(e.modulename === "assign" && work.known.has(Number(e.instance))) &&
          !owed.has(todoKey(eventCourseId(e), e.name)),
      );

      const overdue = [
        ...work.owed
          .filter((o) => o.duedate > 0 && o.duedate < now && o.duedate >= now - back * DAY)
          .map((o) => ({
            at: o.duedate,
            text: `${o.name} (${o.course}) ${dueText(o.duedate, now)}, ${unsubmittedText(o.state)}`,
          })),
        ...extra
          .filter((e) => e.timesort < now)
          .map((e) => ({
            at: Number(e.timesort),
            text: `${e.name} (${e.course?.fullname ?? "course"}) was due ${fmtUnix(e.timesort)}`,
          })),
      ].sort((a, b) => a.at - b.at);

      const soon = [
        ...work.owed
          .filter((o) => o.duedate >= now && o.duedate <= now + ahead * DAY)
          .map((o) => ({
            at: o.duedate,
            text: `${o.name} (${o.course}) ${dueText(o.duedate, now)}, ${unsubmittedText(o.state)}`,
          })),
        ...extra
          .filter((e) => e.timesort >= now)
          .map((e) => ({
            at: Number(e.timesort),
            text: `${e.name} (${e.course?.fullname ?? "course"}) is due ${fmtUnix(e.timesort)}`,
          })),
      ].sort((a, b) => a.at - b.at);

      const noDate = work.owed
        .filter((o) => !o.duedate)
        .map((o) => `${o.name} (${o.course}) has no due date, ${unsubmittedText(o.state)}`);

      let news: NewsPost[] = [];
      const newsNotes: string[] = [];
      try {
        const read = await readNews(api, work.ids, (id) => work.names.get(Number(id)) ?? `course ${id}`);
        news = read.posts
          .filter((p) => p.modified >= now - TODO_ANNOUNCEMENT_DAYS * DAY)
          .sort((a, b) => b.modified - a.modified)
          .slice(0, TODO_ANNOUNCEMENTS);
        newsNotes.push(...read.leftOut);
      } catch (err) {
        newsNotes.push(`Could not read announcements: ${reasonText(err)}`);
      }

      const sections: string[] = [];
      if (overdue.length) sections.push(`Overdue:\n${bullets(overdue.map((i) => i.text))}`);
      if (soon.length) sections.push(`Due soon:\n${bullets(soon.map((i) => i.text))}`);
      if (noDate.length) sections.push(`No due date:\n${bullets(noDate)}`);
      if (news.length) {
        sections.push(
          `New announcements:\n${bullets(news.map((p) => `${p.subject} (${p.course}, ${fmtUnix(p.modified)})`))}`,
        );
      }

      const notes = [...work.problems];
      if (work.unread) {
        notes.push(`Could not read the submission status of ${work.unread} assignment${work.unread === 1 ? "" : "s"}.`);
      }
      if (calendarProblem) notes.push(calendarProblem);
      notes.push(...newsNotes);

      const body = sections.length ? sections.join("\n\n") : "Nothing to do right now.";
      return notes.length ? `${body}\n\n${bullets(notes)}` : body;
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
      const { owed, problems, unread, ids } = await collectMissingWork(api, course_ids);
      if (!ids.length) return "No current courses found.";

      const now = Math.floor(Date.now() / 1000);
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

      const news = await readNews(api, ids, courseLabel);
      const lines = news.posts.map(
        (p) => `${p.subject} (${fmtUnix(p.modified)})\n  ${stripHtml(p.message, 400).replace(/\n/g, " ")}`,
      );

      // Nothing at all came back, so the first problem is the answer.
      if (!lines.length && news.firstError && (news.coursesRead === 0 || (news.newsForums > 0 && news.forumsRead === 0))) {
        throw news.firstError;
      }

      const body = bullets(lines, "No recent announcements.");
      return news.leftOut.length ? `${body}\n${bullets(news.leftOut)}` : body;
    },
  },
  {
    name: "get_file",
    title: "Course file",
    description:
      "Answers 'what does this course file say?' Downloads one course file resource, such as a PDF, slide deck or handout, from its file_url. Plain text and HTML files come back as readable text. A PDF or another file that is not text comes back with its file name, a link with your key removed and a note to open it in Moodle. Only a link on your school's Moodle site is downloaded, so your key is never sent to another server. Input: file_url, the link from get_course_content. Ask: 'Read the Week 3 slides PDF.'",
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
      const name = fileName({ fileurl: u.toString() });
      const link = fileLink({ fileurl: u.toString() });
      // A PDF header can sit a little way into the file, so look at the start.
      const head = new TextDecoder("latin1").decode(buf.slice(0, 1024));
      if (head.includes("%PDF")) {
        return `File: ${name}\nLink: ${link}\nThis is a PDF, so it cannot be read as text. Open it in Moodle to read it.`;
      }
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (type && !isTextType(type)) {
        return `File: ${name}\nLink: ${link}\nThis file is ${type}, not plain text. Open it in Moodle to read it.`;
      }
      const text = new TextDecoder("utf-8", { fatal: false }).decode(buf).trim();
      if (!text) return "This file is empty.";
      return text.length > 20000 ? text.slice(0, 20000) + "\n[truncated]" : text;
    },
  },
];
