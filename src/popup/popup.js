import { generate, passwordStrength } from "../lib/generator.js";
import { getSettings, setSettings } from "../lib/settings.js";
import { siteHost } from "../lib/domain.js";

const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

const ICON = {
  logo: '<svg viewBox="196 168 660 660" fill="none"><path d="M388,253.5 A158,158 0 1 1 252.6,396.2" stroke="currentColor" stroke-width="64" stroke-linecap="round"/><path d="M304.8,265.2 L384.2,183.4 L403.7,322 Z" fill="currentColor" stroke="currentColor" stroke-width="18" stroke-linejoin="round"/><path d="M521.7,521.7 L790,790 M661.2,661.2 L734.8,587.7 M747.1,747.1 L800.8,693.3" stroke="currentColor" stroke-width="64" stroke-linecap="round"/></svg>',
  settings: s('<path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"/>'),
  external: s('<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  key: s('<circle cx="7.5" cy="15.5" r="5.5"/><path d="m21 2-9.6 9.6M15.5 7.5l3 3L22 7l-3-3"/>'),
  clock: s('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  fill: s('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  copy: s('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>'),
  refresh: s('<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  search: s('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  lock: s('<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
  plug: s('<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a6 6 0 0 1-12 0V8z"/>'),
  off: s('<path d="M18.36 6.64A9 9 0 1 1 5.64 6.64M12 2v10"/>'),
  card: s('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'),
  id: s('<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M5.5 17a3.5 3.5 0 0 1 7 0M15 10h3M15 14h3"/>'),
  back: s('<path d="m15 18-6-6 6-6"/>'),
  globe: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>'),
  trash: s('<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/>'),
  flask: s('<path d="M9 3h6M10 3v6L4.5 19A1.5 1.5 0 0 0 5.8 21h12.4a1.5 1.5 0 0 0 1.3-2L14 9V3M7 15h10"/>'),
  check: s('<path d="M20 6 9 17l-5-5"/>'),
  x: s('<path d="M18 6 6 18M6 6l12 12"/>'),
};

function s(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

/** Small DOM builder; strings become text nodes, so vault data is never parsed as HTML. */
function h(tag, props = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return e;
}

const $ = (id) => document.getElementById(id);

async function bg(type, params = {}) {
  const res = await chrome.runtime.sendMessage({ type, ...params });
  if (!res?.ok) throw new Error(res?.error || "unknown");
  return res.result;
}

const errText = (e) => t(`err_${e.message}`) || t("err_unknown");

let toastTimer;
function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.classList.add("on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("on"), 1800);
}

async function copy(text, label) {
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    toast(t("copied", label));
  } catch {
    toast(t("err_unknown"));
  }
}

function iconBtn(icon, title, onclick) {
  return h("button", { class: "icon-btn sm", type: "button", title, "aria-label": title, html: ICON[icon], onclick: (e) => (e.stopPropagation(), onclick(e)) });
}

function favicon(url, name) {
  const box = h("span", { class: "fav" });
  const host = siteHost(url);
  const fallback = () => box.replaceChildren((name || host || "?").slice(0, 1).toUpperCase());
  if (host && !host.includes(":")) {
    // Chrome's local favicon cache ("favicon" permission), so vault sites are never sent to a third party.
    // Firefox has no such API; the request fails there and the letter fallback is shown.
    const pageUrl = /^https?:\/\//i.test(url) ? url : `https://${host}/`;
    const src = `${chrome.runtime.getURL("/_favicon/")}?pageUrl=${encodeURIComponent(pageUrl)}&size=32`;
    const img = h("img", { src, alt: "" });
    img.onerror = fallback;
    box.append(img);
  } else fallback();
  return box;
}

// ---------------------------------------------------------------------------
// State

let tab = null;
let state = "loading";
let pairing = null;
let pairingCode = null;
let current = localStorage.getItem("tab") || "site";
let poll = null;

async function refreshState() {
  try {
    const r = await bg("state");
    state = r.state;
    pairing = r.pairing;
    pairingCode = r.pairingCode;
  } catch {
    state = "offline";
  }
  renderHeader();
}

function renderHeader() {
  const status = $("status");
  status.className = `status ${state}`;
  status.textContent = { unlocked: t("stateUnlocked"), locked: t("stateLocked"), offline: t("stateOffline"), unpaired: t("stateUnpaired"), loading: "…" }[state];
  $("btn-open").hidden = state === "unpaired";
  const badge = $("test-badge");
  badge.hidden = !pairing?.test;
  badge.textContent = t("testBadge");
}

function setPolling(on) {
  clearInterval(poll);
  poll = null;
  if (!on) return;
  poll = setInterval(async () => {
    const before = state;
    await refreshState();
    if (state !== before || (state === "unpaired" && !pairingCode)) render();
  }, 1500);
}

// ---------------------------------------------------------------------------
// Rendering

function renderTabs() {
  const tabs = $("tabs");
  tabs.hidden = current === "settings";
  tabs.replaceChildren(
    ...[
      ["site", t("tabSite")],
      ["vault", t("tabVault")],
      ["generator", t("tabGenerator")],
    ].map(([id, label]) =>
      h("button", { class: `tab${current === id ? " active" : ""}`, type: "button", onclick: () => go(id) }, label),
    ),
  );
}

function go(view) {
  current = view;
  if (view !== "settings") localStorage.setItem("tab", view);
  render();
}

async function render() {
  renderTabs();
  const view = $("view");
  setPolling(false);
  if (current === "generator") return renderGenerator(view);
  if (current === "settings") return renderSettings(view);
  if (state !== "unlocked") return renderStatePanel(view);
  if (current === "vault") return renderVault(view);
  return renderSite(view);
}

function renderStatePanel(view) {
  if (state === "unpaired") {
    if (pairingCode) {
      setPolling(true);
      view.replaceChildren(
        h(
          "div",
          { class: "panel" },
          h("div", { class: "big dark", html: ICON.logo }),
          h("h2", {}, t("pairWaitTitle")),
          h("p", {}, t("pairWaitBody")),
          h("div", { class: "code" }, pairingCode),
          h("span", { class: "inline muted" }, h("span", { class: "spin" }), t("pairWaiting")),
        ),
      );
      return;
    }
    const btn = h("button", { class: "btn primary", type: "button", html: ICON.plug }, t("pairButton"));
    const testBtn = h("button", { class: "btn", type: "button", html: ICON.flask }, t("pairTestButton"));
    const error = h("p", { class: "muted", style: "color:var(--danger)" });
    const start = async (test) => {
      btn.disabled = testBtn.disabled = true;
      error.textContent = "";
      const pairingPromise = bg("pair", { test });
      // Show the code as soon as the background has made it.
      setTimeout(async () => {
        await refreshState();
        if (pairingCode) render();
      }, 250);
      try {
        await pairingPromise;
        await refreshState();
        toast(t("pairDone"));
        render();
      } catch (e) {
        await refreshState();
        render();
        const msg = $("view").querySelector(".pair-error");
        if (msg) msg.textContent = errText(e);
      }
    };
    btn.onclick = () => start(false);
    testBtn.onclick = () => start(true);
    error.className = "muted pair-error";
    error.style.color = "var(--danger)";
    view.replaceChildren(
      h(
        "div",
        { class: "panel" },
        h("div", { class: "big dark", html: ICON.logo }),
        h("h2", {}, t("pairTitle")),
        h("p", {}, t("pairBody")),
        h("ol", { class: "steps" }, h("li", {}, t("pairStep1")), h("li", {}, t("pairStep2")), h("li", {}, t("pairStep3"))),
        btn,
        error,
        h("div", { class: "test-box" }, testBtn, h("p", {}, t("pairTestBody"))),
      ),
    );
    return;
  }

  if (state === "locked") {
    setPolling(true);
    view.replaceChildren(
      h(
        "div",
        { class: "panel" },
        h("div", { class: "big", html: ICON.lock }),
        h("h2", {}, t("lockedTitle")),
        h("p", {}, t("lockedBody")),
        h("button", { class: "btn primary", type: "button", html: ICON.external, onclick: () => bg("show").catch(() => {}) }, t("openKeyra")),
      ),
    );
    return;
  }

  setPolling(true);
  view.replaceChildren(
    h(
      "div",
      { class: "panel" },
      h("div", { class: "big", html: ICON.off }),
      h("h2", {}, t("offlineTitle")),
      h("p", {}, t("offlineBody")),
      h("ol", { class: "steps" }, h("li", {}, t("offlineStep1")), h("li", {}, t("offlineStep2"))),
      h("button", { class: "btn", type: "button", html: ICON.refresh, onclick: async () => (await refreshState(), render()) }, t("retry")),
    ),
  );
}

function loadingRow() {
  return h("div", { class: "panel" }, h("span", { class: "spin" }));
}

// ----- Logins

async function fillLogin(login) {
  try {
    const r = await bg("fillLogin", { tabId: tab.id, id: login.id });
    if (!r.filled) return toast(t("nothingToFill"));
    const settings = await getSettings();
    if (r.totp && !r.otpFilled && settings.autoCopyTotp) {
      await navigator.clipboard.writeText(r.totp.code).catch(() => {});
    }
    window.close();
  } catch (e) {
    toast(errText(e));
  }
}

function loginRow(l, { fill = true } = {}) {
  const acts = h(
    "div",
    { class: "acts" },
    l.username ? iconBtn("user", t("copyUsername"), () => copy(l.username, t("username"))) : null,
    iconBtn("key", t("copyPassword"), async () => {
      try {
        const full = await bg("login", { id: l.id });
        copy(full.password, t("password"));
      } catch (e) {
        toast(errText(e));
      }
    }),
    l.hasTotp
      ? iconBtn("clock", t("copyTotp"), async () => {
          try {
            const code = await bg("totp", { id: l.id });
            copy(code.code, t("totp"));
          } catch (e) {
            toast(errText(e));
          }
        })
      : null,
    iconBtn("external", t("openInKeyra"), () => bg("open", { id: l.id }).catch((e) => toast(errText(e)))),
  );
  return h(
    "div",
    { class: "row", title: fill ? t("fillHint") : "", onclick: () => (fill ? fillLogin(l) : copy(l.username, t("username"))) },
    favicon(l.url, l.name),
    h("div", { class: "txt" }, h("div", { class: "t1" }, l.name || siteHost(l.url), l.favorite ? h("span", { class: "star" }, "★") : null), h("div", { class: "t2" }, l.username || t("noUsername"))),
    acts,
  );
}

async function renderSite(view) {
  const host = siteHost(tab?.url || "");
  view.replaceChildren(loadingRow());
  if (!host) {
    view.replaceChildren(h("div", { class: "panel" }, h("div", { class: "big", html: ICON.globe }), h("h2", {}, t("notWebTitle")), h("p", {}, t("notWebBody"))));
    return;
  }
  let logins = [];
  try {
    logins = await bg("tabLogins", { tabId: tab.id });
  } catch (e) {
    view.replaceChildren(h("div", { class: "panel" }, h("p", {}, errText(e))));
    return;
  }
  const head = h("div", { class: "site" }, favicon(tab.url, host), h("div", { class: "txt", style: "min-width:0;flex:1" }, h("div", { class: "site-host" }, host), h("div", { class: "site-sub" }, t("loginsCount", logins.length))));
  if (!logins.length) {
    view.replaceChildren(head, h("div", { class: "panel" }, h("div", { class: "big", html: ICON.key }), h("h2", {}, t("noLoginsTitle")), h("p", {}, t("noLoginsBody"))));
    return;
  }
  view.replaceChildren(head, h("div", { class: "section-title" }, t("sectionLogins")), h("div", { class: "list" }, logins.map((l) => loginRow(l))));
}

// ----- Vault

let vaultKind = "logins";
let vaultQuery = "";

const fold = (str) =>
  String(str || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

async function renderVault(view) {
  view.replaceChildren(loadingRow());
  let items;
  try {
    items = await bg("items");
  } catch (e) {
    view.replaceChildren(h("div", { class: "panel" }, h("p", {}, errText(e))));
    return;
  }
  const input = h("input", { type: "search", placeholder: t("searchPlaceholder"), value: vaultQuery, autofocus: true });
  const list = h("div", { class: "list" });
  const empty = h("p", { class: "muted", style: "text-align:center;padding:16px 0" });
  const chips = h("div", { class: "chips" });

  const draw = () => {
    const q = fold(vaultQuery);
    const match = (...fields) => !q || fields.some((f) => fold(f).includes(q));
    let rows = [];
    if (vaultKind === "logins") rows = items.logins.filter((l) => match(l.name, l.username, l.url)).slice(0, 100).map((l) => loginRow(l));
    if (vaultKind === "cards")
      rows = items.cards
        .filter((c) => match(c.name, c.cardholder, c.brand, c.last4))
        .map((c) =>
          h(
            "div",
            { class: "row", title: t("fillHint"), onclick: () => fillOther("fillCard", c.id) },
            h("span", { class: "fav", html: ICON.card }),
            h("div", { class: "txt" }, h("div", { class: "t1" }, c.name || c.brand || t("card")), h("div", { class: "t2" }, [c.brand, c.last4 && `•••• ${c.last4}`, c.exp].filter(Boolean).join(" · "))),
            h(
              "div",
              { class: "acts" },
              iconBtn("copy", t("copyNumber"), async () => {
                try {
                  copy((await bg("card", { id: c.id })).number, t("cardNumber"));
                } catch (e) {
                  toast(errText(e));
                }
              }),
              iconBtn("fill", t("fill"), () => fillOther("fillCard", c.id)),
            ),
          ),
        );
    if (vaultKind === "identities")
      rows = items.identities
        .filter((i) => match(i.name, i.fullName, i.email))
        .map((i) =>
          h(
            "div",
            { class: "row", title: t("fillHint"), onclick: () => fillOther("fillIdentity", i.id) },
            h("span", { class: "fav", html: ICON.id }),
            h("div", { class: "txt" }, h("div", { class: "t1" }, i.name || i.fullName), h("div", { class: "t2" }, [i.fullName, i.email].filter(Boolean).join(" · "))),
            h("div", { class: "acts" }, i.email ? iconBtn("copy", t("copyEmail"), () => copy(i.email, t("email"))) : null, iconBtn("fill", t("fill"), () => fillOther("fillIdentity", i.id))),
          ),
        );
    list.replaceChildren(...rows);
    list.hidden = !rows.length;
    empty.textContent = rows.length ? "" : t("noResults");
    chips.replaceChildren(
      ...[
        ["logins", t("kindLogins"), items.logins.length],
        ["cards", t("kindCards"), items.cards.length],
        ["identities", t("kindIdentities"), items.identities.length],
      ].map(([k, label, n]) => h("button", { class: `chip${vaultKind === k ? " active" : ""}`, type: "button", onclick: () => ((vaultKind = k), draw()) }, label, h("span", { class: "n" }, n))),
    );
  };
  input.addEventListener("input", () => ((vaultQuery = input.value), draw()));
  view.replaceChildren(h("label", { class: "search", html: ICON.search }, input), chips, list, empty);
  draw();
  input.focus();
}

async function fillOther(type, id) {
  try {
    const r = await bg(type, { tabId: tab.id, id });
    if (!r.filled) return toast(t("nothingToFill"));
    window.close();
  } catch (e) {
    toast(errText(e));
  }
}

// ----- Generator

async function addHistory(password) {
  const { history = [] } = await chrome.storage.session.get("history");
  await chrome.storage.session.set({ history: [{ password, at: Date.now() }, ...history].slice(0, 20) });
}

function colored(pw) {
  const out = h("div", { class: "gen-out" });
  for (const ch of pw) out.append(/\d/.test(ch) ? h("span", { class: "d" }, ch) : /[^a-zA-Z0-9]/.test(ch) ? h("span", { class: "s" }, ch) : ch);
  return out;
}

async function renderGenerator(view) {
  const settings = await getSettings();
  let opts = settings.generator;
  let password = generate(opts);
  let saved = false;

  const out = h("div");
  const meter = h("div", { class: "meter" });
  const optsBox = h("div", { class: "opts" });
  const historyBox = h("div");

  const keep = async () => {
    if (!saved && password) {
      saved = true;
      await addHistory(password);
    }
  };

  const drawOutput = () => {
    out.replaceChildren(colored(password));
    const st = passwordStrength(password);
    meter.replaceChildren(
      h("div", { class: "bars" }, [0, 1, 2, 3].map((i) => h("span", { style: i < Math.max(1, st.score) ? `background:var(--s${st.score})` : "" }))),
      h("span", { class: "label" }, `${t(`strength${st.score}`)} · ${t("bits", st.bits)}`),
    );
  };

  const regenerate = () => {
    password = generate(opts);
    saved = false;
    drawOutput();
  };

  const update = async (patch) => {
    opts = { ...opts, ...patch };
    if (!["upper", "lower", "digits", "symbols"].some((k) => opts[k])) opts.lower = true;
    await setSettings({ generator: opts });
    drawOptions();
    regenerate();
  };

  const toggle = (key, label, desc) =>
    h(
      "div",
      { class: "opt" },
      h("div", {}, h("div", { class: "lbl" }, label), desc ? h("div", { class: "desc" }, desc) : null),
      h("button", { class: "switch", type: "button", role: "switch", "aria-checked": String(!!opts[key]), "aria-label": label, onclick: () => update({ [key]: !opts[key] }) }),
    );

  const drawOptions = () => {
    const isPin = opts.mode === "pin";
    const lenKey = isPin ? "pinLength" : "length";
    const num = h("span", { class: "num" }, opts[lenKey]);
    const range = h("input", { type: "range", min: isPin ? 4 : 8, max: isPin ? 12 : 64, value: opts[lenKey], "aria-label": t("genLength") });
    range.addEventListener("input", () => {
      opts = { ...opts, [lenKey]: Number(range.value) };
      num.textContent = range.value;
      regenerate();
    });
    range.addEventListener("change", () => setSettings({ generator: opts }));
    optsBox.replaceChildren(
      h(
        "div",
        { class: "opt" },
        h("div", { class: "lbl" }, t("genType")),
        h(
          "div",
          { class: "seg" },
          h("button", { type: "button", class: isPin ? "" : "active", onclick: () => update({ mode: "password" }) }, t("genPassword")),
          h("button", { type: "button", class: isPin ? "active" : "", onclick: () => update({ mode: "pin" }) }, t("genPin")),
        ),
      ),
      h("div", { class: "opt" }, h("div", { class: "lbl" }, t("genLength")), range, num),
      ...(isPin
        ? []
        : [toggle("upper", "A–Z"), toggle("lower", "a–z"), toggle("digits", "0–9"), toggle("symbols", "!@#$%^&*"), toggle("avoidAmbiguous", t("genAvoid"), t("genAvoidDesc"))]),
    );
  };

  const drawHistory = async () => {
    const { history = [] } = await chrome.storage.session.get("history");
    if (!history.length) return historyBox.replaceChildren();
    historyBox.replaceChildren(
      h("div", { class: "section-title", style: "margin-bottom:8px" }, h("span", { class: "grow" }, t("genHistory")), iconBtn("trash", t("genHistoryClear"), async () => (await chrome.storage.session.set({ history: [] }), drawHistory()))),
      h(
        "div",
        { class: "list history" },
        history.map((x) =>
          h(
            "div",
            { class: "row" },
            h("div", { class: "txt" }, h("div", { class: "pw" }, x.password), h("div", { class: "t2" }, new Date(x.at).toLocaleTimeString(chrome.i18n.getUILanguage(), { hour: "2-digit", minute: "2-digit" }))),
            h("div", { class: "acts" }, iconBtn("copy", t("copy"), () => copy(x.password, t("password")))),
          ),
        ),
      ),
    );
  };

  const actions = h(
    "div",
    { class: "gen-actions" },
    h("button", { class: "btn", type: "button", html: ICON.refresh, onclick: regenerate }, t("genRegenerate")),
    h(
      "button",
      {
        class: "btn",
        type: "button",
        html: ICON.copy,
        onclick: async () => {
          await copy(password, t("password"));
          await keep();
          drawHistory();
        },
      },
      t("copy"),
    ),
    h(
      "button",
      {
        class: "btn primary",
        type: "button",
        html: ICON.fill,
        disabled: !siteHost(tab?.url || ""),
        onclick: async () => {
          try {
            const r = await bg("fillPassword", { tabId: tab.id, password });
            if (!r.filled) return toast(t("noPasswordField"));
            await navigator.clipboard.writeText(password).catch(() => {});
            await keep();
            window.close();
          } catch (e) {
            toast(errText(e));
          }
        },
      },
      t("fill"),
    ),
  );

  drawOptions();
  drawOutput();
  view.replaceChildren(out, meter, actions, optsBox, historyBox);
  drawHistory();
}

// ----- Settings

async function renderSettings(view) {
  const settings = await getSettings();
  const row = (key, label, desc) =>
    h(
      "div",
      { class: "opt" },
      h("div", {}, h("div", { class: "lbl" }, label), h("div", { class: "desc" }, desc)),
      h("button", {
        class: "switch",
        type: "button",
        role: "switch",
        "aria-label": label,
        "aria-checked": String(settings[key]),
        onclick: async (e) => {
          settings[key] = !settings[key];
          e.currentTarget.setAttribute("aria-checked", String(settings[key]));
          await setSettings({ [key]: settings[key] });
        },
      }),
    );

  const neverBox = h("div");
  const drawNever = () => {
    neverBox.replaceChildren(
      settings.never.length
        ? h(
            "div",
            { class: "list" },
            settings.never.map((host) =>
              h(
                "div",
                { class: "row", style: "cursor:default" },
                favicon(`https://${host}`, host),
                h("div", { class: "txt" }, h("div", { class: "t1" }, host)),
                iconBtn("trash", t("remove"), async () => {
                  settings.never = settings.never.filter((x) => x !== host);
                  await setSettings({ never: settings.never });
                  drawNever();
                }),
              ),
            ),
          )
        : h("p", { class: "muted", style: "margin:0 2px" }, t("neverEmpty")),
    );
  };
  drawNever();

  const connection = pairing
    ? h(
        "div",
        { class: "site" },
        h("span", { class: "fav", html: ICON.plug }),
        h("div", { class: "txt", style: "flex:1;min-width:0" }, h("div", { class: "site-host" }, pairing.name), h("div", { class: "site-sub" }, t("pairedSince", new Date(pairing.pairedAt).toLocaleDateString(chrome.i18n.getUILanguage())))),
        h(
          "button",
          {
            class: "btn danger",
            type: "button",
            onclick: async () => {
              await bg("unpair");
              await refreshState();
              toast(t("unpaired"));
              go("site");
            },
          },
          t("unpair"),
        ),
      )
    : h("p", { class: "muted", style: "margin:0 2px" }, t("stateUnpaired"));

  const testResults = h("div");
  const testBtn = h("button", { class: "btn", type: "button", html: ICON.flask }, t("testRun"));
  testBtn.onclick = async () => {
    testBtn.disabled = true;
    testResults.replaceChildren(h("div", { class: "panel" }, h("span", { class: "spin" })));
    try {
      const steps = await bg("selfTest", { tabId: tab?.id });
      const passed = steps.every((x) => x.ok);
      testResults.replaceChildren(
        h(
          "div",
          { class: "checks" },
          steps.map((x) =>
            h(
              "div",
              { class: `check ${x.ok ? "ok" : "fail"}` },
              h("span", { class: "mark", html: x.ok ? ICON.check : ICON.x }),
              h("span", { class: "lbl" }, t(x.key)),
              h("span", { class: "detail" }, x.ok ? x.detail : t(`err_${x.detail}`) || x.detail),
            ),
          ),
        ),
        h("p", { class: "muted", style: "margin:8px 2px 0" }, t(passed ? "testAllPassed" : "testSomeFailed")),
      );
    } catch (e) {
      testResults.replaceChildren(h("p", { class: "muted", style: "color:var(--danger)" }, errText(e)));
    }
    testBtn.disabled = false;
  };

  const shortcuts = await chrome.commands.getAll().catch(() => []);
  const shortcutRows = shortcuts.map((c) =>
    h("div", { class: "opt" }, h("div", { class: "lbl" }, c.name === "_execute_action" ? t("cmdOpen") : c.description), h("span", { class: "muted", style: "font-weight:700" }, c.shortcut || t("shortcutNotSet"))),
  );
  // Chrome-only page; Firefox manages shortcuts in about:addons, which extensions can't open.
  const editShortcuts = /Firefox\//.test(navigator.userAgent)
    ? null
    : h("button", { class: "btn", type: "button", onclick: () => chrome.tabs.create({ url: "chrome://extensions/shortcuts" }) }, t("shortcutEdit"));

  view.replaceChildren(
    h("div", { class: "back" }, iconBtn("back", t("back"), () => go(localStorage.getItem("tab") || "site")), t("settingsTitle")),
    h("div", { class: "section-title" }, t("sectionConnection")),
    connection,
    h("div", { class: "section-title" }, t("sectionTest")),
    testBtn,
    testResults,
    h("div", { class: "section-title" }, t("sectionAutofill")),
    h("div", { class: "opts" }, row("inlineMenu", t("optInline"), t("optInlineDesc")), row("savePrompt", t("optSave"), t("optSaveDesc")), row("autoCopyTotp", t("optTotp"), t("optTotpDesc"))),
    h("div", { class: "section-title" }, t("sectionNever")),
    neverBox,
    shortcutRows.length ? h("div", { class: "section-title" }, t("sectionShortcuts")) : null,
    shortcutRows.length ? h("div", { class: "opts" }, shortcutRows) : null,
    shortcutRows.length ? editShortcuts : null,
  );
}

// ---------------------------------------------------------------------------

async function init() {
  $("brand-mark").innerHTML = ICON.logo;
  const open = $("btn-open");
  open.innerHTML = ICON.external;
  open.title = t("openKeyra");
  open.onclick = () => bg("show").catch((e) => toast(errText(e)));
  const gear = $("btn-settings");
  gear.innerHTML = ICON.settings;
  gear.title = t("settingsTitle");
  gear.onclick = () => go(current === "settings" ? localStorage.getItem("tab") || "site" : "settings");
  document.documentElement.lang = chrome.i18n.getUILanguage();

  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  renderHeader();
  await refreshState();
  render();
}

init();
