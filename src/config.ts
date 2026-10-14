export function normalizeBaseUrl(raw: string): string {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = "https://" + url;
  return url
    .replace(/\/webservice\/rest\/server\.php.*$/i, "")
    .replace(/\/+$/, "");
}
