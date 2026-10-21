export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: string,
    /** The setup problem the message names, when it names one. */
    public setup?: SetupProblemKey,
    /** The words the school's server sent, when it sent any. */
    public detail?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Where a student copies the key for the Moodle mobile web service. */
export const SECURITY_KEYS_PATH = "Preferences > User account > Security keys";

export interface SetupProblem {
  /** The opening words of the message the server raises. Also the first cell of its README troubleshooting row. */
  head: string;
  /** What to do about it. Also the second cell of its README troubleshooting row. */
  fix: string;
}

/**
 * The setup problems the server can name, each with the fix that goes with it.
 * The README troubleshooting table lists the same head and fix for each one.
 */
export const SETUP_PROBLEMS = {
  notSignedIn: {
    head: "Not signed in",
    fix: `Your key expired or was reset. Copy the new one from ${SECURITY_KEYS_PATH} and update MOODLE_TOKEN.`,
  },
  accessDenied: {
    head: "Access denied",
    fix: `Your school turned that feature off for students. If you copied the key yourself, make sure it is the Moodle mobile web service one on ${SECURITY_KEYS_PATH}.`,
  },
  webServicesNotEnabled: {
    head: "Web services not enabled",
    fix: `Your school hasn't turned on the mobile web service, so there is no Moodle mobile web service key on ${SECURITY_KEYS_PATH}. Ask your school to turn it on.`,
  },
  notFound: {
    head: "Not found",
    fix: "Check the course ID with get_my_courses.",
  },
  unreadableReply: {
    head: "The school's server sent a reply this server can't read",
    fix: "Check that MOODLE_BASE_URL points at your Moodle site's address.",
  },
} as const satisfies Record<string, SetupProblem>;

export type SetupProblemKey = keyof typeof SETUP_PROBLEMS;

/** The full message the server raises for a setup problem. */
export function setupMessage(key: SetupProblemKey): string {
  const problem = SETUP_PROBLEMS[key];
  return `${problem.head}. ${problem.fix}`;
}

/** The Moodle error codes that come back with HTTP 200 and a message worth showing. */
const MOODLE_ERROR_CODES: Record<string, SetupProblemKey> = {
  invalidtoken: "notSignedIn",
  requireloginerror: "notSignedIn",
  accessexception: "accessDenied",
  webservicesnotenabled: "webServicesNotEnabled",
  servicenotavailable: "webServicesNotEnabled",
  invalidrecord: "notFound",
};

/** The setup problem behind a Moodle error code, or undefined when the code is not one we know. */
export function moodleErrorKey(code: string): SetupProblemKey | undefined {
  return MOODLE_ERROR_CODES[code];
}

/**
 * The setup problems that stop every call, whatever it asks for.
 * A caller that can carry on without one of these should keep going.
 */
const SITE_WIDE_PROBLEMS: SetupProblemKey[] = ["notSignedIn", "webServicesNotEnabled", "unreadableReply"];

/** True when the error will happen on every call, so the caller should stop and report it. */
export function isSiteWideError(err: unknown): boolean {
  return err instanceof ApiError && err.setup !== undefined && SITE_WIDE_PROBLEMS.includes(err.setup);
}

/**
 * The origin of a URL, such as https://moodle.school.edu. It is empty when the
 * URL cannot be read at all.
 */
function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

/**
 * True when a request to the URL would go to the same place as the school's
 * Moodle server. The token may only travel to that place.
 */
export function sameOrigin(url: string, baseUrl: string): boolean {
  const target = originOf(url);
  if (!target || target === "null") return false;
  return target === originOf(baseUrl);
}

export interface ClientOptions {
  baseUrl: string;
  headers?: Record<string, string>;
  /** Query params added to every request (used by APIs that put the token in the URL). */
  defaultQuery?: Record<string, string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export type Query = Record<string, string | number | boolean | undefined | Array<string | number>>;

export interface HttpClient {
  get<T = unknown>(path: string, query?: Query): Promise<T>;
  /** Follows RFC 5988 `Link: rel="next"` pagination and concatenates array pages. */
  getAll<T = unknown>(path: string, query?: Query, maxPages?: number): Promise<T[]>;
}

function buildUrl(base: string, path: string, query: Query = {}, defaults: Record<string, string> = {}): string {
  const url = new URL(path.startsWith("http") ? path : base.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, ""));
  for (const [k, v] of Object.entries(defaults)) url.searchParams.set(k, v);
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) {
      for (const item of v) url.searchParams.append(k, String(item));
    } else {
      url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

function nextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(",")) {
    const m = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

/** Moodle sometimes answers with an HTML error page instead of JSON. */
function bodySetupKey(text: string): SetupProblemKey {
  const lower = text.toLowerCase();
  if (lower.includes("web services are not enabled") || lower.includes("webservicesnotenabled")) {
    return "webServicesNotEnabled";
  }
  if (lower.includes("invalid token") || lower.includes("invalidtoken")) {
    return "notSignedIn";
  }
  return "unreadableReply";
}

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text().catch(() => "");
  if (!text.trim()) {
    throw new ApiError("The school's server sent an empty reply. Try again shortly.", res.status);
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    const key = bodySetupKey(text);
    throw new ApiError(setupMessage(key), res.status, text.slice(0, 500), key);
  }
}

export function createClient(opts: ClientOptions): HttpClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const timeout = opts.timeoutMs ?? 20000;

  async function request(url: string): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await doFetch(url, {
        headers: { Accept: "application/json", ...(opts.headers ?? {}) },
        signal: ctrl.signal,
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ApiError(describeStatus(res.status), res.status, body.slice(0, 500), statusSetupKey(res.status));
      }
      return res;
    } catch (err) {
      if (err instanceof ApiError) throw err;
      if ((err as Error).name === "AbortError") {
        throw new ApiError(`Request timed out after ${timeout / 1000}s`, 0);
      }
      throw new ApiError(`Network error: ${(err as Error).message}`, 0);
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    async get<T>(path: string, query?: Query): Promise<T> {
      const res = await request(buildUrl(opts.baseUrl, path, query, opts.defaultQuery));
      return readJson<T>(res);
    },
    async getAll<T>(path: string, query?: Query, maxPages = 10): Promise<T[]> {
      const out: T[] = [];
      let url: string | null = buildUrl(opts.baseUrl, path, query, opts.defaultQuery);
      for (let page = 0; url && page < maxPages; page++) {
        const res: Response = await request(url);
        const data = await readJson<T | T[]>(res);
        if (Array.isArray(data)) out.push(...data);
        else out.push(data);
        url = nextLink(res.headers.get("link"));
      }
      return out;
    },
  };
}

/** The setup problem behind an HTTP status, when there is one. */
export function statusSetupKey(status: number): SetupProblemKey | undefined {
  switch (status) {
    case 401:
      return "notSignedIn";
    case 403:
      return "accessDenied";
    case 404:
      return "notFound";
    default:
      return undefined;
  }
}

export function describeStatus(status: number): string {
  const key = statusSetupKey(status);
  if (key) return setupMessage(key);
  switch (status) {
    case 429:
      return "Rate limited by the school's server. Wait a minute and try again.";
    default:
      return status >= 500 ? `The school's server had a problem (HTTP ${status}). Try again shortly.` : `Request failed (HTTP ${status}).`;
  }
}
