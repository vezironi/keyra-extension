// Keyra content script: finds login fields, shows the in-field menu, fills
// credentials, notices sign-ins to offer saving them, and shows the save bar.
// All UI lives in a closed shadow root so the page can't style or read it.

(() => {
  if (window.__keyraContent) return;
  window.__keyraContent = true;

  const isTop = window === window.top;
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

  function send(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (res) => {
          if (chrome.runtime.lastError || !res) resolve({ ok: false, error: "offline" });
          else resolve(res);
        });
      } catch {
        // The extension was reloaded; this page's script is orphaned.
        resolve({ ok: false, error: "offline" });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Field detection

  const TEXT_TYPES = new Set(["text", "email", "tel"]);
  const USER_HINT = /user|login|e-?mail|account|acct|kullan|eposta|uye|üye|tckn|kimlik|phone|telefon|gsm|customer|musteri|müşteri|member|nick|identifier|signin/i;
  const NOT_USER = /search|arama|query|captcha|coupon|kupon|promo|otp|totp|2fa|code|kod|verif|doğrula|dogrula|zip|postal|city|şehir|address|adres|first.?name|last.?name|surname|soyad|card|kart|cvv|cvc|amount|tutar|quantity|adet|comment|yorum|message|mesaj/i;
  const OTP_HINT = /one.?time|otp|totp|2fa|mfa|two.?factor|verification.?code|verify.?code|auth.?code|security.?code|doğrulama|dogrulama|tek.?kullan|sms.?code|onay.?kodu/i;
  const NEW_HINT = /new|confirm|repeat|again|retype|verify|yeni|tekrar|onay|register|signup|sign-up|kayit|kayıt|create/i;
  const CURRENT_HINT = /current|old|mevcut|eski|existing/i;
  const SIGNUP_FORM = /register|signup|sign-up|kayit|kayıt|uye-?ol|join|create/i;
  const SUBMIT_TEXT = /log\s?in|sign\s?in|giriş|giris|oturum|continue|devam|next|ileri|submit|gönder|gonder|sign\s?up|register|kaydol|üye ol|save|kaydet|update|güncelle|change|değiştir|degistir|onayla|confirm/i;

  const autocomplete = (el) => (el.getAttribute("autocomplete") || "").toLowerCase();

  function labelText(el) {
    try {
      return [...(el.labels || [])].map((l) => l.textContent).join(" ").slice(0, 120);
    } catch {
      return "";
    }
  }

  /** Everything that describes a field (getAttribute avoids DOM clobbering by named children). */
  const attrs = (el) =>
    ["name", "id", "placeholder", "aria-label", "autocomplete", "data-testid", "title"].map((a) => el.getAttribute(a) || "").join(" ") + " " + labelText(el);

  function visible(el) {
    if (!el.isConnected) return false;
    const r = el.getBoundingClientRect();
    if (r.width < 16 || r.height < 8) return false;
    const s = getComputedStyle(el);
    return s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
  }

  const editable = (el) => !el.disabled && !el.readOnly;

  /** Inputs and selects, including those inside open shadow roots. */
  function allFields(root = document, selector = "input") {
    const out = [...root.querySelectorAll(selector)];
    for (const host of root.querySelectorAll("*")) if (host.shadowRoot) out.push(...allFields(host.shadowRoot, selector));
    return out;
  }

  const formOf = (el) => el.form || el.closest?.("form") || null;

  /** The element actually focused, looking inside shadow roots. */
  function deepActive() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  // A "show password" toggle switches type=password to text; keep treating it as a password.
  const seenPassword = new WeakSet();
  function isPassword(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    if (el.type === "password") {
      seenPassword.add(el);
      return true;
    }
    return el.type === "text" && seenPassword.has(el);
  }

  const passwords = (scope = document) => allFields(scope).filter((el) => isPassword(el) && visible(el) && editable(el));

  function isUserish(el) {
    if (!(el instanceof HTMLInputElement) || !TEXT_TYPES.has(el.type) || isPassword(el) || !editable(el)) return false;
    const ac = autocomplete(el);
    if (/\b(username|email)\b/.test(ac)) return true;
    if (/one-time-code|cc-|address|postal|given-name|family-name|organization|search/.test(ac)) return false;
    return !NOT_USER.test(attrs(el));
  }

  const strongUserHint = (el) => /\b(username|email)\b/.test(autocomplete(el)) || el.type === "email" || USER_HINT.test(attrs(el));

  /** The username field that belongs to a password field: the closest suitable input before it. */
  function usernameFor(pw, visibleOnly = true) {
    const form = formOf(pw);
    const scope = form || pw.getRootNode() || document;
    const before = allFields(scope).filter((el) => el !== pw && isUserish(el) && (!visibleOnly || visible(el)) && el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!before.length) return null;
    const explicit = before.find((el) => /\b(username|email)\b/.test(autocomplete(el)));
    if (explicit) return explicit;
    for (let i = before.length - 1; i >= 0; i--) if (strongUserHint(before[i])) return before[i];
    return form ? before[before.length - 1] : null;
  }

  function isNewPassword(pw) {
    const ac = autocomplete(pw);
    if (ac.includes("new-password")) return true;
    if (ac.includes("current-password")) return false;
    const a = attrs(pw);
    if (CURRENT_HINT.test(a)) return false;
    if (NEW_HINT.test(a)) return true;
    const form = formOf(pw);
    if (form && SIGNUP_FORM.test(["id", "name", "action", "class"].map((x) => form.getAttribute(x) || "").join(" "))) return true;
    return passwords(form || document).length >= 2;
  }

  function otpField() {
    return allFields().find(
      (el) =>
        visible(el) &&
        editable(el) &&
        !isPassword(el) &&
        ["text", "tel", "number"].includes(el.type) &&
        (autocomplete(el) === "one-time-code" || OTP_HINT.test(attrs(el))) &&
        !/cc-csc|cvv|cvc/i.test(attrs(el)),
    );
  }

  /** "password" | "new-password" | "username" | null */
  function fieldKind(el) {
    if (!(el instanceof HTMLInputElement) || !visible(el) || !editable(el)) return null;
    if (isPassword(el)) return isNewPassword(el) ? "new-password" : "password";
    if (!isUserish(el)) return null;
    const pws = passwords(formOf(el) || document);
    if (pws.some((pw) => el.compareDocumentPosition(pw) & Node.DOCUMENT_POSITION_FOLLOWING && usernameFor(pw) === el)) return "username";
    // Username-first sign-in step.
    if (!passwords().length && strongUserHint(el)) return "username";
    return null;
  }

  // -------------------------------------------------------------------------
  // Filling

  let filling = false;
  const inputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  const selectValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value").set;

  function setValue(el, value) {
    el.focus({ preventScroll: true });
    (el instanceof HTMLSelectElement ? selectValue : inputValue).call(el, value);
    el.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertReplacementText", data: value }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, composed: true }));
    flash(el);
  }

  function setSelect(sel, candidates) {
    const norm = (s) => String(s).trim().toLowerCase();
    const wanted = candidates.filter(Boolean).map(norm);
    const opt = [...sel.options].find((o) => wanted.includes(norm(o.value)) || wanted.includes(norm(o.text)));
    if (!opt) return false;
    setValue(sel, opt.value);
    return true;
  }

  function withFilling(fn) {
    filling = true;
    try {
      return fn();
    } finally {
      setTimeout(() => (filling = false), 50);
    }
  }

  function fillLogin({ username, password, totp }, prefer = deepActive()) {
    return withFilling(() => {
      const all = passwords();
      let pw = prefer && isPassword(prefer) && visible(prefer) ? prefer : all.find((p) => !isNewPassword(p)) || all[0] || null;
      let user = pw ? usernameFor(pw) : null;
      if (!user && prefer && isUserish(prefer) && visible(prefer)) user = prefer;
      if (!user && !pw) user = allFields().find((el) => fieldKind(el) === "username") || null;

      let filled = false;
      let otpFilled = false;
      if (user && username) {
        setValue(user, username);
        filled = true;
      }
      if (pw && password) {
        setValue(pw, password);
        filled = true;
      }
      // Second-step pages ask only for the code.
      if (totp && !pw) {
        const otp = otpField();
        if (otp) {
          setValue(otp, totp);
          filled = otpFilled = true;
        }
      }
      return { filled, otpFilled };
    });
  }

  function fillGenerated(password) {
    return withFilling(() => {
      const focused = deepActive();
      const all = passwords();
      const fresh = all.filter(isNewPassword);
      let targets;
      if (focused && isPassword(focused)) {
        // The focused field and its confirmation in the same form.
        targets = [focused, ...fresh.filter((p) => p !== focused && formOf(p) === formOf(focused))];
      } else {
        targets = fresh.length ? fresh : all.length === 1 ? all : [];
      }
      targets.forEach((el) => setValue(el, password));
      return targets.length > 0;
    });
  }

  function classify(el, spec) {
    const ac = autocomplete(el).split(/\s+/);
    for (const [key, s] of spec) if (s.ac.some((a) => ac.includes(a))) return key;
    const a = attrs(el);
    for (const [key, s] of spec) if (s.re.test(a)) return key;
    return null;
  }

  function fieldsBy(spec) {
    const found = {};
    for (const el of allFields(document, "input, select")) {
      if (!visible(el) || !editable(el) || isPassword(el) || ["hidden", "submit", "button", "checkbox", "radio", "file", "image"].includes(el.type)) continue;
      const key = classify(el, spec);
      if (key && !found[key]) found[key] = el;
    }
    return found;
  }

  // Order matters: earlier entries win when several patterns match.
  const CARD_SPEC = [
    ["number", { ac: ["cc-number"], re: /card.?num|cc.?num|cardnumber|card.?no|kart.?n(o|umara)|credit.?card|\bpan\b/i }],
    ["cvv", { ac: ["cc-csc"], re: /cvv|cvc|csc|cvn|security.?code|güvenlik.?kod|guvenlik.?kod|card.?code/i }],
    ["month", { ac: ["cc-exp-month"], re: /exp.*month|month|\bmm\b|exp_?m\b|\bay\b/i }],
    ["year", { ac: ["cc-exp-year"], re: /exp.*year|year|\byy(yy)?\b|exp_?y\b|y[ıi]l/i }],
    ["exp", { ac: ["cc-exp"], re: /exp(iry|iration)?.?date|mm.?\/?.?yy|son.?kullan|valid.?thru|expir/i }],
    ["name", { ac: ["cc-name"], re: /card.?holder|holder|name.?on.?card|cc.?name|kart.?(üzerindeki|sahibi)|ad.?soyad|isim/i }],
  ];

  function fillCard(card) {
    const f = fieldsBy(CARD_SPEC);
    if (!f.number) return false;
    return withFilling(() => {
      const mm = String(card.expMonth || "").padStart(2, "0");
      const yyyy = String(card.expYear || "").length === 2 ? `20${card.expYear}` : String(card.expYear || "");
      const yy = yyyy.slice(-2);
      setValue(f.number, card.number);
      if (f.name && card.cardholder) setValue(f.name, card.cardholder);
      if (f.cvv && card.cvv) setValue(f.cvv, card.cvv);
      if (card.expMonth) {
        if (f.month) f.month instanceof HTMLSelectElement ? setSelect(f.month, [mm, String(Number(mm))]) : setValue(f.month, mm);
        if (f.year) f.year instanceof HTMLSelectElement ? setSelect(f.year, [yyyy, yy]) : setValue(f.year, f.year.maxLength === 2 ? yy : yyyy);
        if (f.exp && !f.month) {
          const long = f.exp.maxLength >= 7 || /yyyy/i.test(f.exp.getAttribute("placeholder") || "");
          setValue(f.exp, `${mm}/${long ? yyyy : yy}`);
        }
      }
      return true;
    });
  }

  const IDENTITY_SPEC = [
    ["email", { ac: ["email"], re: /e-?mail|eposta|e-posta/i }],
    ["phone", { ac: ["tel", "tel-national"], re: /phone|telefon|\btel\b|gsm|mobile|cep/i }],
    ["nationalId", { ac: [], re: /tc.?kimlik|tckn|national.?id|identity.?n(o|umber)|kimlik.?n(o|umara)/i }],
    ["birthDate", { ac: ["bday"], re: /birth|doğum|dogum|\bdob\b/i }],
    ["fullName", { ac: ["name"], re: /full.?name|ad.?soyad|your.?name|^\s*name\b/i }],
    ["lastName", { ac: ["family-name"], re: /last.?name|surname|family.?name|lname|soyad/i }],
    ["firstName", { ac: ["given-name"], re: /first.?name|given.?name|fname|\bad[ıi]?\b|\bisim\b/i }],
    ["company", { ac: ["organization"], re: /company|organi[sz]ation|firma|şirket|sirket/i }],
    ["postalCode", { ac: ["postal-code"], re: /zip|postal|posta.?kod/i }],
    ["city", { ac: ["address-level2"], re: /\bcity\b|town|şehir|sehir|\bil\b/i }],
    ["country", { ac: ["country", "country-name"], re: /country|ülke|ulke/i }],
    ["address", { ac: ["street-address", "address-line1"], re: /address|street|adres|sokak|cadde/i }],
  ];

  function fillIdentity(id) {
    const f = fieldsBy(IDENTITY_SPEC);
    const values = { ...id, fullName: [id.firstName, id.lastName].filter(Boolean).join(" ") };
    const keys = Object.keys(f).filter((k) => values[k]);
    if (keys.length < 2 && !(keys.length === 1 && keys[0] === "email")) return false;
    return withFilling(() => {
      for (const k of keys) {
        const el = f[k];
        if (el instanceof HTMLSelectElement) setSelect(el, [values[k]]);
        else setValue(el, values[k]);
      }
      return true;
    });
  }

  // -------------------------------------------------------------------------
  // UI (closed shadow root)

  const LOGO =
    '<svg viewBox="196 168 660 660" fill="none" aria-hidden="true"><path d="M388,253.5 A158,158 0 1 1 252.6,396.2" stroke="currentColor" stroke-width="64" stroke-linecap="round"/><path d="M304.8,265.2 L384.2,183.4 L403.7,322 Z" fill="currentColor" stroke="currentColor" stroke-width="18" stroke-linejoin="round"/><path d="M521.7,521.7 L790,790 M661.2,661.2 L734.8,587.7 M747.1,747.1 L800.8,693.3" stroke="currentColor" stroke-width="64" stroke-linecap="round"/></svg>';
  const ICONS = {
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>',
    wand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 4-11 11 5 5 11-11z"/><path d="M15 4l5 5"/><path d="M20 2v4M22 4h-4M5 3v2M6 4H4"/></svg>',
    lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
    info: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12 5 5 9-10"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  };

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; font-family: "Manrope", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
    .layer { --bg:#fff; --fg:#171717; --fg2:#525252; --fg3:#737373; --line:#e5e5e5; --hover:#f5f5f5; --primary:#171717; --primary-fg:#fafafa; --ok:#059669; --shadow:0 12px 32px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.08); }
    @media (prefers-color-scheme: dark) {
      .layer { --bg:#141414; --fg:#fafafa; --fg2:#d4d4d4; --fg3:#a3a3a3; --line:#262626; --hover:#1f1f1f; --primary:#fafafa; --primary-fg:#171717; --ok:#34d399; --shadow:0 12px 32px rgba(0,0,0,.5); }
    }
    svg { display:block; width:100%; height:100%; }
    .icon { position:fixed; z-index:2147483647; width:22px; height:22px; padding:4px; border:0; border-radius:6px; background:var(--primary); color:var(--primary-fg); cursor:pointer; opacity:.9; display:none; }
    .icon:hover { opacity:1; }
    .menu { position:fixed; z-index:2147483647; display:none; flex-direction:column; padding:4px; background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:10px; box-shadow:var(--shadow); max-height:280px; overflow-y:auto; }
    .head { display:flex; align-items:center; gap:6px; padding:6px 8px 4px; font-size:11px; font-weight:700; color:var(--fg3); letter-spacing:.02em; }
    .head .logo { width:13px; height:13px; color:var(--fg2); }
    .item { display:flex; align-items:center; gap:10px; width:100%; padding:7px 8px; border:0; border-radius:7px; background:none; color:inherit; text-align:left; cursor:pointer; }
    .item.passive { cursor:default; }
    .item.active, .item:not(.passive):hover { background:var(--hover); }
    .item .ic { flex:none; width:26px; height:26px; padding:5px; border-radius:7px; background:var(--hover); color:var(--fg2); }
    .item.active .ic, .item:not(.passive):hover .ic { background:var(--line); }
    .item .txt { min-width:0; display:flex; flex-direction:column; }
    .item .t1 { font-size:13px; font-weight:600; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .item .t2 { font-size:11.5px; font-weight:500; color:var(--fg3); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    .flash { position:fixed; z-index:2147483646; pointer-events:none; border-radius:6px; box-shadow:0 0 0 2px #10b981; opacity:1; transition:opacity .6s ease .3s; }
    .toast { position:fixed; z-index:2147483647; right:16px; bottom:16px; display:flex; align-items:center; gap:8px; padding:9px 14px; border-radius:9px; background:var(--primary); color:var(--primary-fg); font-size:13px; font-weight:600; box-shadow:var(--shadow); opacity:0; transform:translateY(6px); transition:opacity .2s, transform .2s; pointer-events:none; }
    .toast.on { opacity:1; transform:none; }
    .toast .logo { width:14px; height:14px; }
    .bar { position:fixed; z-index:2147483647; top:14px; right:14px; width:min(370px, calc(100vw - 28px)); background:var(--bg); color:var(--fg); border:1px solid var(--line); border-radius:12px; box-shadow:var(--shadow); padding:14px; display:flex; flex-direction:column; gap:12px; animation:in .18s ease-out; }
    @keyframes in { from { opacity:0; transform:translateY(-6px); } }
    .bar .top { display:flex; gap:11px; align-items:flex-start; }
    .bar .mark { flex:none; width:32px; height:32px; padding:7px; border-radius:8px; background:var(--primary); color:var(--primary-fg); }
    .bar .txt { flex:1; min-width:0; }
    .bar .t1 { font-size:13.5px; font-weight:700; }
    .bar .t2 { font-size:12px; font-weight:500; color:var(--fg3); margin-top:2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
    .bar .note { font-size:12px; font-weight:500; color:var(--fg2); margin-top:6px; }
    .bar .x { flex:none; width:24px; height:24px; padding:5px; border:0; border-radius:6px; background:none; color:var(--fg3); cursor:pointer; }
    .bar .x:hover { background:var(--hover); color:var(--fg); }
    .bar .btns { display:flex; gap:6px; justify-content:flex-end; }
    .btn { height:30px; padding:0 12px; border-radius:7px; border:1px solid var(--line); background:var(--bg); color:var(--fg); font-size:12.5px; font-weight:600; cursor:pointer; }
    .btn:hover { background:var(--hover); }
    .btn.primary { background:var(--primary); border-color:var(--primary); color:var(--primary-fg); }
    .btn.primary:hover { opacity:.88; }
    .btn.ghost { border-color:transparent; color:var(--fg3); margin-right:auto; }
    .btn:disabled { opacity:.5; cursor:default; }
    .done { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:700; color:var(--ok); }
    .done .ok { width:18px; height:18px; }
  `;

  let ui = null;

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html) e.innerHTML = html; // only our own static markup; page data always goes through textContent
    return e;
  }

  function getUi() {
    if (ui && ui.host.isConnected) return ui;
    const host = document.createElement("keyra-ui");
    host.style.cssText = "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = CSS;
    const layer = el("div", "layer");
    root.append(style, layer);
    document.documentElement.appendChild(host);

    const icon = el("button", "icon", LOGO);
    icon.type = "button";
    icon.title = "Keyra";
    const menu = el("div", "menu");
    layer.append(icon, menu);
    // Keep focus in the page field while the user clicks our UI.
    for (const node of [icon, menu]) node.addEventListener("mousedown", (e) => e.preventDefault());
    icon.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));
    ui = { host, root, layer, icon, menu };
    return ui;
  }

  function flash(target) {
    const r = target.getBoundingClientRect();
    if (!r.width) return;
    const f = el("div", "flash");
    Object.assign(f.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    getUi().layer.append(f);
    requestAnimationFrame(() => (f.style.opacity = "0"));
    setTimeout(() => f.remove(), 1000);
  }

  let toastTimer;
  function toast(text) {
    const { layer } = getUi();
    layer.querySelector(".toast")?.remove();
    const box = el("div", "toast", `<span class="logo">${LOGO}</span>`);
    box.append(document.createTextNode(text));
    layer.append(box);
    requestAnimationFrame(() => box.classList.add("on"));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      box.classList.remove("on");
      setTimeout(() => box.remove(), 250);
    }, 2600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for pages without focus / user activation.
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;opacity:0;top:0;left:0;";
      getUi().layer.append(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand("copy");
      } catch {
        /* not allowed */
      }
      ta.remove();
      return ok;
    }
  }

  // -------------------------------------------------------------------------
  // In-field menu

  let field = null;
  let kind = null;
  let info = null;
  let entries = [];
  let menuOpen = false;
  let activeIndex = -1;

  function place() {
    if (!field || !ui) return;
    const r = field.getBoundingClientRect();
    if (!r.width || r.bottom < 0 || r.top > innerHeight) {
      ui.icon.style.display = "none";
      ui.menu.style.display = "none";
      return;
    }
    if (r.width >= 90) {
      Object.assign(ui.icon.style, { display: "block", left: `${r.right - 28}px`, top: `${r.top + (r.height - 22) / 2}px` });
    } else ui.icon.style.display = "none";

    if (menuOpen) {
      const width = Math.min(Math.max(r.width, 260), 340);
      const left = Math.max(8, Math.min(r.left, innerWidth - width - 8));
      ui.menu.style.display = "flex";
      ui.menu.style.width = `${width}px`;
      ui.menu.style.left = `${left}px`;
      const h = ui.menu.offsetHeight;
      const below = r.bottom + 6 + h <= innerHeight || r.top - 6 - h < 0;
      ui.menu.style.top = `${below ? r.bottom + 6 : r.top - 6 - h}px`;
    } else ui.menu.style.display = "none";
  }

  let placeQueued = false;
  function queuePlace() {
    if (placeQueued) return;
    placeQueued = true;
    requestAnimationFrame(() => {
      placeQueued = false;
      place();
    });
  }

  function buildEntries() {
    const list = [];
    if (kind === "new-password") list.push({ type: "generate", icon: "wand", t1: t("menuGenerate"), t2: t("menuGenerateSub") });
    const state = info?.state;
    if (state === "unlocked") {
      for (const l of info.logins) list.push({ type: "login", id: l.id, icon: "user", t1: l.name, t2: l.username || t("noUsername") });
      if (!info.logins.length && kind !== "new-password") list.push({ type: "info", icon: "info", t1: t("menuNoLogins"), t2: t("menuNoLoginsSub") });
    } else if (state === "locked") list.push({ type: "show", icon: "lock", t1: t("menuLocked"), t2: t("menuLockedSub") });
    else if (state === "offline") list.push({ type: "info", icon: "info", t1: t("menuOffline"), t2: t("menuOfflineSub") });
    else if (state === "unpaired") list.push({ type: "info", icon: "info", t1: t("menuUnpaired"), t2: t("menuUnpairedSub") });
    return list;
  }

  function renderMenu() {
    const { menu } = getUi();
    menu.replaceChildren();
    const head = el("div", "head", `<span class="logo">${LOGO}</span>`);
    head.append(document.createTextNode("Keyra"));
    menu.append(head);
    entries.forEach((entry, i) => {
      const passive = entry.type === "info";
      const b = el("button", `item${passive ? " passive" : ""}${i === activeIndex ? " active" : ""}`);
      b.type = "button";
      const ic = el("span", "ic", ICONS[entry.icon]);
      const txt = el("span", "txt");
      const t1 = el("span", "t1");
      t1.textContent = entry.t1;
      const t2 = el("span", "t2");
      t2.textContent = entry.t2 || "";
      txt.append(t1, t2);
      b.append(ic, txt);
      if (!passive) b.addEventListener("click", () => choose(entry));
      menu.append(b);
    });
  }

  function openMenu() {
    if (!field || !entries.length) return;
    menuOpen = true;
    activeIndex = entries.findIndex((e) => e.type !== "info");
    renderMenu();
    place();
  }

  function closeMenu() {
    menuOpen = false;
    activeIndex = -1;
    if (ui) ui.menu.style.display = "none";
  }

  function detach() {
    closeMenu();
    field = null;
    kind = null;
    if (ui) ui.icon.style.display = "none";
  }

  async function attach(target, k) {
    field = target;
    kind = k;
    const res = await send({ type: "pageInfo" });
    if (field !== target) return; // focus moved on meanwhile
    info = res.ok ? res.result : { state: "offline", logins: [], inlineMenu: true };
    if (!info.inlineMenu || (info.state === "cross-site" && kind !== "new-password")) return detach();
    entries = buildEntries();
    getUi();
    place();
    const useful = entries.some((e) => e.type === "login" || e.type === "generate" || e.type === "show");
    if (useful && !target.value) openMenu();
  }

  async function choose(entry) {
    const target = field;
    closeMenu();
    if (entry.type === "show") {
      send({ type: "show" });
      return;
    }
    if (entry.type === "generate") {
      const res = await send({ type: "generate" });
      if (!res.ok) return;
      target?.focus();
      fillGenerated(res.result.password);
      const copied = await copyText(res.result.password);
      toast(t(copied ? "generatedFilled" : "generatedFilledNoCopy"));
      return;
    }
    if (entry.type === "login") {
      const res = await send({ type: "fillFromMenu", id: entry.id });
      if (!res.ok) {
        toast(t(`err_${res.error}`) || t("err_unknown"));
        return;
      }
      const r = fillLogin(res.result, target);
      if (res.result.totp && !r.otpFilled && info?.autoCopyTotp && (await copyText(res.result.totp))) toast(t("totpCopied"));
    }
  }

  function onFocusIn(e) {
    if (filling) return;
    const target = e.composedPath()[0];
    if (ui && e.composedPath().includes(ui.host)) return;
    if (target === field) return;
    const k = fieldKind(target);
    if (k) void attach(target, k);
    else detach();
  }

  function onFocusOut() {
    setTimeout(() => {
      if (field && deepActive() !== field) detach();
    }, 150);
  }

  function onKeyDown(e) {
    const target = e.composedPath()[0];
    if (target === field && field) {
      if (e.key === "ArrowDown" && !menuOpen && entries.length) {
        e.preventDefault();
        openMenu();
        return;
      }
      if (menuOpen) {
        const selectable = entries.map((x, i) => (x.type === "info" ? -1 : i)).filter((i) => i >= 0);
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          if (!selectable.length) return;
          const pos = selectable.indexOf(activeIndex);
          const next = e.key === "ArrowDown" ? (pos + 1) % selectable.length : (pos - 1 + selectable.length) % selectable.length;
          activeIndex = selectable[next];
          renderMenu();
          return;
        }
        if (e.key === "Enter" && activeIndex >= 0) {
          e.preventDefault();
          e.stopPropagation();
          void choose(entries[activeIndex]);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          closeMenu();
          return;
        }
      }
      if (e.key.length === 1) closeMenu(); // typing by hand
    }
    if (e.key === "Enter" && target instanceof HTMLInputElement && (isPassword(target) || isUserish(target))) captureFrom(target);
  }

  // -------------------------------------------------------------------------
  // Capturing sign-ins

  function captureFrom(origin) {
    const form = origin instanceof HTMLFormElement ? origin : formOf(origin);
    const scope = form || document;
    const pws = allFields(scope).filter((x) => isPassword(x) && x.value);
    if (!pws.length) {
      // Username-first step: remember the username for the password page.
      const user = allFields(scope).find((x) => isUserish(x) && x.value && strongUserHint(x));
      if (user) send({ type: "rememberUsername", username: user.value.trim() });
      return;
    }
    const values = pws.map((p) => p.value);
    const password = values[values.length - 1];
    // [new, confirm] → no current; [current, new(, confirm)] → the first differing value.
    const currentPassword = values.slice(0, -1).find((v) => v !== password) || "";
    const userField = usernameFor(pws[0], false);
    send({ type: "capture", username: userField?.value.trim() || "", password, currentPassword });
  }

  function onClick(e) {
    const target = e.composedPath()[0];
    if (!(target instanceof Element) || (ui && e.composedPath().includes(ui.host))) return;
    const btn = target.closest('button, input[type="submit"], input[type="button"], input[type="image"], [role="button"], a');
    if (!btn) return;
    const label = `${btn.textContent || ""} ${btn.getAttribute("value") || ""} ${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("id") || ""}`.slice(0, 160);
    if (btn.getAttribute("type") === "submit" || (btn.tagName === "BUTTON" && !btn.getAttribute("type") && formOf(btn)) || SUBMIT_TEXT.test(label)) captureFrom(btn);
  }

  // -------------------------------------------------------------------------
  // Save / update bar (top frame)

  const shownPending = new Set();

  function showBar(p) {
    if (!isTop || shownPending.has(p.at)) return;
    shownPending.add(p.at);
    const { layer } = getUi();
    layer.querySelector(".bar")?.remove();

    const bar = el("div", "bar");
    bar.setAttribute("role", "dialog");
    const top = el("div", "top");
    const mark = el("span", "mark", LOGO);
    const txt = el("div", "txt");
    const t1 = el("div", "t1");
    t1.textContent = t(p.kind === "update" ? "barUpdateTitle" : "barSaveTitle");
    const t2 = el("div", "t2");
    t2.textContent = `${p.username || t("noUsername")} · ${p.kind === "update" ? p.name : p.host}`;
    const note = el("div", "note");
    note.textContent = t("barLocked");
    note.style.display = p.locked ? "block" : "none";
    txt.append(t1, t2, note);
    const x = el("button", "x", ICONS.close);
    x.type = "button";
    x.title = t("barNotNow");
    top.append(mark, txt, x);

    const btns = el("div", "btns");
    const never = el("button", "btn ghost");
    never.textContent = t("barNever");
    const later = el("button", "btn");
    later.textContent = t("barNotNow");
    const open = el("button", "btn");
    open.textContent = t("openKeyra");
    open.style.display = p.locked ? "" : "none";
    const save = el("button", "btn primary");
    save.textContent = t(p.kind === "update" ? "barUpdate" : "barSave");
    btns.append(never, later, open, save);
    bar.append(top, btns);
    layer.append(bar);

    const close = () => bar.remove();
    const act = async (action) => {
      for (const b of [never, later, save, open]) b.disabled = true;
      const res = await send({ type: "pendingAction", action });
      if (action !== "save") return close();
      if (!res.ok) {
        for (const b of [never, later, save, open]) b.disabled = false;
        note.textContent = res.error === "locked" ? t("barLocked") : t(`err_${res.error}`) || t("err_unknown");
        note.style.display = "block";
        open.style.display = res.error === "locked" ? "" : "none";
        return;
      }
      const done = el("div", "done", `<span class="ok">${ICONS.check}</span>`);
      done.append(document.createTextNode(t(res.result.done === "updated" ? "barUpdated" : res.result.done === "exists" ? "barExists" : "barSaved")));
      bar.replaceChildren(done);
      setTimeout(close, 1800);
    };
    x.addEventListener("click", () => act("dismiss"));
    later.addEventListener("click", () => act("dismiss"));
    never.addEventListener("click", () => act("never"));
    save.addEventListener("click", () => act("save"));
    open.addEventListener("click", () => send({ type: "show" }));
  }

  // -------------------------------------------------------------------------
  // Messages from the background

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg.type) {
      case "fill-login":
        sendResponse(fillLogin(msg.login));
        break;
      case "fill-card":
        sendResponse({ filled: fillCard(msg.card) });
        break;
      case "fill-identity":
        sendResponse({ filled: fillIdentity(msg.identity) });
        break;
      case "fill-generated":
        sendResponse({ filled: fillGenerated(msg.password) });
        break;
      case "show-pending":
        showBar(msg.pending);
        sendResponse({});
        break;
      case "toast":
        if (isTop) toast(msg.text);
        sendResponse({});
        break;
      case "copy":
        copyText(msg.text).then((ok) => msg.toast && toast(ok ? msg.toast : t("generatedFilledNoCopy")));
        sendResponse({});
        break;
      default:
        return false;
    }
    return false;
  });

  document.addEventListener("focusin", onFocusIn, true);
  document.addEventListener("focusout", onFocusOut, true);
  document.addEventListener("keydown", onKeyDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("submit", (e) => captureFrom(e.target), true);
  window.addEventListener("scroll", queuePlace, { capture: true, passive: true });
  window.addEventListener("resize", queuePlace, { passive: true });

  // A field may already be focused (autofocus) before this script ran.
  const initial = deepActive();
  if (initial instanceof HTMLInputElement) onFocusIn({ composedPath: () => [initial] });

  if (isTop) {
    send({ type: "getPending" }).then((res) => res.ok && res.result && showBar(res.result));
  }
})();
