// Site matching; same rules as keyra-app/src/lib/domain.ts.

const MULTI_SUFFIXES = new Set([
  "com.tr", "net.tr", "org.tr", "gov.tr", "edu.tr", "gen.tr", "biz.tr", "info.tr", "web.tr", "av.tr", "bel.tr", "k12.tr", "tsk.tr", "pol.tr",
  "co.uk", "org.uk", "ac.uk", "gov.uk", "me.uk", "com.au", "net.au", "org.au", "co.nz", "co.jp", "ne.jp", "or.jp", "com.br", "com.cn",
  "com.mx", "co.in", "co.za", "com.ar", "co.kr", "com.sg", "com.hk", "com.tw", "co.id", "com.my", "com.ua", "com.pl", "co.il",
  "github.io", "gitlab.io", "herokuapp.com", "vercel.app", "netlify.app", "pages.dev", "workers.dev", "web.app", "firebaseapp.com",
  "blogspot.com", "azurewebsites.net", "cloudfront.net", "onrender.com", "fly.dev",
]);

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

const isLocal = (host) => IPV4.test(host) || host.startsWith("[") || host === "localhost" || !host.includes(".");

/** Host of an http(s) URL, lowercased, without "www." (with port for IPs and localhost); "" otherwise. */
export function siteHost(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "";
    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    return isLocal(host) && u.port ? `${host}:${u.port}` : host;
  } catch {
    return "";
  }
}

export function baseDomain(host) {
  if (!host || isLocal(host.split(":")[0])) return host;
  const parts = host.split(".");
  const n = MULTI_SUFFIXES.has(parts.slice(-2).join(".")) ? 3 : 2;
  return parts.slice(-n).join(".");
}

export function sameSite(a, b) {
  const x = siteHost(a);
  const y = siteHost(b);
  return !!x && !!y && baseDomain(x) === baseDomain(y);
}
