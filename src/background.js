// Keyra extension background: talks to the desktop app and routes fills between the popup and pages.
//
// Trust boundary: page content scripts may only get credentials for logins that match
// the tab's site, and only from frames on the same site as the tab. The popup is a
// trusted extension page and may fill any item the user picks.

import { KeyraError, browserName, call, connectionState, getPairing, pair, unpair } from "./lib/keyra.js";
import { getSettings, setSettings } from "./lib/settings.js";
import { generate } from "./lib/generator.js";
import { sameSite, siteHost } from "./lib/domain.js";

const PENDING_TTL = 3 * 60_000;
/** A save prompt is offered on at most this many page loads. */
const PENDING_MAX_SHOWS = 3;
const USERNAME_TTL = 5 * 60_000;
const HISTORY_MAX = 20;

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
const codeOf = (e) => (e instanceof KeyraError ? e.code : "unknown");
const isWeb = (url) => /^https?:/.test(url || "");

// ---------------------------------------------------------------------------
// Session storage helpers (survive service worker restarts, cleared with the browser).

async function sessionGet(key) {
  return (await chrome.storage.session.get(key))[key];
}
const sessionSet = (key, value) => chrome.storage.session.set({ [key]: value });
const sessionRemove = (key) => chrome.storage.session.remove(key);

async function addHistory(password) {
  const history = (await sessionGet("history")) || [];
  await sessionSet("history", [{ password, at: Date.now() }, ...history].slice(0, HISTORY_MAX));
}

// ---------------------------------------------------------------------------
// Frames and filling.

async function frames(tabId, tabUrl, sameSiteOnly) {
  let list = [];
  try {
    list = (await chrome.webNavigation.getAllFrames({ tabId })) || [];
  } catch {
    /* permission or tab gone */
  }
  if (!list.length) return [{ frameId: 0 }];
  return list.filter((f) => !sameSiteOnly || sameSite(f.url, tabUrl));
}

async function broadcast(tabId, frameList, msg) {
  const results = await Promise.all(frameList.map((f) => chrome.tabs.sendMessage(tabId, msg, { frameId: f.frameId }).catch(() => null)));
  return results.filter(Boolean);
}

async function fillLogin(tab, id) {
  const login = await call("login", { id });
  const results = await broadcast(tab.id, await frames(tab.id, tab.url, true), {
    type: "fill-login",
    login: { username: login.username, password: login.password, totp: login.totp?.code || "" },
  });
  return { filled: results.some((r) => r.filled), totp: login.totp, otpFilled: results.some((r) => r.otpFilled) };
}

/** Cards often live in payment-provider iframes, so every frame is asked; each fills only if it has card fields. */
async function fillCard(tab, id) {
  const card = await call("card", { id });
  const results = await broadcast(tab.id, await frames(tab.id, tab.url, false), { type: "fill-card", card });
  return { filled: results.some((r) => r.filled) };
}

async function fillIdentity(tab, id) {
  const identity = await call("identity", { id });
  const results = await broadcast(tab.id, await frames(tab.id, tab.url, true), { type: "fill-identity", identity });
  return { filled: results.some((r) => r.filled) };
}

async function fillPassword(tab, password, frameId) {
  const list = frameId !== undefined ? [{ frameId }] : await frames(tab.id, tab.url, true);
  const results = await broadcast(tab.id, list, { type: "fill-generated", password });
  return { filled: results.some((r) => r.filled) };
}

async function generateNew() {
  const { generator } = await getSettings();
  const password = generate(generator);
  await addHistory(password);
  return password;
}

function toast(tabId, text) {
  chrome.tabs.sendMessage(tabId, { type: "toast", text }, { frameId: 0 }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Saving logins: content scripts report submitted credentials; the top frame shows the prompt.

const recentCaptures = new Map();

async function onCapture(sender, { username = "", password = "", currentPassword = "" }) {
  const tab = sender.tab;
  if (!tab?.id || !isWeb(tab.url) || !password || password.length > 4096 || username.length > 4096) return;
  if (!sameSite(sender.url || tab.url, tab.url)) return;
  const settings = await getSettings();
  const host = siteHost(tab.url);
  if (!settings.savePrompt || !host || settings.never.includes(host)) return;

  // Multi-step logins ask for the username on an earlier page.
  if (!username) {
    const remembered = await sessionGet(`user:${tab.id}`);
    if (remembered && remembered.host === host && Date.now() - remembered.at < USERNAME_TTL) username = remembered.username;
  }

  // A submit is often seen twice (button click and form submit).
  const key = `${tab.id}|${host}|${username}|${password}`;
  if (Date.now() - (recentCaptures.get(key) || 0) < 10_000) return;
  recentCaptures.set(key, Date.now());

  let status;
  try {
    status = await call("check", { url: tab.url, username, password, currentPassword });
  } catch (e) {
    if (codeOf(e) !== "locked") return;
    status = { status: "locked" };
  }
  if (status.status === "exists") return;

  await sessionSet(`pending:${tab.id}`, {
    kind: status.status === "changed" ? "update" : "save",
    locked: status.status === "locked",
    name: status.name || host,
    username,
    password,
    currentPassword,
    host,
    at: Date.now(),
    shows: 0,
  });
  // Single-page apps don't navigate after login; give a failed login a moment to show its error first.
  setTimeout(() => void offerPending(tab.id), 1200);
}

async function takePending(tabId) {
  const p = await sessionGet(`pending:${tabId}`);
  if (!p) return null;
  if (Date.now() - p.at > PENDING_TTL || p.shows >= PENDING_MAX_SHOWS) {
    await sessionRemove(`pending:${tabId}`);
    return null;
  }
  p.shows += 1;
  await sessionSet(`pending:${tabId}`, p);
  // The page never sees the password.
  return { kind: p.kind, locked: p.locked, name: p.name, username: p.username, host: p.host, at: p.at };
}

async function offerPending(tabId) {
  const p = await takePending(tabId);
  if (p) chrome.tabs.sendMessage(tabId, { type: "show-pending", pending: p }, { frameId: 0 }).catch(() => {});
}

async function pendingAction(tabId, action) {
  const p = await sessionGet(`pending:${tabId}`);
  if (!p) return { done: "gone" };
  if (action === "never") {
    const s = await getSettings();
    await setSettings({ never: [...new Set([...s.never, p.host])] });
  }
  if (action !== "save") {
    await sessionRemove(`pending:${tabId}`);
    return { done: action };
  }

  const tab = await chrome.tabs.get(tabId);
  const url = isWeb(tab.url) && siteHost(tab.url) === p.host ? tab.url : `https://${p.host}/`;
  // Checked again: the vault may have been locked when the login was captured.
  const status = await call("check", { url, username: p.username, password: p.password, currentPassword: p.currentPassword });
  let done = "exists";
  if (status.status === "changed") {
    await call("update", { id: status.id, password: p.password, username: p.username });
    done = "updated";
  } else if (status.status === "new") {
    await call("save", { url, username: p.username, password: p.password });
    done = "saved";
  }
  await sessionRemove(`pending:${tabId}`);
  void updateBadge(tabId, tab.url);
  return { done };
}

// ---------------------------------------------------------------------------
// Data for the in-page menu.

const pageCache = new Map();

async function pageInfo(sender) {
  const tab = sender.tab;
  const settings = await getSettings();
  const base = { inlineMenu: settings.inlineMenu, autoCopyTotp: settings.autoCopyTotp };
  if (!tab?.id || !isWeb(tab.url) || !sameSite(sender.url || tab.url, tab.url)) return { ...base, state: "cross-site", logins: [] };

  const cached = pageCache.get(tab.id);
  if (cached && cached.url === tab.url && Date.now() - cached.at < 5000) return { ...base, ...cached.info };
  let info;
  try {
    info = { state: "unlocked", logins: await call("logins", { url: tab.url }, 5000) };
  } catch (e) {
    const code = codeOf(e);
    info = { state: code === "not_paired" ? "unpaired" : code === "locked" ? "locked" : "offline", logins: [] };
  }
  pageCache.set(tab.id, { url: tab.url, at: Date.now(), info });
  return { ...base, ...info };
}

async function fillFromMenu(sender, id) {
  const tab = sender.tab;
  if (!tab?.id || !sameSite(sender.url || tab.url, tab.url)) throw new KeyraError("forbidden");
  const matches = await call("logins", { url: tab.url });
  if (!matches.some((l) => l.id === id)) throw new KeyraError("forbidden");
  const login = await call("login", { id });
  return { username: login.username, password: login.password, totp: login.totp?.code || "" };
}

// ---------------------------------------------------------------------------
// Toolbar badge: number of logins for the current site.

async function updateBadge(tabId, url) {
  let text = "";
  if (isWeb(url) && (await getPairing())) {
    try {
      const list = await call("logins", { url }, 3000);
      text = list.length ? String(list.length) : "";
    } catch {
      /* offline or locked */
    }
  }
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ tabId, color: "#262626" }).catch(() => {});
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId).then((tab) => updateBadge(tabId, tab.url)).catch(() => {});
});
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete") void updateBadge(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener((tabId) => {
  pageCache.delete(tabId);
  void chrome.storage.session.remove([`pending:${tabId}`, `user:${tabId}`]);
});

// ---------------------------------------------------------------------------
// Keyboard shortcuts and context menu.

async function autofillTab(tab) {
  if (!tab?.id || !isWeb(tab.url)) return;
  try {
    const [first] = await call("logins", { url: tab.url });
    if (!first) return toast(tab.id, t("noLoginsForSite"));
    const r = await fillLogin(tab, first.id);
    if (!r.filled) toast(tab.id, t("nothingToFill"));
  } catch (e) {
    const code = codeOf(e);
    if (code === "locked") void call("show").catch(() => {});
    toast(tab.id, t(`err_${code}`) || t("err_unknown"));
  }
}

async function generateInto(tab, frameId) {
  if (!tab?.id) return;
  const password = await generateNew();
  const r = await fillPassword(tab, password, frameId);
  chrome.tabs.sendMessage(tab.id, { type: "copy", text: password, toast: t(r.filled ? "generatedFilled" : "generatedCopied") }, { frameId: frameId ?? 0 }).catch(() => {});
}

chrome.commands.onCommand.addListener(async (command, tab) => {
  tab ??= (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
  if (command === "autofill") void autofillTab(tab);
  if (command === "generate") void generateInto(tab);
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "keyra-autofill", title: t("ctxAutofill"), contexts: ["editable", "page"] });
    chrome.contextMenus.create({ id: "keyra-generate", title: t("ctxGenerate"), contexts: ["editable"] });
  });
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "keyra-autofill") void autofillTab(tab);
  if (info.menuItemId === "keyra-generate") void generateInto(tab, info.frameId);
});

// ---------------------------------------------------------------------------
// Connection test: walks the same path a fill takes and reports each step.
// Results carry counts only, never vault data.

async function selfTest(tab) {
  const steps = [];
  const step = async (key, run) => {
    try {
      steps.push({ key, ok: true, detail: (await run()) ?? "" });
      return true;
    } catch (e) {
      steps.push({ key, ok: false, detail: codeOf(e) });
      return false;
    }
  };

  const pairing = await getPairing();
  const ok =
    (await step("testPaired", async () => {
      if (!pairing) throw new KeyraError("not_paired");
      return pairing.name;
    })) &&
    (await step("testReachable", async () => {
      const s = await call("status", {}, 3000);
      if (!s.unlocked) throw new KeyraError("locked");
      return `Keyra ${s.version}`;
    }));
  if (ok) {
    let items;
    await step("testVault", async () => {
      items = await call("items", {}, 5000);
      return `${items.logins.length} / ${items.cards.length} / ${items.identities.length}`;
    });
    if (isWeb(tab?.url)) await step("testSite", async () => `${siteHost(tab.url)}: ${(await call("logins", { url: tab.url }, 5000)).length}`);
    const withTotp = items?.logins.find((l) => l.hasTotp);
    if (withTotp) await step("testTotp", async () => `${(await call("totp", { id: withTotp.id }, 5000)).remaining}s`);
  }
  await step("testGenerator", async () => {
    const { generator } = await getSettings();
    return `${generate(generator).length}`;
  });
  return steps;
}

// ---------------------------------------------------------------------------
// Messages from the popup and content scripts.

async function fromPopup(msg) {
  const tab = msg.tabId !== undefined ? await chrome.tabs.get(msg.tabId) : null;
  switch (msg.type) {
    case "state": {
      const [state, pairing, pairingCode] = await Promise.all([connectionState(), getPairing(), sessionGet("pairingCode")]);
      return { state, pairing: pairing && { name: pairing.name, pairedAt: pairing.pairedAt, test: !!pairing.test }, pairingCode: pairingCode || null };
    }
    case "pair": {
      const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 100_000_000).padStart(8, "0").replace(/(\d{4})(\d{4})/, "$1-$2");
      await sessionSet("pairingCode", code);
      try {
        await pair(msg.test ? `${browserName()} · Test` : browserName(), code, !!msg.test);
      } finally {
        await sessionRemove("pairingCode");
      }
      return {};
    }
    case "unpair":
      await unpair();
      return {};
    case "selfTest":
      return selfTest(tab);
    case "show":
      return call("show");
    case "open":
      return call("open", { id: msg.id });
    case "tabLogins":
      return isWeb(tab?.url) ? call("logins", { url: tab.url }) : [];
    case "items":
      return call("items");
    case "login":
      return call("login", { id: msg.id });
    case "totp":
      return call("totp", { id: msg.id });
    case "fillLogin":
      return fillLogin(tab, msg.id);
    case "fillCard":
      return fillCard(tab, msg.id);
    case "fillIdentity":
      return fillIdentity(tab, msg.id);
    case "fillPassword":
      return fillPassword(tab, msg.password);
    default:
      throw new KeyraError("bad_request");
  }
}

async function fromContent(msg, sender) {
  switch (msg.type) {
    case "pageInfo":
      return pageInfo(sender);
    case "fillFromMenu":
      return fillFromMenu(sender, msg.id);
    case "generate":
      return { password: await generateNew() };
    case "show":
      return call("show");
    case "capture":
      await onCapture(sender, msg);
      return {};
    case "rememberUsername": {
      const host = siteHost(sender.tab?.url);
      if (host && msg.username && msg.username.length < 512) await sessionSet(`user:${sender.tab.id}`, { username: msg.username, host, at: Date.now() });
      return {};
    }
    case "getPending":
      return sender.frameId === 0 ? takePending(sender.tab.id) : null;
    case "pendingAction":
      return pendingAction(sender.tab.id, msg.action);
    default:
      throw new KeyraError("bad_request");
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id) return false;
  // Extension pages (the popup, also when opened in a tab) are trusted; everything else is a page.
  const extensionPage = (sender.url || "").startsWith(chrome.runtime.getURL(""));
  const handler = extensionPage ? fromPopup(msg) : sender.tab ? fromContent(msg, sender) : Promise.reject(new KeyraError("forbidden"));
  handler.then(
    (result) => sendResponse({ ok: true, result }),
    (e) => sendResponse({ ok: false, error: codeOf(e) }),
  );
  return true;
});
