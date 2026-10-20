import { ApiError, createClient, describeMoodleError, type HttpClient } from "./core/http.js";

export interface MoodleApi {
  call<T = any>(fn: string, params?: Record<string, unknown>): Promise<T>;
  userId(): Promise<number>;
}

/** Moodle wants arrays as courseids[0]=1&courseids[1]=2. */
export function flatten(value: unknown, prefix = "", out: Record<string, string> = {}): Record<string, string> {
  if (Array.isArray(value)) {
    value.forEach((v, i) => flatten(v, `${prefix}[${i}]`, out));
  } else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}[${k}]` : k, out);
  } else if (value !== undefined && value !== null) {
    out[prefix] = String(value);
  }
  return out;
}

export function createMoodleApi(baseUrl: string, token: string, fetchImpl?: typeof fetch): MoodleApi {
  const http: HttpClient = createClient({
    baseUrl,
    defaultQuery: { wstoken: token, moodlewsrestformat: "json" },
    fetchImpl,
  });
  let cachedUser: number | undefined;

  const api: MoodleApi = {
    async call<T>(fn: string, params: Record<string, unknown> = {}): Promise<T> {
      const data = await http.get<any>("webservice/rest/server.php", { wsfunction: fn, ...flatten(params) });
      if (data && typeof data === "object" && !Array.isArray(data) && data.exception) {
        const code = String(data.errorcode ?? "");
        const text = describeMoodleError(code) ?? `Moodle said: ${data.message ?? code}`;
        throw new ApiError(text, 200, JSON.stringify(data).slice(0, 300));
      }
      return data as T;
    },
    async userId(): Promise<number> {
      if (cachedUser === undefined) {
        const info = await api.call<{ userid: number }>("core_webservice_get_site_info");
        cachedUser = info.userid;
      }
      return cachedUser;
    },
  };
  return api;
}
