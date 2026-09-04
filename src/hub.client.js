const boot = JSON.parse(document.getElementById("bootstrap").textContent);
const $ = (id) => document.getElementById(id);
const drop = $("drop");
const ORIGIN = (boot.origin || location.origin).replace(/\/$/, "");
const CONTENT_ORIGIN = (boot.content_origin || ORIGIN).replace(/\/$/, "");
const listState = {
  scope: "involved",
  q: "",
  sort: "updated",
  sitesItems: boot.sites || [],
  filesItems: boot.files || [],
  sitesTotal: Number(boot.sites_total || (boot.sites || []).length),
  filesTotal: Number(boot.files_total || (boot.files || []).length),
  sitesCursor: boot.sites_cursor || null,
  filesCursor: boot.files_cursor || null,
};
const policy = boot.policy || { presets: [], default_ttl: "7d", allow_unlimited: false };
let staged = null;

function fmtSize(n) {
  n = Number(n) || 0;
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}
function fmtTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function msg(html, err) {
  const div = document.createElement("div");
  div.className = err ? "err" : "flash";
  div.innerHTML = html;
  $("messages").prepend(div);
}
const ICONS = {
  download: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v11"/><path d="m7 11 5 5 5-5"/><path d="M5 19h14"/></svg>',
  clipboard: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="10" height="10" rx="1.6"/><path d="M7 15H6.4A1.4 1.4 0 0 1 5 13.6V6.4A1.4 1.4 0 0 1 6.4 5h7.2A1.4 1.4 0 0 1 15 6.4V7"/></svg>',
  check: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg>',
  trash: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M8 7l1 12h6l1-12"/></svg>',
  more: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="6" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="18" cy="12" r="1.7"/></svg>',
  lock: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 11V8a4 4 0 0 1 8 0v3"/><rect x="6" y="11" width="12" height="9" rx="1.6"/><path d="M12 14.5v2"/></svg>',
  dice: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3"/><circle cx="9" cy="9" r="1.15" fill="currentColor"/><circle cx="15" cy="15" r="1.15" fill="currentColor"/><circle cx="15" cy="9" r="1.15" fill="currentColor"/></svg>',
};
function iconBtn(kind, { href, label, onClick, target }) {
  const el = href ? document.createElement("a") : document.createElement("button");
  if (!href) el.type = "button";
  el.className = "icon-btn";
  el.title = label;
  el.setAttribute("aria-label", label);
  if (href) {
    el.href = href;
    if (target) {
      el.target = target;
      el.rel = "noopener noreferrer";
    }
  }
  el.innerHTML = ICONS[kind];
  if (onClick) el.addEventListener("click", onClick);
  return el;
}
function markCopied(btn, label) {
  btn.innerHTML = ICONS.check;
  btn.title = "Copied";
  btn.setAttribute("aria-label", "Copied");
  setTimeout(() => {
    btn.innerHTML = ICONS[btn.dataset.icon || "clipboard"];
    btn.title = label;
    btn.setAttribute("aria-label", label);
  }, 1200);
}
function copyTextBtn(text, label) {
  const b = iconBtn("clipboard", { label });
  b.dataset.icon = "clipboard";
  b.addEventListener("click", async () => {
    await navigator.clipboard.writeText(text);
    markCopied(b, label);
  });
  return b;
}
function copyUrlBtn(url) {
  return copyTextBtn(url, "Copy URL");
}
function memorablePassword() {
  let list = [];
  try { list = JSON.parse($("pw-words").textContent || "[]"); } catch { list = []; }
  if (!list.length) return "";
  const buf = new Uint32Array(5);
  crypto.getRandomValues(buf);
  return [0, 1, 2, 3, 4].map((i) => list[buf[i] % list.length]).join("-");
}
function selectAllOnFocus(input) {
  input.addEventListener("focus", () => {
    if (input.value) input.select();
  });
}
function bindPwField(input, genBtn, copyBtn) {
  genBtn.innerHTML = ICONS.dice;
  copyBtn.innerHTML = ICONS.clipboard;
  copyBtn.dataset.icon = "clipboard";
  selectAllOnFocus(input);
  const sync = () => {
    copyBtn.hidden = !String(input.value || "").trim();
  };
  genBtn.addEventListener("click", () => {
    input.value = memorablePassword();
    input.setAttribute("data-generated", "1");
    input.focus();
    input.select();
    sync();
  });
  copyBtn.addEventListener("click", async () => {
    const v = String(input.value || "").trim();
    if (!v) return;
    await navigator.clipboard.writeText(v);
    markCopied(copyBtn, "Copy password");
  });
  input.addEventListener("input", sync);
  sync();
}
function launchFlash(leadHtml, password) {
  const div = document.createElement("div");
  div.className = "flash";
  div.innerHTML = leadHtml;
  if (password) {
    const line = document.createElement("p");
    line.className = "flash-pw";
    const code = document.createElement("code");
    code.textContent = password;
    line.appendChild(document.createTextNode("Password "));
    line.appendChild(code);
    line.appendChild(copyTextBtn(password, "Copy password"));
    div.appendChild(line);
  }
  $("messages").prepend(div);
}
function rowActions(items) {
  const box = document.createElement("div");
  box.className = "row-actions";
  for (const item of items) if (item) box.appendChild(item);
  return box;
}
function lockBadge(on) {
  return on ? ' <span class="badge badge-lock">password</span>' : "";
}
function expiryLabel(iso) {
  if (!iso) return policy.allow_unlimited ? "Never" : "";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}
function expiryBadge(iso) {
  const label = expiryLabel(iso);
  if (!label) return "";
  return ` <span class="badge badge-ttl">${esc(label)}</span>`;
}
function fillTtlSelect() {
  const sel = $("stage-ttl");
  sel.replaceChildren();
  for (const preset of policy.presets || []) {
    const opt = document.createElement("option");
    opt.value = preset.id;
    opt.textContent = preset.label || preset.id;
    sel.appendChild(opt);
  }
  const fallback = (policy.presets || []).some((p) => p.id === policy.default_ttl)
    ? policy.default_ttl
    : (policy.presets || [])[0]?.id || "";
  if (fallback) sel.value = fallback;
  const note = $("stage-ttl-note");
  let text = "You can delete this whenever you want. Expiration is only the automatic stop.";
  if (!policy.allow_unlimited) {
    const cap = (policy.presets || []).filter((p) => p.id !== "never").at(-1);
    if (cap) text += " Longest allowed is " + (cap.label || cap.id) + ".";
  }
  note.textContent = text;
}
function stageTtl() {
  return String($("stage-ttl").value || policy.default_ttl || "").trim();
}
function fillWriteSelect() {
  const sel = $("stage-write");
  const def = policy.write_policy === "instance" ? "instance" : "owner";
  sel.value = def;
}
function stageWrite() {
  return String($("stage-write").value || policy.write_policy || "owner").trim();
}
function writePolicyLabel(value) {
  return value === "instance" ? "Anyone with a token on this host." : "Only the creator";
}
function isCreator(item) {
  return Boolean(boot.email && item.created_by && item.created_by === boot.email);
}
function countLabel(shown, total, one, many) {
  if (!total) return "";
  if (shown >= total) return total + (total === 1 ? " " + one : " " + many);
  return shown + " of " + total + " " + many;
}
function moreBtn(kind) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "btn-ghost btn-sm";
  b.textContent = "Load more";
  b.addEventListener("click", () => refresh(kind).catch((err) => msg(esc(err.message), true)));
  return b;
}
function deleteBtn(kind, name, href) {
  const b = iconBtn("trash", { label: "Delete" });
  b.classList.add("icon-btn-danger");
  b.addEventListener("click", () => removeItem(kind, name, href));
  return b;
}
function lockBtn(kind, item) {
  const on = !!item.password_protected;
  const b = iconBtn("lock", { label: on ? "Change or remove password" : "Set password" });
  if (on) b.classList.add("icon-btn-on");
  b.addEventListener("click", () => editPassword(kind, item));
  return b;
}
function extraAction(el) {
  if (el) el.classList.add("icon-btn-extra");
  return el;
}
function overflowBtn(kind, item) {
  const b = iconBtn("more", { label: "More actions" });
  b.classList.add("icon-btn-more");
  b.addEventListener("click", () => openMoreSheet(kind, item));
  return b;
}
function catalogActions(kind, item) {
  const name = kind === "site" ? item.slug : item.filename;
  const downloadHref = kind === "site"
    ? "/account/sites/" + encodeURIComponent(item.slug) + "/export"
    : "/account/files/" + encodeURIComponent(item.id) + "/download";
  const downloadLabel = kind === "site" ? "Download zip" : "Download";
  const download = kind === "site" && !(item.file_count > 0)
    ? null
    : iconBtn("download", { href: downloadHref, label: downloadLabel });
  const deleteHref = kind === "site"
    ? "/account/sites/" + encodeURIComponent(item.slug)
    : "/account/files/" + encodeURIComponent(item.id);
  return rowActions([
    extraAction(download),
    copyUrlBtn(item.url),
    extraAction(lockBtn(kind, item)),
    extraAction(deleteBtn(kind, name, deleteHref)),
    overflowBtn(kind, item),
  ]);
}
function sheetItem(label, { href, danger, icon, onClick }) {
  const el = href ? document.createElement("a") : document.createElement("button");
  if (!href) el.type = "button";
  el.className = "sheet-item" + (danger ? " danger" : "");
  if (href) el.href = href;
  if (icon && ICONS[icon]) el.innerHTML = ICONS[icon] + "<span>" + esc(label) + "</span>";
  else el.textContent = label;
  el.addEventListener("click", () => {
    $("more-dlg").close();
    if (onClick) onClick();
  });
  return el;
}
function openMoreSheet(kind, item) {
  const name = kind === "site" ? item.slug : item.filename;
  const dlg = $("more-dlg");
  $("more-dlg-title").textContent = name;
  $("more-dlg-meta").textContent = (kind === "site" ? "Site" : "File") + " · " + writePolicyLabel(item.write_policy);
  const downloadHref = kind === "site"
    ? "/account/sites/" + encodeURIComponent(item.slug) + "/export"
    : "/account/files/" + encodeURIComponent(item.id) + "/download";
  const deleteHref = kind === "site"
    ? "/account/sites/" + encodeURIComponent(item.slug)
    : "/account/files/" + encodeURIComponent(item.id);
  const items = [];
  if (kind === "file" || item.file_count > 0) {
    items.push(sheetItem(kind === "site" ? "Download zip" : "Download", { href: downloadHref, icon: "download" }));
  }
  items.push(sheetItem("Duplicate", {
    onClick: () => duplicateItem(kind, item),
  }));
  items.push(sheetItem(item.password_protected ? "Change or remove password" : "Set password", {
    icon: "lock",
    onClick: () => editPassword(kind, item),
  }));
  if (isCreator(item)) {
    items.push(sheetItem("Who can write", {
      onClick: () => editWritePolicy(kind, item),
    }));
  }
  items.push(sheetItem("Delete", {
    icon: "trash",
    danger: true,
    onClick: () => removeItem(kind, name, deleteHref),
  }));
  $("more-dlg-actions").replaceChildren(...items);
  dlg.showModal();
}
function openDialog({ title, message, label, value, placeholder, ok, danger, match }) {
  return new Promise((resolve) => {
    const dlg = $("dlg");
    const form = $("dlg-form");
    const field = $("dlg-field");
    const input = $("dlg-input");
    $("dlg-title").textContent = title;
    $("dlg-msg").textContent = message || "";
    $("dlg-msg").hidden = !message;
    $("dlg-ok").textContent = ok || "Continue";
    $("dlg-ok").className = danger ? "btn-danger" : "btn-primary";
    input.setCustomValidity("");
    if (label) {
      field.hidden = false;
      $("dlg-label").textContent = label;
      input.type = "text";
      input.value = value || "";
      input.placeholder = placeholder || "";
      input.required = true;
      input.autocomplete = "off";
    } else {
      field.hidden = true;
      input.value = "";
      input.required = false;
    }
    const onSubmit = (e) => {
      const submitter = e.submitter;
      if (!submitter || submitter.value !== "ok") {
        input.setCustomValidity("");
        return;
      }
      if (match != null && input.value !== match) {
        e.preventDefault();
        input.setCustomValidity("Type the exact name.");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
    };
    const onInput = () => input.setCustomValidity("");
    form.addEventListener("submit", onSubmit);
    input.addEventListener("input", onInput);
    const done = () => {
      dlg.removeEventListener("close", done);
      form.removeEventListener("submit", onSubmit);
      input.removeEventListener("input", onInput);
      if (dlg.returnValue !== "ok") return resolve(null);
      resolve(label ? input.value : true);
    };
    dlg.addEventListener("close", done);
    dlg.showModal();
    if (label) setTimeout(() => input.focus(), 0);
  });
}

function render(data) {
  if (data && data.email !== undefined) $("who").textContent = data.email ? data.email : "Not signed in";
  const sites = listState.sitesItems;
  $("sites-count").textContent = countLabel(sites.length, listState.sitesTotal, "site", "sites");
  if (!sites.length) {
    $("sites").innerHTML = '<p class="empty"><strong>No sites yet</strong>Publish a prepared folder or ask your agent to publish a prototype.</p>';
  } else {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const t = document.createElement("table");
    t.className = "data catalog";
    t.innerHTML = "<thead><tr><th>Slug</th><th>Created by</th><th>Last writer</th><th>Updated</th><th class=\"num\">Size</th><th></th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const s of sites) {
      const tr = document.createElement("tr");
      const filesLabel = s.file_count === 1 ? "1 file" : s.file_count + " files";
      tr.innerHTML = `<td class="name"><a href="${esc(s.url)}">${esc(s.slug)}</a>${lockBadge(s.password_protected)}${expiryBadge(s.expires_at)}</td>
        <td class="clip created-by" title="${esc(s.created_by)}">${esc(s.created_by)}</td>
        <td class="clip last-writer" title="${esc(s.last_written_by)}">${esc(s.last_written_by)}</td>
        <td class="when">${esc(fmtTime(s.updated_at))}</td>
        <td class="num">${esc(fmtSize(s.size))} · ${esc(filesLabel)}</td>
        <td class="meta">${esc(fmtTime(s.updated_at))} · ${esc(fmtSize(s.size))} · ${esc(filesLabel)}</td>
        <td class="actions"></td>`;
      tr.lastElementChild.appendChild(catalogActions("site", s));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    if (listState.sitesCursor) {
      const more = document.createElement("div");
      more.className = "pager";
      more.appendChild(moreBtn("sites"));
      wrap.appendChild(more);
    }
    $("sites").replaceChildren(wrap);
  }

  const files = listState.filesItems;
  $("files-count").textContent = countLabel(files.length, listState.filesTotal, "file", "files");
  if (!files.length) {
    $("files").innerHTML = '<p class="empty"><strong>No files yet</strong>Upload a document or ask your agent to publish one, then share its link.</p>';
  } else {
    const wrap = document.createElement("div");
    wrap.className = "table-wrap";
    const t = document.createElement("table");
    t.className = "data catalog";
    t.innerHTML = "<thead><tr><th>File</th><th>Created by</th><th>Last writer</th><th>Updated</th><th class=\"num\">Size</th><th></th></tr></thead>";
    const tb = document.createElement("tbody");
    for (const f of files) {
      const tr = document.createElement("tr");
      const when = fmtTime(f.updated_at || f.created_at);
      tr.innerHTML = `<td class="name"><a href="${esc(f.url)}">${esc(f.filename)}</a>${lockBadge(f.password_protected)}${expiryBadge(f.expires_at)}</td>
        <td class="clip created-by" title="${esc(f.created_by)}">${esc(f.created_by)}</td>
        <td class="clip last-writer" title="${esc(f.last_written_by || f.created_by)}">${esc(f.last_written_by || f.created_by)}</td>
        <td class="when">${esc(when)}</td>
        <td class="num">${esc(fmtSize(f.size))}</td>
        <td class="meta">${esc(when)} · ${esc(fmtSize(f.size))}</td>
        <td class="actions"></td>`;
      tr.lastElementChild.appendChild(catalogActions("file", f));
      tb.appendChild(tr);
    }
    t.appendChild(tb);
    wrap.appendChild(t);
    if (listState.filesCursor) {
      const more = document.createElement("div");
      more.className = "pager";
      more.appendChild(moreBtn("files"));
      wrap.appendChild(more);
    }
    $("files").replaceChildren(wrap);
  }
}

async function refresh(only) {
  const qs = new URLSearchParams({
    scope: listState.scope,
    q: listState.q,
    sort: listState.sort,
  });
  if (only === "sites" && listState.sitesCursor) qs.set("sites_cursor", listState.sitesCursor);
  if (only === "files" && listState.filesCursor) qs.set("files_cursor", listState.filesCursor);
  const res = await fetch("/account/data?" + qs.toString(), { headers: { accept: "application/json" } });
  if (!res.ok) return;
  const data = await res.json();
  if (!only || only === "sites") {
    listState.sitesItems = only === "sites" ? listState.sitesItems.concat(data.sites || []) : (data.sites || []);
    listState.sitesTotal = Number(data.sites_total || 0);
    listState.sitesCursor = data.sites_cursor || null;
  }
  if (!only || only === "files") {
    listState.filesItems = only === "files" ? listState.filesItems.concat(data.files || []) : (data.files || []);
    listState.filesTotal = Number(data.files_total || 0);
    listState.filesCursor = data.files_cursor || null;
  }
  render(data);
}

function resetLists() {
  listState.sitesCursor = null;
  listState.filesCursor = null;
  return refresh();
}

function openPasswordDialog({ title, message, canRemove }) {
  return new Promise((resolve) => {
    const dlg = $("pw-dlg");
    const form = $("pw-dlg-form");
    const input = $("pw-dlg-input");
    $("pw-dlg-title").textContent = title;
    $("pw-dlg-msg").textContent = message || "";
    $("pw-dlg-msg").hidden = !message;
    $("pw-dlg-clear").hidden = !canRemove;
    input.value = "";
    input.removeAttribute("data-generated");
    $("pw-dlg-copy").hidden = true;
    input.setCustomValidity("");
    const onSubmit = (e) => {
      const submitter = e.submitter;
      if (!submitter || submitter.value === "cancel") {
        input.setCustomValidity("");
        return;
      }
      if (submitter.value === "ok" && !String(input.value || "").trim()) {
        e.preventDefault();
        input.setCustomValidity("Generate or type a password.");
        input.reportValidity();
        return;
      }
      input.setCustomValidity("");
    };
    const onInput = () => input.setCustomValidity("");
    form.addEventListener("submit", onSubmit);
    input.addEventListener("input", onInput);
    const done = () => {
      dlg.removeEventListener("close", done);
      form.removeEventListener("submit", onSubmit);
      input.removeEventListener("input", onInput);
      if (dlg.returnValue === "clear") return resolve("");
      if (dlg.returnValue === "ok") return resolve(String(input.value || "").trim());
      resolve(null);
    };
    dlg.addEventListener("close", done);
    dlg.showModal();
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (!coarse) setTimeout(() => input.focus(), 0);
  });
}

function openWriteDialog(current) {
  return new Promise((resolve) => {
    const dlg = $("write-dlg");
    const sel = $("write-dlg-select");
    sel.value = current === "instance" ? "instance" : "owner";
    const done = () => {
      dlg.removeEventListener("close", done);
      if (dlg.returnValue === "ok") return resolve(sel.value);
      resolve(null);
    };
    dlg.addEventListener("close", done);
    dlg.showModal();
  });
}

async function duplicateItem(kind, item) {
  try {
    if (kind === "site") {
      const suggested = await firstFreeSlug(nextNumberedSlug(item.slug));
      const slug = await openDialog({
        title: "Duplicate site",
        message: "Creates a new site you own. Expiration starts now. The share password is not copied.",
        label: "New slug",
        value: suggested,
        ok: "Duplicate",
      });
      if (!slug) return;
      const data = await api("/account/sites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slugify(slug), duplicate_from: item.slug }),
      });
      launchFlash(`Duplicated <a href="${esc(data.url)}">${esc(data.slug)}</a> (${Number(data.file_count || 0)} files).`);
    } else {
      const data = await api("/account/files", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ duplicate_from: item.id }),
      });
      launchFlash(`Duplicated <a href="${esc(data.url)}">${esc(data.filename)}</a>`);
    }
    await resetLists();
  } catch (err) {
    msg(esc(err.message), true);
  }
}

async function editWritePolicy(kind, item) {
  const next = await openWriteDialog(item.write_policy);
  if (next == null || next === item.write_policy) return;
  const href = kind === "site"
    ? "/account/sites/" + encodeURIComponent(item.slug)
    : "/account/files/" + encodeURIComponent(item.id);
  try {
    await api(href, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ write_policy: next }),
    });
    msg("Who can write updated.");
    await resetLists();
  } catch (err) {
    msg(esc(err.message), true);
  }
}

async function editPassword(kind, item) {
  const name = kind === "site" ? item.slug : item.filename;
  const on = !!item.password_protected;
  const password = await openPasswordDialog({
    title: on ? "Change password" : "Set password",
    message: on
      ? "The current password cannot be shown. Generate or type a new one, or remove it."
      : "Anyone with the password can open the link. Copy it now — Energon only stores a hash.",
    canRemove: on,
  });
  if (password === null) return;
  const href = kind === "site"
    ? "/account/sites/" + encodeURIComponent(item.slug)
    : "/account/files/" + encodeURIComponent(item.id);
  try {
    const data = await api(href, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (data.password_protected) {
      launchFlash("Password set for <strong>" + esc(name) + "</strong>.", data.password || password);
    } else {
      msg("Password removed from " + esc(name) + ".");
    }
    await resetLists();
  } catch (err) {
    msg(esc(err.message), true);
  }
}

async function removeItem(kind, name, href) {
  const noun = kind === "site" ? "site" : "file";
  const ok = await openDialog({
    title: "Delete " + noun,
    message: "This removes the " + noun + " and its bytes. There is no recycle bin. Type the name to confirm.",
    label: "Type “" + name + "” to delete",
    placeholder: name,
    match: name,
    ok: "Delete",
    danger: true,
  });
  if (!ok) return;
  try {
    await api(href, { method: "DELETE" });
    msg("Deleted " + esc(name) + ".");
    await resetLists();
  } catch (err) {
    msg(esc(err.message), true);
  }
}

async function api(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || res.status + " " + url);
  }
  return data;
}

function safeFilename(name, fallback) {
  const base = String(name || fallback || "file").replace(/\\/g, "/").split("/").pop() || "file";
  const cleaned = base.replace(/[^\w.\- ()[\]]+/g, "-").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 180);
  return cleaned || fallback || "file";
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63) || "site";
}
function nextNumberedSlug(slug) {
  const raw = String(slug || "").trim().toLowerCase().replace(/^-+|-+$/g, "");
  const m = /^(.*)-(\d+)$/.exec(raw);
  const base = (m && m[1] ? m[1] : raw).replace(/-+$/g, "") || "site";
  const n = m ? Number(m[2]) + 1 : 2;
  const suffix = "-" + (Number.isFinite(n) && n > 1 ? n : 2);
  let head = base.slice(0, Math.max(1, 63 - suffix.length)).replace(/-+$/g, "");
  if (!head) head = "site";
  return (head + suffix).slice(0, 63);
}
async function slugTaken(slug) {
  const handle = boot.handle || "you";
  try {
    const res = await fetch(CONTENT_ORIGIN + "/" + handle + "/s/" + encodeURIComponent(slug) + "/", {
      headers: { accept: "application/json" },
    });
    return res.status !== 404 && res.status !== 410;
  } catch {
    return false;
  }
}
async function firstFreeSlug(start) {
  let slug = slugify(start);
  for (let i = 0; i < 50; i++) {
    if (!(await slugTaken(slug))) return slug;
    slug = nextNumberedSlug(slug);
  }
  return slug;
}
async function fillFreeSlug(next) {
  const preferred = slugify($("stage-slug").value || next.slug);
  const free = await firstFreeSlug(preferred);
  if (staged !== next) return;
  if (slugify($("stage-slug").value) !== preferred) return;
  $("stage-slug").value = free;
  if (free !== preferred) {
    $("stage-exists").hidden = false;
    $("stage-exists").textContent = "'" + preferred + "' exists. Using '" + free + "'.";
  }
}

function stagePassword() {
  return String($("stage-password").value || "").trim();
}

function resetStage() {
  staged = null;
  $("stage").hidden = true;
  $("drop-idle").hidden = false;
  $("stage-exists").hidden = true;
  $("stage-password").value = "";
  $("stage-password").removeAttribute("data-generated");
  $("stage-pw-copy").hidden = true;
  $("stage-go").textContent = "Publish";
  drop.classList.remove("busy");
}

function showStage(next) {
  staged = next;
  $("drop-idle").hidden = true;
  $("stage").hidden = false;
  $("stage-exists").hidden = true;
  $("stage-password").value = "";
  $("stage-password").removeAttribute("data-generated");
  $("stage-pw-copy").hidden = true;
  $("stage-site").hidden = next.kind === "loose";
  $("stage-loose").hidden = next.kind !== "loose";
  $("stage-go").textContent = "Publish";
  const handle = boot.handle || "you";
  $("stage-site-origin").textContent = CONTENT_ORIGIN + "/" + handle + "/s/";
  $("stage-file-origin").textContent = CONTENT_ORIGIN + "/" + handle + "/f/{id}/";
  if (next.kind === "loose") {
    $("stage-status").textContent = "1 file ready";
    $("stage-filename").value = next.file.name;
    setTimeout(() => $("stage-filename").focus(), 0);
  } else {
    const n = next.files.length;
    $("stage-status").textContent = n + (n === 1 ? " file ready" : " files ready");
    $("stage-slug").value = next.slug;
    setTimeout(() => $("stage-slug").focus(), 0);
    fillFreeSlug(next).catch(() => {});
  }
}

async function readEntry(entry, prefix) {
  prefix = prefix || "";
  if (entry.isFile) {
    const file = await new Promise((resolve, reject) => entry.file(resolve, reject));
    const path = prefix + entry.name;
    return [{ path, file }];
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const entries = [];
    for (;;) {
      const batch = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!batch.length) break;
      entries.push(...batch);
    }
    const out = [];
    for (const child of entries) {
      out.push(...await readEntry(child, prefix + entry.name + "/"));
    }
    return out;
  }
  return [];
}

function stripWrapFiles(items) {
  if (!items.length) return items;
  const first = items[0].path.split("/")[0];
  if (items.every((it) => it.path.startsWith(first + "/"))) {
    const n = first.length + 1;
    return items.map((it) => ({ ...it, path: it.path.slice(n) }));
  }
  return items;
}

async function launchSite() {
  if (!staged || staged.kind === "loose") return;
  const slug = slugify($("stage-slug").value);
  $("stage-slug").value = slug;
  if (!slug) return;
  const password = stagePassword();
  try {
    drop.classList.add("busy");
    $("stage-go").textContent = "Publishing…";
    const payload = { slug, overwrite: Boolean(staged.overwrite) };
    if (password) payload.password = password;
    if (!staged.overwrite) {
      const ttl = stageTtl();
      if (ttl) payload.ttl = ttl;
      const write = stageWrite();
      if (write) payload.write_policy = write;
    }
    const res = await fetch("/account/sites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 409 && !staged.overwrite) {
      if (staged.conflictSlug === slug) {
        staged.overwrite = true;
        $("stage-exists").hidden = false;
        $("stage-exists").textContent = (data.message || "Site exists.") + " Publish again to write into it.";
        $("stage-go").textContent = "Write into it";
        drop.classList.remove("busy");
        return;
      }
      staged.conflictSlug = slug;
      const suggested = await firstFreeSlug(nextNumberedSlug(slug));
      $("stage-slug").value = suggested;
      $("stage-exists").hidden = false;
      $("stage-exists").textContent = "'" + slug + "' exists. Using '" + suggested + "'. Publish to create it, or put '" + slug + "' back to write into the existing site.";
      $("stage-go").textContent = "Publish";
      drop.classList.remove("busy");
      return;
    }
    if (!res.ok) throw new Error(data.message || "Could not create site");
    if (staged.kind === "zip") {
      const imported = await api("/account/sites/" + encodeURIComponent(slug) + "/import", {
        method: "POST",
        headers: { "content-type": "application/zip" },
        body: staged.file,
      });
      launchFlash(`Published <a href="${esc(imported.url)}">${esc(imported.slug)}</a> (${(imported.written || []).length} files).`, data.password || password);
    } else {
      const files = stripWrapFiles(staged.files).filter((it) => it.path && !it.path.endsWith("/"));
      for (const it of files) {
        await api("/account/sites/" + encodeURIComponent(slug) + "/files/" + it.path.split("/").map(encodeURIComponent).join("/"), {
          method: "PUT",
          headers: { "content-type": it.file.type || "application/octet-stream" },
          body: it.file,
        });
      }
      launchFlash(`Published <a href="${esc(CONTENT_ORIGIN)}/${esc(boot.handle || "you")}/s/${esc(slug)}/">${esc(slug)}</a> (${files.length} files).`, data.password || password);
    }
    resetStage();
    await resetLists();
  } catch (err) {
    drop.classList.remove("busy");
    $("stage-go").textContent = staged.overwrite ? "Write into it" : "Publish";
    msg(esc(err.message), true);
  }
}

async function launchLoose() {
  if (!staged || staged.kind !== "loose") return;
  try {
    drop.classList.add("busy");
    $("stage-go").textContent = "Publishing…";
    const form = new FormData();
    const name = safeFilename($("stage-filename").value, staged.file.name);
    $("stage-filename").value = name;
    form.set("file", staged.file, name);
    const password = stagePassword();
    if (password) form.set("password", password);
    const ttl = stageTtl();
    if (ttl) form.set("ttl", ttl);
    const write = stageWrite();
    if (write) form.set("write_policy", write);
    const data = await api("/account/files", { method: "POST", body: form });
    launchFlash(`Published <a href="${esc(data.url)}">${esc(data.filename)}</a>`, data.password || password);
    resetStage();
    await resetLists();
  } catch (err) {
    drop.classList.remove("busy");
    $("stage-go").textContent = "Publish";
    msg(esc(err.message), true);
  }
}

async function handleFiles(files, entries) {
  drop.classList.add("busy");
  try {
    const dir = (entries || []).find((en) => en && en.isDirectory);
    files = files || [];
    if (dir) {
      const collected = await readEntry(dir);
      showStage({ kind: "folder", files: collected, slug: slugify(dir.name) });
      return;
    }
    if (files.length === 1 && /\.zip$/i.test(files[0].name)) {
      showStage({ kind: "zip", file: files[0], files: [{ path: files[0].name, file: files[0] }], slug: slugify(files[0].name.replace(/\.zip$/i, "")) });
      return;
    }
    if (files.length === 1) {
      showStage({ kind: "loose", file: files[0] });
      return;
    }
    if (files.length > 1) {
      showStage({
        kind: "folder",
        files: files.map((f) => ({ path: f.webkitRelativePath || f.name, file: f })),
        slug: slugify(files[0].webkitRelativePath?.split("/")[0] || "site"),
      });
    }
  } finally {
    drop.classList.remove("busy");
  }
}

function dtHasFiles(e) {
  const types = e.dataTransfer && e.dataTransfer.types;
  if (!types) return false;
  return [...types].includes("Files");
}
let dragDepth = 0;
function setDropActive(on) {
  document.body.classList.toggle("drop-active", on);
  $("drop-overlay").setAttribute("aria-hidden", on ? "false" : "true");
  $("drop").classList.toggle("over", on);
}
document.addEventListener("dragenter", (e) => {
  if (!dtHasFiles(e)) return;
  e.preventDefault();
  dragDepth += 1;
  setDropActive(true);
});
document.addEventListener("dragover", (e) => {
  if (!dtHasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "copy";
});
document.addEventListener("dragleave", (e) => {
  if (!dtHasFiles(e)) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) setDropActive(false);
});
document.addEventListener("drop", async (e) => {
  if (!dtHasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  setDropActive(false);
  try {
    const items = [...(e.dataTransfer.items || [])];
    const entries = items.map((it) => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
    await handleFiles([...(e.dataTransfer.files || [])], entries);
    window.scrollTo({ top: 0, behavior: "smooth" });
  } catch (err) {
    msg(esc(err.message), true);
  }
});

$("pick-files").addEventListener("click", () => $("filepick").click());
$("pick-folder").addEventListener("click", () => $("folderpick").click());
$("filepick").addEventListener("change", async (e) => {
  try { await handleFiles([...e.target.files], []); } catch (err) { msg(esc(err.message), true); }
  e.target.value = "";
});
$("folderpick").addEventListener("change", async (e) => {
  const files = [...e.target.files];
  try {
    if (files.length) {
      showStage({
        kind: "folder",
        files: files.map((f) => ({ path: f.webkitRelativePath || f.name, file: f })),
        slug: slugify(files[0].webkitRelativePath?.split("/")[0] || "site"),
      });
    }
  } catch (err) { msg(esc(err.message), true); }
  e.target.value = "";
});

$("stage-go").addEventListener("click", () => {
  const run = staged && staged.kind === "loose" ? launchLoose : launchSite;
  run().catch((err) => msg(esc(err.message), true));
});
$("stage-cancel").addEventListener("click", resetStage);
$("stage-slug").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); launchSite(); } });
$("stage-filename").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); launchLoose(); } });

let qTimer = 0;
$("q").addEventListener("input", () => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { listState.q = $("q").value.trim(); resetLists(); }, 200);
});
$("sort").addEventListener("change", () => { listState.sort = $("sort").value; resetLists(); });
$("scope").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-scope]");
  if (!btn) return;
  listState.scope = btn.getAttribute("data-scope");
  for (const b of $("scope").querySelectorAll("button")) b.classList.toggle("on", b === btn);
  resetLists();
});

fillTtlSelect();
fillWriteSelect();
bindPwField($("stage-password"), $("stage-pw-gen"), $("stage-pw-copy"));
bindPwField($("pw-dlg-input"), $("pw-dlg-gen"), $("pw-dlg-copy"));
$("more-dlg").addEventListener("click", (e) => {
  if (e.target === $("more-dlg")) $("more-dlg").close();
});
render(boot);

const modelContext = document.modelContext || navigator.modelContext;
if (modelContext && typeof modelContext.registerTool === "function") {
  const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });
  modelContext.registerTool({
    name: "energon_help",
    description: "Energon SOP and public API map. Prefer this or GET /v1/help before inventing routes.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      const res = await fetch("/v1/help");
      return text(await res.json());
    },
  });
  modelContext.registerTool({
    name: "energon_list",
    description: "List sites, files, and token labels visible on this signed-in hub. Does not return token secrets.",
    inputSchema: { type: "object", properties: {} },
    async execute() {
      const res = await fetch("/account/data", { headers: { accept: "application/json" } });
      const data = await res.json();
      return text({
        email: data.email,
        sites: data.sites,
        files: data.files,
        tokens: (data.tokens || []).filter((t) => !t.revoked).map((t) => ({ label: t.label, hint: t.hint || null, recoverable: t.recoverable })),
      });
    },
  });
}
