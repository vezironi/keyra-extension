// Client for the Keyra desktop app's local bridge (keyra-app/src-tauri/src/browser.rs).

export const ENDPOINT = "http://127.0.0.1:47390/v1";

export class KeyraError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

async function post(body, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res;
  try {
    res = await fetch(ENDPOINT, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal });
  } catch {
    throw new KeyraError("offline");
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) throw new KeyraError(res.status === 403 ? "forbidden" : "offline");
  const data = await res.json().catch(() => null);
  if (!data) throw new KeyraError("offline");
  if (!data.ok) throw new KeyraError(data.error || "unknown");
  return data.result;
}

export async function getPairing() {
  const { pairing } = await chrome.storage.local.get("pairing");
  return pairing || null;
}

/** Calls the app as the paired client. A revoked pairing is forgotten. */
export async function call(type, params = {}, timeoutMs = 20000) {
  const pairing = await getPairing();
  if (!pairing) throw new KeyraError("not_paired");
  try {
    return await post({ ...params, type, client: pairing.client, token: pairing.token }, timeoutMs);
  } catch (e) {
    if (e.code === "unauthorized") {
      await chrome.storage.local.remove("pairing");
      throw new KeyraError("not_paired");
    }
    throw e;
  }
}

/**
 * Asks the app to pair; resolves once the user approves it there. A `test` pairing is
 * approved without the prompt while Keyra's test account is open, and needs approval otherwise.
 */
export async function pair(name, code, test = false) {
  const { client, token } = await post({ type: "pair", name, code, test }, 130000);
  await chrome.storage.local.set({ pairing: { client, token, name, test, pairedAt: Date.now() } });
}

export async function unpair() {
  await chrome.storage.local.remove("pairing");
}

/** "unpaired" | "offline" | "locked" | "unlocked" */
export async function connectionState() {
  try {
    const s = await call("status", {}, 3000);
    return s.unlocked ? "unlocked" : "locked";
  } catch (e) {
    return e.code === "not_paired" ? "unpaired" : "offline";
  }
}

export function browserName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Firefox\//.test(ua) ? "Firefox" : navigator.brave ? "Brave" : /Vivaldi/.test(ua) ? "Vivaldi" : "Chrome";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} · ${os}` : browser;
}
