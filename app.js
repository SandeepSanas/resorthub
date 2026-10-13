// ResortHub – multi-resort operations console
// Firebase JS SDK v10 (modular, loaded from gstatic). No build step required.
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, initializeAuth, inMemoryPersistence, createUserWithEmailAndPassword, onAuthStateChanged, signInWithEmailAndPassword, signOut, sendPasswordResetEmail, setPersistence, browserSessionPersistence } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFirestore, collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch, query, where, orderBy, limit, startAfter, runTransaction, serverTimestamp, Timestamp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// ============================================================ CONFIG
const FIREBASE_CONFIG = {
  apiKey: "AIzaSyBUMUlt17qx3wtjfcrZfX0w-brCIDuSqV0",
  authDomain: "resort-55622.firebaseapp.com",
  projectId: "resort-55622",
  storageBucket: "resort-55622.firebasestorage.app",
  messagingSenderId: "376961349953",
  appId: "1:376961349953:web:d71fdeb13836b19fd349c0"
};
const APP_VERSION = "2.3.0";
const IDLE_MINUTES = 30;                  // auto sign-out on shared front-desk terminals
const MAX_DISCOUNT_PCT = 20;              // above this needs bookings:approve
const HOLD_HOURS = 24;

const app = initializeApp(FIREBASE_CONFIG);
const auth = getAuth(app), db = getFirestore(app);
// No Cloud Functions needed: works on the free Spark plan. Roles live in /users/{uid} and are enforced by firestore.rules.

// ============================================================ UTILITIES
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const round2 = n => Math.round((Number(n) || 0) * 100) / 100;
const inr = n => "₹" + Math.round(Number(n || 0)).toLocaleString("en-IN");
const inr2 = n => "₹" + Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inrK = n => { n = Number(n) || 0; return n >= 1e7 ? "₹" + (n / 1e7).toFixed(1) + "Cr" : n >= 1e5 ? "₹" + (n / 1e5).toFixed(1) + "L" : n >= 1e3 ? "₹" + Math.round(n / 1e3) + "k" : "₹" + Math.round(n); };
const label = s => { s = String(s ?? "").replace(/_/g, " "); return s.charAt(0).toUpperCase() + s.slice(1); };
const localISO = (d = new Date()) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const today = () => localISO();
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nights = (a, b) => { const out = []; if (!a || !b) return out; for (let d = new Date(a + "T00:00:00Z"); d < new Date(b + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10)); return out; }; // checkout exclusive
const fmtDate = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const fmtDay = iso => iso ? new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) : "—";
const fmtTs = t => t?.toDate ? t.toDate().toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
const tsISO = t => t?.toDate ? localISO(t.toDate()) : "";
// Canonical mobile format: +<country code><number>. Plain 10-digit (or 0-prefixed) numbers are treated as Indian (+91).
const normPhone = s => {
  const raw = String(s || "").trim(), plus = raw.startsWith("+"); let d = raw.replace(/\D/g, "");
  if (!d) return "";
  if (plus) return "+" + d;
  if (d.startsWith("00")) return "+" + d.slice(2);
  if (d.length === 10) return "+91" + d;
  if (d.length === 11 && d[0] === "0") return "+91" + d.slice(1);
  return "+" + d;
};
// Every format an older record might have used for the same number (for lookups / duplicate checks)
const phoneVariants = p => { const c = normPhone(p), d = c.replace(/\D/g, ""), o = new Set([c, d, String(p || "").replace(/[^\d+]/g, "")]); if (d.startsWith("91") && d.length === 12) { const t = d.slice(2); o.add(t); o.add("0" + t); } return [...o].filter(Boolean).slice(0, 10); };
const initials = s => String(s || "?").split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(x => x[0].toUpperCase()).join("");
const sum = (arr, f) => arr.reduce((s, x) => s + (Number(typeof f === "function" ? f(x) : x[f]) || 0), 0);
const gstSlab = perNight => perNight <= 1000 ? 0 : perNight <= 7500 ? 5 : 18; // India GST on accommodation (verify with your CA)
const balance = b => round2((b.total || 0) - ((b.amountPaid || 0) - (b.refunded || 0)));
const bookingRef = b => b.ref || String(b.id || "").slice(0, 8).toUpperCase();

const ICONS = {
  grid: "M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z",
  calendar: "M3 5h18v16H3zM16 3v4M8 3v4M3 10h18",
  sparkle: "M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6",
  broom: "M21 3l-7.6 7.6M10.2 9.8l4 4M10.2 9.8C6.4 10.9 4 13.6 3 21c7.4-1 10.1-3.4 11.2-7.2M6.4 17.6 8.6 15.4M9.8 19.4l1.6-1.6",
  key: "M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0 3 3L22 7l-3-3m-3.5 3.5L19 4",
  bell: "M3 18h18M5 18a7 7 0 0 1 14 0M12 9V7M10 7h4",
  coffee: "M17 8h1a4 4 0 0 1 0 8h-1M3 8h14v9a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V8zM7 2v3M11 2v3M15 2v3",
  mountain: "M3 20 9.5 9l4 6.5L16 12l5 8z",
  umbrella: "M22 12a10 10 0 0 0-20 0zM12 12v6a2.5 2.5 0 0 1-5 0",
  wave: "M2 10c2-2 4-2 6 0s4 2 6 0 4-2 6 0M2 16c2-2 4-2 6 0s4 2 6 0 4-2 6 0",
  phone: "M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z",
  users: "M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8",
  card: "M2 5h20v14H2zM2 10h20M6 15h4",
  bed: "M2 20v-8a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v8M2 16h20M6 10V6a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v4",
  tool: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z",
  pin: "M12 21s-7-7.5-7-12a7 7 0 0 1 14 0c0 4.5-7 12-7 12zM12 11.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z",
  user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M16 13H8M16 17H8",
  sliders: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  search: "M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3",
  logout: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9",
  menu: "M3 12h18M3 6h18M3 18h18",
  plus: "M12 5v14M5 12h14",
  download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  print: "M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z",
  x: "M18 6 6 18M6 6l12 12",
  chat: "M21 11.5a8.4 8.4 0 0 1-12.4 7.4L3 21l2.1-5.6A8.4 8.4 0 1 1 21 11.5z"
};
const ico = n => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS[n] || ""}"/></svg>`;

const BADGE = {
  confirmed: "ok", checked_in: "info", checked_out: "n", hold: "warn", cancelled: "bad", no_show: "bad",
  paid: "ok", partial: "warn", unpaid: "bad", refunded: "n", payment: "ok", refund: "warn",
  available: "ok", ready: "ok", cleaning_required: "warn", cleaning_in_progress: "info", maintenance: "bad", out_of_service: "bad", blocked: "bad",
  pending: "warn", in_progress: "info", done: "ok", low: "n", normal: "info", high: "warn", critical: "bad",
  new: "info", contacted: "info", interested: "info", follow_up: "warn", quotation_sent: "info", negotiation: "warn", booking_confirmed: "ok", not_interested: "n", lost: "bad", invalid: "n",
  active: "ok", inactive: "n", regular: "n", vip: "warn", corporate: "info", verified: "ok", unverified: "n", overdue: "bad"
};
const HK_LABEL = { ready: "Clean & ready", cleaning_required: "Dirty", cleaning_in_progress: "Cleaning" };
const badge = (s, txt) => s ? `<span class="badge b-${BADGE[s] || "n"}">${esc(txt || HK_LABEL[s] || label(s))}</span>` : "";

function toast(msg, type = "info") {
  const d = document.createElement("div"); d.className = "t t-" + type; d.textContent = msg; $("#toast").append(d);
  setTimeout(() => { d.classList.add("out"); setTimeout(() => d.remove(), 300); }, 4200);
}
const ERR = {
  "permission-denied": "You don't have permission to do that.",
  "unauthenticated": "Your session has expired. Please sign in again.",
  "unavailable": "Can't reach the server. Check your connection and try again.",
  "failed-precondition": "This screen needs a one-time database index. Tap the link below, tap Save in Firebase, then wait 2–5 minutes and reload.",
  "not-found": "Record not found.",
  "already-exists": "That record already exists.",
  "invalid-argument": "Some details are invalid."
};
const errMsg = e => {
  const raw = String(e?.code || ""), c = raw.replace(/^(functions|firestore|auth)\//, ""), msg = e?.message || "";
  if (raw.startsWith("functions/") && msg && c !== "internal") return msg;               // server-side validation messages
  if (c === "failed-precondition") return /index/i.test(msg) ? ERR[c] : (msg || "Action not allowed in the current state.");
  if (c && ERR[c]) return ERR[c];
  return msg || "Something went wrong.";
};
function fail(e) { console.error(e); toast(errMsg(e), "error"); }
const errBox = e => { console.error(e); const link = String(e?.message || "").match(/https:\/\/console\.firebase\.google\.com\S+/)?.[0]; return `<div class="empty"><b>Couldn't load this view</b><p>${esc(errMsg(e))}</p>${link ? `<a href="${esc(link)}" target="_blank" rel="noopener"><b>Create the index →</b></a>` : ""}</div>`; };
const emptyBox = (title, sub = "", action = "") => `<div class="empty"><b>${esc(title)}</b><p>${esc(sub)}</p>${action}</div>`;
const SK = '<div class="pad"><div class="sk"></div><div class="sk"></div><div class="sk w60"></div></div>';

function exportCSV(name, cols, rows) {
  const cell = v => { let s = String(v ?? ""); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const t = "﻿" + [cols.map(c => cell(c.label)).join(","), ...rows.map(r => cols.map(c => cell(c.csv ? c.csv(r) : r[c.key])).join(","))].join("\r\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([t], { type: "text/csv;charset=utf-8" })); a.download = name + ".csv"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// Document IDs that sort newest-first by default. Lets every list run without composite indexes.
function newId() { const A = "abcdefghijkmnpqrstuvwxyz23456789", r = crypto.getRandomValues(new Uint8Array(7)); return String(9999999999999 - Date.now()).padStart(13, "0") + [...r].map(x => A[x % A.length]).join(""); }
const newRef = c => doc(db, c, newId());
const byNewest = (a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
// Firestore 'in' accepts max 30 values – split long date lists
const chunks = (arr, n = 30) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };
function makeRef(code) {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789", r = crypto.getRandomValues(new Uint8Array(4));
  const p = String(code || "RH").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "RH";
  return `${p}-${today().slice(2).replace(/-/g, "")}-${[...r].map(x => A[x % A.length]).join("")}`;
}

// ============================================================ ROLES & PERMISSIONS
const MODS = ["dashboard", "resorts", "rooms", "customers", "leads", "bookings", "payments", "housekeeping", "maintenance", "users", "roles", "auditLogs", "settings"];
const ACT = ["view", "add", "edit", "delete", "approve", "export"];
const all = () => Object.fromEntries(MODS.map(m => [m, Object.fromEntries(ACT.map(a => [a, true]))]));
const mk = spec => { const o = {}; for (const [m, a] of Object.entries(spec)) o[m] = Object.fromEntries(a.split(",").map(x => [x, true])); return o; };
const DEFAULT_ROLES = {
  super_admin: all(), company_admin: all(),
  management: mk({ dashboard: "view", resorts: "view,export", rooms: "view", bookings: "view,export", payments: "view,export", leads: "view", customers: "view" }),
  resort_admin: mk({ dashboard: "view", rooms: "view,add,edit", customers: "view,add,edit", leads: "view,add,edit", bookings: "view,add,edit,approve,export", payments: "view,add,approve,export", housekeeping: "view,add,edit", maintenance: "view,add,edit,approve" }),
  telecaller: mk({ dashboard: "view", customers: "view,add,edit", leads: "view,add,edit", bookings: "view,add" }),
  reservation_manager: mk({ dashboard: "view", customers: "view,add,edit", leads: "view,add,edit", bookings: "view,add,edit,approve", rooms: "view" }),
  front_desk: mk({ dashboard: "view", customers: "view,add", bookings: "view,edit", rooms: "view", payments: "view,add", housekeeping: "view" }),
  accounts: mk({ dashboard: "view", bookings: "view,export", payments: "view,add,edit,approve,export" }),
  housekeeping: mk({ housekeeping: "view,edit", maintenance: "view,add", rooms: "view" })
};
const ROLE_LABEL = { super_admin: "Super Admin", company_admin: "Company Admin", management: "Management", resort_admin: "Resort Admin", telecaller: "Telecaller", reservation_manager: "Reservation Manager", front_desk: "Front Desk", accounts: "Accounts", housekeeping: "Housekeeping" };
const roleLabel = r => ROLE_LABEL[r] || label(r);
const BOOKING_STATUSES = ["hold", "confirmed", "checked_in", "checked_out", "cancelled", "no_show"];
const LEAD_STATUSES = ["new", "contacted", "interested", "follow_up", "quotation_sent", "negotiation", "booking_confirmed", "not_interested", "lost", "invalid"];
const LEAD_CLOSED = ["booking_confirmed", "not_interested", "lost", "invalid"];
const ROOM_CATS = ["Standard", "Deluxe", "Premium", "Suite", "Villa", "Cottage", "Family Room"];

let ME = null, ROLE = null, PERMS = {}, RESORTS = [], RESORT = "all", CURRENT = "dashboard";
const can = (m, a = "view") => !!PERMS[m]?.[a];
const isAdmin = () => ["super_admin", "company_admin"].includes(ROLE);
const seesAll = () => ["super_admin", "company_admin", "management"].includes(ROLE);
const scopeC = () => RESORT !== "all" ? [where("resortId", "==", RESORT)] : [];
const resortById = id => RESORTS.find(r => r.id === id);
const resortName = id => resortById(id)?.name || "—";

// ============================================================ AUDIT
const stamp = isNew => ({ ...(isNew ? { createdAt: serverTimestamp(), createdBy: ME.uid } : {}), updatedAt: serverTimestamp(), updatedBy: ME.uid });
const audit = (action, module, recordId, resortId, summary) =>
  setDoc(newRef("auditLogs"), { userId: ME.uid, userEmail: ME.email || "", action, module, recordId: recordId || "", resortId: resortId || null, summary: summary || "", ts: serverTimestamp() }).catch(console.error);

// ============================================================ DIALOGS
const dlg = () => $("#dlg");
function openDialog(html, { size = "" } = {}) { const d = dlg(); d.className = size; d.innerHTML = html; if (!d.open) d.showModal(); bindClose(d); return d; }
const closeDialog = () => { const d = dlg(); if (d.open) d.close(); };
const bindClose = d => $$("[data-close]", d).forEach(b => b.onclick = () => d.close());
const closeBtn = `<button type="button" class="icon ghost" data-close aria-label="Close">${ico("x")}</button>`;

function fieldHtml(f, v) {
  const id = "f_" + f.key;
  const at = `id="${id}" name="${f.key}" ${f.req ? "required" : ""} ${f.disabled ? "disabled" : ""} ${f.min != null ? `min="${f.min}"` : ""} ${f.max != null ? `max="${f.max}"` : ""} ${f.step ? `step="${f.step}"` : ""} ${f.pattern ? `pattern="${f.pattern}" title="${esc(f.title || "")}"` : ""} ${f.ph ? `placeholder="${esc(f.ph)}"` : ""} ${f.auto ? `autocomplete="${f.auto}"` : ""}`;
  let inp;
  if (f.type === "select") inp = `<select ${at}>${f.opts.map(o => { const [val, lab] = Array.isArray(o) ? o : [o, label(o)]; return `<option value="${esc(val)}" ${String(v) === String(val) ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select>`;
  else if (f.type === "textarea") inp = `<textarea ${at} rows="3">${esc(v)}</textarea>`;
  else if (f.type === "checks") { const vs = Array.isArray(v) ? v : []; inp = `<div class="checks">${f.opts.map(([val, lab]) => `<label class="chk"><input type="checkbox" name="${f.key}" value="${esc(val)}" ${vs.includes(val) ? "checked" : ""}> ${esc(lab)}</label>`).join("") || '<span class="muted">None available</span>'}</div>`; }
  else inp = `<input type="${f.type || "text"}" value="${esc(v)}" ${at}>`;
  return `<div class="fld${f.wide ? " wide" : ""}"><label ${f.type === "checks" ? "" : `for="${id}"`}>${esc(f.label)}${f.req ? " <i>*</i>" : ""}</label>${inp}${f.hint ? `<small>${esc(f.hint)}</small>` : ""}</div>`;
}
// onSave may return true to keep the dialog open (e.g. when it already opened a follow-up view)
function modal(title, fields, vals, onSave, { size = "md", saveText = "Save", sub = "" } = {}) {
  openDialog(`<form id="mf"><div class="dh"><div><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ""}</div>${closeBtn}</div>
  <div class="db"><div class="f2">${fields.map(f => fieldHtml(f, vals?.[f.key] ?? (typeof f.def === "function" ? f.def() : f.def) ?? "")).join("")}</div><div class="err" id="mErr" role="alert"></div></div>
  <div class="df"><button type="button" data-close>Cancel</button><button class="primary" id="mSave" type="submit">${esc(saveText)}</button></div></form>`, { size });
  $("#mf").onsubmit = async e => {
    e.preventDefault(); const b = $("#mSave"); if (b.disabled) return; b.disabled = true; b.classList.add("busy");
    const fd = new FormData(e.target), o = {};
    fields.forEach(f => { if (f.disabled) return; if (f.type === "checks") o[f.key] = fd.getAll(f.key); else { const v = fd.get(f.key); o[f.key] = f.type === "number" ? Number(v || 0) : String(v ?? "").trim(); } });
    try { const keep = await onSave(o); if (!keep) closeDialog(); }
    catch (er) { console.error(er); $("#mErr").textContent = errMsg(er); b.disabled = false; b.classList.remove("busy"); }
  };
}
function confirmBox(msg, { title = "Please confirm", ok = "Confirm", danger = false } = {}) {
  return new Promise(res => {
    let v = false;
    const d = openDialog(`<div class="dh"><h3>${esc(title)}</h3></div><div class="db"><p style="margin:0">${esc(msg)}</p></div><div class="df"><button id="cN">Cancel</button><button id="cY" class="${danger ? "danger solid" : "primary"}">${esc(ok)}</button></div>`, { size: "sm" });
    $("#cY").onclick = () => { v = true; d.close(); }; $("#cN").onclick = () => d.close();
    d.addEventListener("close", () => res(v), { once: true });
  });
}
function askText(title, sub, fieldLabel = "Reason") {
  return new Promise(res => {
    let v = null;
    modal(title, [{ key: "t", label: fieldLabel, type: "textarea", req: 1, wide: 1 }], null, async o => { v = o.t; }, { size: "sm", saveText: "Confirm", sub });
    dlg().addEventListener("close", () => res(v), { once: true });
  });
}

// ============================================================ RENDER HELPERS
const pageHead = (title, sub = "", actions = "") => `<div class="ph"><div><h1>${esc(title)}</h1>${sub ? `<p>${sub}</p>` : ""}</div><div class="bar">${actions}</div></div>`;
function cellHtml(c, r) {
  if (c.html) return c.html(r);
  const v = r[c.key];
  if (c.money) return esc(inr(v));
  if (c.date) return esc(fmtDate(v));
  return esc(c.fmt ? c.fmt(r) : v ?? "");
}
function tableHtml(cols, rows, { actions, rowClass, sort } = {}) {
  return `<table><thead><tr>${cols.map(c => `<th class="${c.money || c.num ? "num" : ""} ${c.nosort ? "" : "sortable"} ${sort?.k === c.key ? (sort.d > 0 ? "asc" : "desc") : ""}" data-k="${esc(c.key)}">${esc(c.label)}</th>`).join("")}${actions ? '<th class="num"><span class="hidden">Actions</span></th>' : ""}</tr></thead>
  <tbody>${rows.map(r => `<tr data-id="${esc(r.id)}" class="${rowClass ? rowClass(r) : ""}">${cols.map(c => `<td class="${c.money || c.num ? "num" : ""}">${cellHtml(c, r)}</td>`).join("")}${actions ? `<td class="act">${actions(r)}</td>` : ""}</tr>`).join("")}</tbody></table>`;
}
const sortRows = (rows, cols, sort) => {
  if (!sort) return rows; const c = cols.find(x => x.key === sort.k);
  const val = r => c?.sortVal ? c.sortVal(r) : (r[sort.k] ?? (c?.fmt ? c.fmt(r) : ""));
  return [...rows].sort((a, b) => { const x = val(a), y = val(b); return (typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "en", { numeric: true })) * sort.d; });
};
const waNum = p => normPhone(p).replace(/\D/g, "");   // includes country code (10-digit numbers default to +91)
const phoneLinks = p => p ? `<span class="ph-row"><span>${esc(p)}</span><a class="pbtn call" href="tel:${esc(p)}" title="Call" aria-label="Call ${esc(p)}">${ico("phone")}</a><a class="pbtn wa" href="https://wa.me/${waNum(p)}" target="_blank" rel="noopener" title="Message on WhatsApp">${ico("chat")}WhatsApp</a></span>` : "—";

// ============================================================ GENERIC LIST MODULE
function listModule(cfg) {
  const { mod, coll, title, singular, subtitle = "", cols, fields, editFields, scoped = true, searchKey, searchLabel, filters = [], rowActions, onRowAction, beforeSave, docId, auditSummary, afterSave } = cfg;
  return async () => {
    const m = $("#main"), PS = 25;
    let cursors = [], pageNo = 0, page = [], fv = {}, term = "", sort = null, showArch = false, hasNext = false;
    const allCols = () => [...(scoped && RESORT === "all" ? [{ key: "resortId", label: "Resort", fmt: r => resortName(r.resortId), sortVal: r => resortName(r.resortId) }] : []), ...cols];
    m.innerHTML = pageHead(title, esc(subtitle), `${can(mod, "export") ? `<button id="csv">${ico("download")}Export</button>` : ""}${can(mod, "add") ? `<button class="primary" id="add">${ico("plus")}New ${esc(singular)}</button>` : ""}`) +
      `<div class="card"><div class="toolbar">${searchKey ? `<div class="search sm">${ico("search")}<input id="q" type="search" placeholder="${esc(searchLabel || "Search")}…" aria-label="Search"></div>` : ""}
      ${filters.map(f => `<select data-f="${f.key}" aria-label="${esc(f.label)}"><option value="">All ${esc(f.label)}</option>${f.opts.map(o => `<option value="${esc(o)}">${esc(HK_LABEL[o] || label(o))}</option>`).join("")}</select>`).join("")}
      ${can(mod, "delete") ? `<label class="chk"><input type="checkbox" id="arch"> Show archived</label>` : ""}<span class="sp"></span><span id="cnt" class="muted"></span></div>
      <div class="tw" id="tbl">${SK}</div><div class="pager"><span id="pg" class="muted"></span><button id="prev" class="sm">← Prev</button><button id="next" class="sm">Next →</button></div></div>`;
    const cons = () => {
      const c = [...(scoped ? scopeC() : [])];
      for (const [k, v] of Object.entries(fv)) if (v) c.push(where(k, "==", v));
      return c;
    };
    const load = async () => {
      $("#tbl").innerHTML = SK;
      try {
        if (term && searchKey) {   // search: match anywhere in the text, any case
          const t = term.toLowerCase(), s = await getDocs(query(collection(db, coll), ...cons(), limit(2000)));
          page = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => String(r[searchKey] ?? "").toLowerCase().includes(t) || String(r.phone ?? "").includes(t)).sort(byNewest); hasNext = false; render(); return;
        }
        const after = pageNo > 0 ? cursors[pageNo - 1] : null;
        const s = await getDocs(query(collection(db, coll), ...cons(), ...(after ? [startAfter(after)] : []), limit(PS)));
        page = s.docs.map(d => ({ id: d.id, ...d.data() })).sort(byNewest); cursors[pageNo] = s.docs[s.docs.length - 1]; hasNext = s.size === PS; render();
      } catch (e) { $("#tbl").innerHTML = errBox(e); $("#cnt").textContent = ""; }
    };
    const reset = () => { cursors = []; pageNo = 0; load(); };
    const render = () => {
      const rows = sortRows(showArch ? page : page.filter(r => !r.archived), allCols(), sort);
      $("#cnt").textContent = rows.length ? `${rows.length} shown` : ""; $("#pg").textContent = `Page ${pageNo + 1}`;
      $("#prev").disabled = pageNo === 0; $("#next").disabled = !hasNext;
      if (!rows.length) { $("#tbl").innerHTML = emptyBox(term || Object.values(fv).some(Boolean) ? "No matches" : `No ${title.toLowerCase()} yet`, ""); return; }
      $("#tbl").innerHTML = tableHtml(allCols(), rows, {
        sort, rowClass: r => r.archived ? "arch" : "",
        actions: r => {
          const a = [...(rowActions && !r.archived ? rowActions(r) : [])];
          if (can(mod, "edit") && !r.archived) a.push(["edit", "Edit"]);
          if (can(mod, "delete")) a.push(r.archived ? ["restore", "Restore"] : ["archive", "Archive", "danger"]);
          return a.map(([k, l, cls]) => `<button class="sm ${cls || ""}" data-a="${k}" data-i="${esc(r.id)}">${esc(l)}</button>`).join("");
        }
      });
      $$("th.sortable", $("#tbl")).forEach(h => h.onclick = () => { sort = { k: h.dataset.k, d: sort?.k === h.dataset.k ? -sort.d : 1 }; render(); });
      $$("[data-a]", $("#tbl")).forEach(b => b.onclick = () => act(b.dataset.a, page.find(x => x.id === b.dataset.i)));
    };
    const act = async (a, r) => {
      if (a === "edit") return edit(r);
      if (a === "archive" || a === "restore") {
        const arch = a === "archive";
        if (!await confirmBox(arch ? `Archive this ${singular}? It will be hidden from lists but kept for records.` : `Restore this ${singular}?`, { ok: arch ? "Archive" : "Restore", danger: arch })) return;
        try { await updateDoc(doc(db, coll, r.id), { archived: arch, ...stamp(false) }); audit(a, mod, r.id, r.resortId); toast(arch ? "Archived" : "Restored", "success"); load(); afterSave?.(); } catch (e) { fail(e); }
        return;
      }
      onRowAction?.(a, r, load);
    };
    const edit = rec => {
      if (!rec && scoped && RESORT === "all") return toast("Select a resort from the top bar first.", "warn");
      modal(rec ? `Edit ${singular}` : `New ${singular}`, rec && editFields ? editFields : fields, rec, async o => {
        if (beforeSave) o = await beforeSave(o, rec);
        if (rec) { await updateDoc(doc(db, coll, rec.id), { ...o, ...stamp(false) }); audit("update", mod, rec.id, rec.resortId, auditSummary?.(o) || ""); }
        else {
          if (scoped) o.resortId = RESORT;
          const data = { ...o, archived: false, ...stamp(true) };
          if (docId) {
            const id = docId(o), ref = doc(db, coll, id);
            if ((await getDoc(ref)).exists()) throw new Error(`A ${singular} with this ${cfg.docIdLabel || "ID"} already exists.`);
            await setDoc(ref, data); audit("create", mod, id, o.resortId, auditSummary?.(o) || "");
          } else { const r = newRef(coll); await setDoc(r, data); audit("create", mod, r.id, o.resortId, auditSummary?.(o) || ""); }
        }
        toast(`${label(singular)} saved`, "success"); reset(); afterSave?.();
      }, { sub: scoped && !rec ? resortName(RESORT) : "" });
    };
    $("#add")?.addEventListener("click", () => edit(null));
    let t; $("#q") && ($("#q").oninput = e => { clearTimeout(t); t = setTimeout(() => { term = e.target.value.trim(); reset(); }, 350); });
    $$("[data-f]", m).forEach(s => s.onchange = () => { fv[s.dataset.f] = s.value; reset(); });
    $("#arch") && ($("#arch").onchange = e => { showArch = e.target.checked; render(); });
    $("#prev").onclick = () => { if (pageNo > 0) { pageNo--; load(); } };
    $("#next").onclick = () => { if (hasNext) { pageNo++; load(); } };
    $("#csv")?.addEventListener("click", async () => {
      try {
        const s = await getDocs(query(collection(db, coll), ...cons(), limit(5000)));
        const rows = s.docs.map(d => ({ id: d.id, ...d.data() })).filter(r => showArch || !r.archived);
        exportCSV(`${coll}-${today()}`, [{ label: "ID", key: "id" }, ...allCols().map(c => ({ label: c.label, key: c.key, csv: c.csv || (c.money || c.date ? null : c.fmt) }))], rows);
        audit("export", mod, "", RESORT === "all" ? null : RESORT, `${rows.length} rows`); toast(`Exported ${rows.length} rows`, "success");
      } catch (e) { fail(e); }
    });
    load();
  };
}

// ============================================================ MODULES
const M = {};

// ---------- Dashboard
function vbars(data, { fmt = v => v, max, cls = "" } = {}) {
  if (!data.length) return emptyBox("No data yet");
  const W = 620, H = 190, L = 44, top = 14, n = data.length, bw = (W - L) / n, mx = max || Math.max(1, ...data.map(d => d[1]));
  const y = v => top + (H - top) * (1 - v / mx);
  return `<svg viewBox="0 0 ${W} ${H + 26}" class="chart" role="img">${[0, .5, 1].map(g => `<line x1="${L}" x2="${W}" y1="${y(mx * g)}" y2="${y(mx * g)}" class="gl"/><text x="${L - 8}" y="${y(mx * g) + 4}" class="ax" text-anchor="end">${esc(fmt(mx * g))}</text>`).join("")}
  ${data.map(([k, v, tip], i) => { const x = L + i * bw + bw * .2, w = bw * .6, yy = y(Math.max(v, 0)); return `<g><title>${esc(k)}: ${esc(tip ?? fmt(v))}</title><rect x="${x}" y="${yy}" width="${w}" height="${Math.max(H - yy, 1)}" rx="4" class="bar ${cls}"/><text x="${x + w / 2}" y="${H + 17}" class="ax" text-anchor="middle">${esc(k)}</text></g>`; }).join("")}</svg>`;
}
function hbars(obj, fmt = v => v) {
  const e = Object.entries(obj).sort((a, b) => b[1] - a[1]); if (!e.length) return emptyBox("No data yet");
  const mx = Math.max(...e.map(x => x[1]), 1);
  return `<div class="hb">${e.map(([k, v]) => `<div><span>${esc(label(k))}</span><span><i style="width:${Math.max(2, v / mx * 100)}%"></i></span><span>${esc(fmt(v))}</span></div>`).join("")}</div>`;
}
M.dashboard = async () => {
  const m = $("#main"), T = today();
  const hr = new Date().getHours(), greet = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
  m.innerHTML = pageHead(`${greet}, ${String(ME.name || "").split(" ")[0] || "there"}`, `${esc(RESORT === "all" ? "All resorts" : resortName(RESORT))} · ${esc(new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}`,
    can("bookings", "add") ? `<button class="primary" id="dnb">${ico("plus")}New booking</button>` : "") + `<div id="dash">${SK}${SK}</div>`;
  $("#dnb")?.addEventListener("click", () => newBooking());
  const mStart = T.slice(0, 8) + "01", mEndD = new Date(T + "T00:00:00Z"); mEndD.setUTCMonth(mEndD.getUTCMonth() + 1, 1);
  const mEnd = mEndD.toISOString().slice(0, 10), fEnd = addDays(T, 15), winEnd = mEnd > fEnd ? mEnd : fEnd;
  const sixStart = new Date(); sixStart.setMonth(sixStart.getMonth() - 5, 1); sixStart.setHours(0, 0, 0, 0);
  const sc = scopeC(), C = n => collection(db, n), errs = [];
  const safe = (ok, qy) => ok ? getDocs(qy).then(s => s.docs.map(d => ({ id: d.id, ...d.data() }))).catch(e => { errs.push(e); console.warn(e); return null; }) : Promise.resolve(null);
  const bv = can("bookings");
  const [rooms, arr, dep, inh, holds, win, pays, leads] = await Promise.all([
    safe(can("rooms") || can("bookings", "add"), query(C("rooms"), ...sc, limit(1000))),
    safe(bv, query(C("bookings"), ...sc, where("checkIn", "==", T), limit(300))),
    safe(bv, query(C("bookings"), ...sc, where("checkOut", "==", T), limit(300))),
    safe(bv, query(C("bookings"), ...sc, where("status", "==", "checked_in"), limit(1000))),
    safe(bv, query(C("bookings"), ...sc, where("status", "==", "hold"), limit(300))),
    bv ? Promise.all(chunks(nights(addDays(mStart, -61), winEnd)).map(ds => safe(true, query(C("bookings"), ...sc, where("checkIn", "in", ds), limit(2000))))).then(a => a.some(x => x === null) ? null : a.flat()) : Promise.resolve(null),
    safe(can("payments"), query(C("payments"), ...sc, limit(5000))).then(a => a && a.filter(p => p.createdAt?.toMillis && p.createdAt.toMillis() >= sixStart.getTime())),
    safe(can("leads"), query(C("leads"), ...sc, limit(500)))
  ]);
  if (CURRENT !== "dashboard") return;
  const R = (rooms || []).filter(r => !r.archived && r.active !== false);
  const sellable = R.filter(r => !["maintenance", "out_of_service", "blocked"].includes(r.opStatus)).length;
  const occ = new Set((inh || []).flatMap(b => b.roomIds || [])).size;
  const LIVE = ["confirmed", "checked_in", "checked_out"], W = (win || []).filter(b => LIVE.includes(b.status));
  const rate = b => b.roomNights ? ((b.roomRevenue || 0) - (b.discount || 0)) / b.roomNights : 0;
  const overlap = (b, a, z) => { const s = b.checkIn > a ? b.checkIn : a, e = b.checkOut < z ? b.checkOut : z; return s < e ? nights(s, e).length : 0; };
  const mtdEnd = addDays(T, 1), daysMTD = nights(mStart, mtdEnd).length;
  let soldMTD = 0, revMTD = 0, otbRN = 0, otbRev = 0; const src = {};
  W.forEach(b => { const rc = (b.roomIds || []).length || 1, o1 = overlap(b, mStart, mtdEnd) * rc, o2 = overlap(b, mStart, mEnd) * rc; soldMTD += o1; revMTD += o1 * rate(b); otbRN += o2; otbRev += o2 * rate(b); if (o2) src[b.source || "other"] = (src[b.source || "other"] || 0) + 1; });
  const occMTD = sellable && daysMTD ? soldMTD / (sellable * daysMTD) * 100 : 0, adr = soldMTD ? revMTD / soldMTD : 0, revpar = sellable && daysMTD ? revMTD / (sellable * daysMTD) : 0;
  const fc = [...Array(14)].map((_, i) => { const dt = addDays(T, i), rn = W.filter(b => b.checkIn <= dt && b.checkOut > dt && b.status !== "checked_out").reduce((s, b) => s + (b.roomIds || []).length, 0); const p = sellable ? Math.min(100, rn / sellable * 100) : 0; return [fmtDay(dt).split(" ")[0] + (i % 7 === 0 ? " " + fmtDay(dt).split(" ")[1] : ""), p, `${p.toFixed(0)}% · ${rn} rooms`]; });
  const P = pays || [], net = p => p.type === "refund" ? -(p.amount || 0) : (p.amount || 0);
  const mtdPays = P.filter(p => tsISO(p.createdAt) >= mStart), todayPays = P.filter(p => tsISO(p.createdAt) === T);
  const byMonth = {}; for (let i = 5; i >= 0; i--) { const d = new Date(); d.setMonth(d.getMonth() - i, 1); byMonth[localISO(d).slice(0, 7)] = 0; }
  P.forEach(p => { const k = tsISO(p.createdAt).slice(0, 7); if (k in byMonth) byMonth[k] += net(p); });
  const A = arr || [], D = dep || [], I = inh || [], Lds = leads || [];
  const arrPending = A.filter(b => ["confirmed", "hold"].includes(b.status)), arrDone = A.filter(b => b.status === "checked_in");
  const depPending = D.filter(b => b.status === "checked_in"), depDone = D.filter(b => b.status === "checked_out");
  const openLeads = Lds.filter(l => !LEAD_CLOSED.includes(l.status) && !l.archived), overdue = openLeads.filter(l => l.nextFollowUp && l.nextFollowUp < T), dueToday = openLeads.filter(l => l.nextFollowUp === T);
  const k = [];
  if (bv) k.push(
    ["Occupancy today", sellable ? (occ / sellable * 100).toFixed(0) + "%" : "—", `${occ} of ${sellable} sellable rooms`, true],
    ["Arrivals today", arrPending.length, `${arrDone.length} already checked in`],
    ["Departures today", depPending.length, `${depDone.length} already checked out`],
    ["In-house", I.length, `${sum(I, b => (b.adults || 0) + (b.children || 0))} guests`],
    ["Occupancy MTD", occMTD.toFixed(1) + "%", `${soldMTD} room-nights sold`],
    ["ADR (MTD)", inr(adr), "Avg. net room rate"],
    ["RevPAR (MTD)", inr(revpar), "Room revenue ÷ available rooms"],
    ["Month on the books", inrK(otbRev), `${otbRN} room-nights (confirmed)`],
    ["Balance due (in-house)", inr(sum(I, balance)), "Collect before check-out", false, sum(I, balance) > 0 ? '<span class="badge b-bad blink">Due</span>' : '<span class="badge b-ok">Clear</span>'],
    ["Tentative holds", (holds || []).length, `Auto-release after ${HOLD_HOURS}h`]);
  if (can("payments")) k.push(["Collections MTD", inrK(sum(mtdPays, net)), `${inr(sum(todayPays, net))} today`]);
  if (can("leads")) k.push(["Open leads", openLeads.length, `${overdue.length} overdue · ${dueToday.length} due today`]);
  const miniTable = (rows, kind) => rows.length ? `<div class="tw"><table><thead><tr><th>Guest</th><th>Rooms</th><th class="num">${kind === "arr" ? "Nights" : "Balance"}</th><th>Status</th><th></th></tr></thead><tbody>${rows.map(b => `<tr class="click" data-open="${esc(b.id)}"><td>${esc(b.customerName)}<span class="sub">${esc(bookingRef(b))}</span></td><td>${esc((b.roomNumbers || []).join(", "))}</td><td class="num">${kind === "arr" ? esc(b.nights) : balance(b) > 0 ? `<span class="badge b-bad blink">${esc(inr(balance(b)))}</span>` : esc(inr(0))}</td><td>${badge(b.status)}</td><td class="act">${can("bookings", "edit") ? (kind === "arr" && b.status === "confirmed" ? `<button class="sm primary" data-st="checked_in" data-i="${esc(b.id)}">Check in</button>` : kind === "dep" && b.status === "checked_in" ? `<button class="sm primary" data-st="checked_out" data-i="${esc(b.id)}">Check out</button>` : "") : ""}</td></tr>`).join("")}</tbody></table></div>` : emptyBox(kind === "arr" ? "No arrivals today" : "No departures today");
  const idxErr = errs.find(e => e?.code === "failed-precondition");
  $("#dash").innerHTML = `${errs.length ? `<div class="notice">Some figures couldn't be loaded.${idxErr ? ` A database index is needed – <a href="${esc(String(idxErr.message).match(/https:\/\/console\.firebase\.google\.com\S+/)?.[0] || "#")}" target="_blank" rel="noopener">tap here to create it</a>, then tap <b>Save</b> and wait 2–5 minutes.` : ""}</div>` : ""}
   <div class="kpis">${k.map(([l, v, s, hl, bd]) => `<div class="card kpi${hl ? " hl" : ""}"><div class="l">${esc(l)}${bd ? " " + bd : ""}</div><div class="v">${esc(v)}</div><div class="s">${esc(s)}</div></div>`).join("")}</div>
   ${bv ? `<div class="grid2"><div class="card"><div class="card-h"><h3>Today's arrivals</h3><span class="muted">${A.length}</span></div>${miniTable([...arrPending, ...arrDone], "arr")}</div>
   <div class="card"><div class="card-h"><h3>Today's departures</h3><span class="muted">${D.length}</span></div>${miniTable([...depPending, ...depDone], "dep")}</div></div>
   <div class="grid2"><div class="card"><div class="card-h"><h3>Occupancy forecast · next 14 days</h3></div><div class="pad">${sellable ? vbars(fc, { fmt: v => Math.round(v) + "%", max: 100 }) : emptyBox("Add rooms to see occupancy")}</div></div>
   ${can("payments") ? `<div class="card"><div class="card-h"><h3>Collections · last 6 months</h3><span class="muted">net of refunds</span></div><div class="pad">${vbars(Object.entries(byMonth).map(([mm, v]) => [new Date(mm + "-01T00:00:00").toLocaleDateString("en-IN", { month: "short" }), v, inr(v)]), { fmt: inrK, cls: "alt" })}</div></div>`
        : `<div class="card"><div class="card-h"><h3>Booking sources · this month</h3></div><div class="pad">${hbars(src)}</div></div>`}</div>` : ""}
   ${can("payments") && bv ? `<div class="grid2"><div class="card"><div class="card-h"><h3>Booking sources · this month</h3></div><div class="pad">${hbars(src)}</div></div>${can("leads") ? `<div class="card"><div class="card-h"><h3>Follow-ups needing attention</h3><span class="muted">${overdue.length + dueToday.length}</span></div>${[...overdue, ...dueToday].length ? `<div class="tw"><table><tbody>${[...overdue, ...dueToday].slice(0, 8).map(l => `<tr><td>${esc(l.name)}<span class="sub">${phoneLinks(l.phone)}</span></td><td>${badge(l.status)}</td><td class="num">${l.nextFollowUp < T ? badge("overdue", "Overdue · " + fmtDay(l.nextFollowUp)) : badge("follow_up", "Today")}</td></tr>`).join("")}</tbody></table></div>` : emptyBox("All caught up", "No overdue follow-ups.")}</div>` : ""}</div>` : ""}
   ${!bv && can("leads") ? `<div class="card"><div class="card-h"><h3>Follow-ups needing attention</h3></div>${[...overdue, ...dueToday].length ? `<div class="tw"><table><tbody>${[...overdue, ...dueToday].map(l => `<tr><td>${esc(l.name)}<span class="sub">${phoneLinks(l.phone)}</span></td><td>${badge(l.status)}</td><td class="num">${esc(fmtDate(l.nextFollowUp))}</td></tr>`).join("")}</tbody></table></div>` : emptyBox("All caught up")}</div>` : ""}
   <p class="muted" style="font-size:12px;margin-top:6px">Occupancy = occupied ÷ sellable rooms (excludes maintenance / out-of-service / blocked). ADR & RevPAR use net room revenue (after discount, before GST) for stays this month to date. Holds are excluded from forecasts.</p>`;
  $$("[data-open]", $("#dash")).forEach(tr => tr.onclick = e => { if (e.target.closest("button,a")) return; openBooking(tr.dataset.open); });
  $$("[data-st]", $("#dash")).forEach(b => b.onclick = async () => { const bk = [...A, ...D].find(x => x.id === b.dataset.i); if (await changeStatus(bk, b.dataset.st)) M.dashboard(); });
};

// ---------- Resorts
M.resorts = listModule({
  mod: "resorts", coll: "resorts", title: "Resorts", singular: "resort", subtitle: "Properties, tax details and policies", scoped: false, searchKey: "name", searchLabel: "Search resort",
  cols: [{ key: "code", label: "Code", html: r => `<span class="mono">${esc(r.code)}</span>` }, { key: "name", label: "Resort", html: r => `${esc(r.name)}<span class="sub">${esc([r.city, r.state].filter(Boolean).join(", "))}</span>` }, { key: "phone", label: "Phone" }, { key: "gst", label: "GSTIN", html: r => `<span class="mono">${esc(r.gst || "—")}</span>` }, { key: "checkInTime", label: "Check-in / out", fmt: r => `${r.checkInTime || "—"} / ${r.checkOutTime || "—"}` }, { key: "status", label: "Status", html: r => badge(r.status) }],
  fields: [{ key: "name", label: "Resort name", req: 1 }, { key: "code", label: "Short code", req: 1, pattern: "[A-Za-z0-9]{2,6}", title: "2–6 letters/numbers", hint: "Used as booking reference prefix" }, { key: "city", label: "City" }, { key: "state", label: "State" }, { key: "country", label: "Country", def: "India" }, { key: "pincode", label: "PIN code" }, { key: "phone", label: "Phone" }, { key: "email", label: "Email", type: "email" }, { key: "gst", label: "GSTIN", pattern: "[0-9A-Z]{15}", title: "15-character GSTIN" }, { key: "status", label: "Status", type: "select", opts: ["active", "inactive"], def: "active" }, { key: "checkInTime", label: "Check-in time", def: "14:00", type: "time" }, { key: "checkOutTime", label: "Check-out time", def: "11:00", type: "time" }, { key: "address", label: "Address", type: "textarea", wide: 1 }, { key: "cancellationPolicy", label: "Cancellation policy (printed on confirmations)", type: "textarea", wide: 1 }],
  beforeSave: async o => { o.code = o.code.toUpperCase(); o.gst = (o.gst || "").toUpperCase(); return o; },
  auditSummary: o => o.name,
  afterSave: () => loadResorts()
});

// ---------- Rooms
M.rooms = listModule({
  mod: "rooms", coll: "rooms", title: "Rooms", singular: "room", subtitle: "Inventory, tariffs and operational status", searchKey: "number", searchLabel: "Search room",
  filters: [{ key: "category", label: "categories", opts: ROOM_CATS }, { key: "opStatus", label: "statuses", opts: ["available", "maintenance", "out_of_service", "blocked"] }],
  cols: [{ key: "number", label: "Room", html: r => `<b>${esc(r.number)}</b>${r.beds ? `<span class="sub">${esc(r.beds)}</span>` : ""}` }, { key: "category", label: "Category" }, { key: "maxOcc", label: "Max guests", num: 1 }, { key: "baseRate", label: "Rate / night", money: 1 }, { key: "opStatus", label: "Operational", html: r => badge(r.opStatus) }, { key: "hkStatus", label: "Housekeeping", html: r => badge(r.hkStatus) }],
  fields: [{ key: "number", label: "Room number / name", req: 1 }, { key: "category", label: "Category", type: "select", opts: ROOM_CATS.map(c => [c, c]) }, { key: "maxOcc", label: "Max occupancy", type: "number", def: 2, min: 1, max: 20 }, { key: "baseRate", label: "Rate per night (₹, before GST)", type: "number", def: 0, min: 0 }, { key: "beds", label: "Bed configuration", ph: "e.g. 1 King" }, { key: "view", label: "View / location", ph: "e.g. Pool view" }, { key: "opStatus", label: "Operational status", type: "select", opts: ["available", "maintenance", "out_of_service", "blocked"], def: "available" }, { key: "hkStatus", label: "Housekeeping status", type: "select", opts: [["ready", "Clean & ready"], ["cleaning_required", "Dirty"], ["cleaning_in_progress", "Cleaning"]], def: "ready" }],
  beforeSave: async o => { if (o.baseRate < 0) throw new Error("Rate cannot be negative"); return o; },
  auditSummary: o => `Room ${o.number}`
});

// ---------- Customers (doc id = mobile, shared with bookings)
M.customers = listModule({
  mod: "customers", coll: "customers", title: "Guests", singular: "guest", subtitle: "Guest profiles shared across all resorts", scoped: false, searchKey: "name", searchLabel: "Search name or mobile",
  filters: [{ key: "category", label: "categories", opts: ["regular", "vip", "corporate"] }],
  cols: [{ key: "name", label: "Guest", html: r => `${esc(r.name)}${r.category && r.category !== "regular" ? ` <span class="pill ${r.category === "vip" ? "gold" : ""}">${esc(r.category.toUpperCase())}</span>` : ""}<span class="sub">${esc(r.email || "")}</span>` }, { key: "phone", label: "Mobile", html: r => phoneLinks(r.phone) }, { key: "city", label: "City" }, { key: "company", label: "Company" }],
  fields: [{ key: "phone", label: "Mobile", req: 1, pattern: "\\+?[0-9 \\-]{8,16}", title: "8–15 digits", type: "tel", hint: "Indian numbers: 10 digits. Others: start with + and country code." }, { key: "name", label: "Full name", req: 1 }, { key: "email", label: "Email", type: "email" }, { key: "city", label: "City" }, { key: "company", label: "Company" }, { key: "gstin", label: "Guest GSTIN (B2B invoices)" }, { key: "category", label: "Category", type: "select", opts: ["regular", "vip", "corporate"], def: "regular" }, { key: "dob", label: "Date of birth", type: "date" }, { key: "notes", label: "Preferences & notes", type: "textarea", wide: 1 }],
  get editFields() { return this.fields.map(f => f.key === "phone" ? { ...f, disabled: 1, req: 0, hint: "Mobile is the guest ID and can't be changed" } : f); },
  docId: o => o.phone, docIdLabel: "mobile",
  beforeSave: async (o, rec) => { if (!rec) { o.phone = normPhone(o.phone); if (o.phone.replace(/\D/g, "").length < 8) throw new Error("Enter a valid mobile number"); const dup = await getDocs(query(collection(db, "customers"), where("phone", "in", phoneVariants(o.phone)), limit(1))); if (!dup.empty) throw new Error("A guest with this mobile already exists."); } o.gstin = (o.gstin || "").toUpperCase(); return o; },
  rowActions: r => can("bookings") ? [["history", "Stays"]] : [],
  onRowAction: (a, r) => { if (a === "history") customerHistory(r); },
  auditSummary: o => o.name
});
async function customerHistory(c) {
  const d = openDialog(`<div class="dh"><div><div class="eyebrow">Guest history</div><h3>${esc(c.name)}</h3><p>${esc(c.phone || c.id)}</p></div>${closeBtn}</div><div class="db" id="ch">${SK}</div>`, { size: "lg" });
  try {
    const s = await getDocs(query(collection(db, "bookings"), ...scopeC(), where("customerPhone", "in", phoneVariants(c.phone || c.id)), limit(200)));
    const rows = s.docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => b.checkIn.localeCompare(a.checkIn)), live = rows.filter(b => !["cancelled", "no_show"].includes(b.status));
    $("#ch").innerHTML = `<div class="kpis"><div class="card kpi"><div class="l">Stays</div><div class="v">${live.length}</div></div><div class="card kpi"><div class="l">Nights</div><div class="v">${sum(live, "nights")}</div></div><div class="card kpi"><div class="l">Lifetime value</div><div class="v">${inr(sum(live, "total"))}</div></div><div class="card kpi"><div class="l">Last stay</div><div class="v" style="font-size:18px">${esc(fmtDate(live[0]?.checkIn))}</div></div></div>
    ${rows.length ? `<div class="card"><div class="tw"><table><thead><tr><th>Ref</th><th>Resort</th><th>Stay</th><th class="num">Total</th><th>Status</th></tr></thead><tbody>${rows.map(b => `<tr class="click" data-open="${esc(b.id)}"><td class="mono">${esc(bookingRef(b))}</td><td>${esc(resortName(b.resortId))}</td><td>${esc(fmtDate(b.checkIn))} → ${esc(fmtDate(b.checkOut))}</td><td class="num">${inr(b.total)}</td><td>${badge(b.status)}</td></tr>`).join("")}</tbody></table></div></div>` : emptyBox("No bookings yet")}`;
    $$("[data-open]", d).forEach(tr => tr.onclick = () => openBooking(tr.dataset.open));
  } catch (e) { $("#ch").innerHTML = errBox(e); }
}

// ---------- Leads
M.leads = listModule({
  mod: "leads", coll: "leads", title: "Leads", singular: "lead", subtitle: "Enquiries and telecalling pipeline", searchKey: "name", searchLabel: "Search name or mobile",
  filters: [{ key: "status", label: "statuses", opts: LEAD_STATUSES }],
  cols: [{ key: "name", label: "Lead", html: r => `${esc(r.name)}<span class="sub">${esc(label(r.source || ""))}</span>` }, { key: "phone", label: "Mobile", html: r => phoneLinks(r.phone) },
    { key: "arrival", label: "Stay", html: r => r.arrival ? `${esc(fmtDay(r.arrival))} → ${esc(fmtDay(r.departure))}<span class="sub">${esc(r.adults || 0)} adult(s)</span>` : '<span class="muted">—</span>' },
    { key: "status", label: "Status", html: r => badge(r.status) },
    { key: "nextFollowUp", label: "Next follow-up", html: r => { if (!r.nextFollowUp) return '<span class="muted">—</span>'; const od = r.nextFollowUp < today() && !LEAD_CLOSED.includes(r.status); return od ? badge("overdue", "Overdue · " + fmtDay(r.nextFollowUp)) : esc(fmtDate(r.nextFollowUp)); } },
    { key: "assignedTo", label: "Owner" }],
  fields: [{ key: "name", label: "Guest name", req: 1 }, { key: "phone", label: "Mobile", req: 1, type: "tel", pattern: "\\+?[0-9 \\-]{8,16}", title: "8–15 digits" }, { key: "email", label: "Email", type: "email" }, { key: "source", label: "Source", type: "select", opts: ["phone", "website", "walk-in", "agent", "social", "referral", "ota", "corporate"] }, { key: "arrival", label: "Arrival", type: "date" }, { key: "departure", label: "Departure", type: "date" }, { key: "adults", label: "Adults", type: "number", def: 2, min: 1 }, { key: "children", label: "Children", type: "number", def: 0, min: 0 }, { key: "budget", label: "Budget (₹)", type: "number", def: 0, min: 0 }, { key: "status", label: "Status", type: "select", opts: LEAD_STATUSES, def: "new" }, { key: "nextFollowUp", label: "Next follow-up", type: "date" }, { key: "assignedTo", label: "Owner (email)", type: "email", def: () => ME.email }, { key: "notes", label: "Call notes", type: "textarea", wide: 1 }],
  beforeSave: async (o, rec) => {
    o.phone = normPhone(o.phone);
    if (o.arrival && o.departure && o.departure <= o.arrival) throw new Error("Departure must be after arrival");
    if (!rec) { const s = await getDocs(query(collection(db, "leads"), where("resortId", "==", RESORT), where("phone", "in", phoneVariants(o.phone)), limit(1))); if (!s.empty) throw new Error("A lead with this mobile already exists for this resort"); }
    return o;
  },
  rowActions: r => can("bookings", "add") && !LEAD_CLOSED.includes(r.status) ? [["convert", "Book", "primary"]] : [],
  onRowAction: (a, r) => { if (a === "convert") { if (RESORT === "all" || RESORT !== r.resortId) { RESORT = r.resortId; $("#resortSel").value = r.resortId; } newBooking({ lead: r }); } },
  auditSummary: o => `${o.name} · ${o.status}`
});

// ---------- Maintenance
M.maintenance = listModule({
  mod: "maintenance", coll: "maintenanceRequests", title: "Maintenance", singular: "work order", subtitle: "Repairs and preventive maintenance", searchKey: "title", searchLabel: "Search issue",
  filters: [{ key: "status", label: "statuses", opts: ["pending", "in_progress", "done"] }, { key: "priority", label: "priorities", opts: ["low", "normal", "high", "critical"] }],
  cols: [{ key: "title", label: "Issue", html: r => `${esc(r.title)}<span class="sub">${esc(r.roomNumber || "General")}</span>` }, { key: "priority", label: "Priority", html: r => badge(r.priority) }, { key: "status", label: "Status", html: r => badge(r.status) }, { key: "estCost", label: "Est. cost", money: 1 }, { key: "createdAt", label: "Reported", fmt: r => fmtTs(r.createdAt), sortVal: r => r.createdAt?.seconds || 0 }],
  fields: [{ key: "title", label: "Problem", req: 1, wide: 1 }, { key: "roomNumber", label: "Room / area" }, { key: "category", label: "Type", type: "select", opts: ["electrical", "plumbing", "ac_hvac", "carpentry", "furniture", "appliance", "civil", "other"] }, { key: "priority", label: "Priority", type: "select", opts: ["low", "normal", "high", "critical"], def: "normal" }, { key: "status", label: "Status", type: "select", opts: ["pending", "in_progress", "done"], def: "pending" }, { key: "estCost", label: "Estimated cost (₹)", type: "number", def: 0, min: 0 }, { key: "assignee", label: "Assigned to" }, { key: "description", label: "Details / resolution notes", type: "textarea", wide: 1 }],
  rowActions: r => can("maintenance", "edit") ? (r.status === "pending" ? [["start", "Start"]] : r.status === "in_progress" ? [["resolve", "Resolve", "primary"]] : []) : [],
  onRowAction: async (a, r, reload) => { try { const s = a === "start" ? "in_progress" : "done"; await updateDoc(doc(db, "maintenanceRequests", r.id), { status: s, ...(s === "done" ? { resolvedAt: serverTimestamp(), resolvedBy: ME.uid } : {}), ...stamp(false) }); audit("status", "maintenance", r.id, r.resortId, s); toast("Updated", "success"); reload(); } catch (e) { fail(e); } },
  auditSummary: o => `${o.title} · ${o.status}`
});

// ============================================================ BOOKINGS
const nightRef = (roomId, date) => doc(db, "roomNights", roomId + "_" + date);
const TRANS = { hold: [["confirmed", "Confirm"], ["cancelled", "Cancel"]], confirmed: [["checked_in", "Check in"], ["no_show", "No-show"], ["cancelled", "Cancel"]], checked_in: [["checked_out", "Check out"]] };
const transitions = b => can("bookings", "edit") ? (TRANS[b.status] || []).filter(([s]) => ["checked_in", "no_show"].includes(s) ? b.checkIn <= today() : true) : [];

function priceBooking(sel, n, discount, gst) {
  const lines = sel.map(r => ({ roomId: r.id, number: r.number, category: r.category || "", rate: Number(r.baseRate || 0), nights: n, amount: round2(Number(r.baseRate || 0) * n) }));
  const roomRevenue = round2(sum(lines, "amount")), disc = round2(Math.min(Math.max(0, Number(discount || 0)), roomRevenue));
  lines.forEach(l => { const share = roomRevenue ? disc * l.amount / roomRevenue : 0; l.discount = round2(share); l.taxable = round2(l.amount - share); l.taxPct = gst === "auto" ? gstSlab(n ? l.taxable / n : 0) : Number(gst || 0); l.tax = round2(l.taxable * l.taxPct / 100); });
  const taxable = round2(roomRevenue - disc), tax = round2(sum(lines, "tax"));
  return { lines, roomRevenue, discount: disc, taxable, tax, total: round2(taxable + tax), taxPct: taxable ? round2(tax / taxable * 100) : 0, nights: n };
}

async function createBooking(o, roomDocs, p, lead) {
  const ns = nights(o.checkIn, o.checkOut), resort = resortById(o.resortId);
  const bref = newRef("bookings"), cref = doc(db, "customers", o.custId || o.phone), ref = makeRef(resort?.code);
  const status = o.type === "hold" ? "hold" : "confirmed";
  await runTransaction(db, async tx => {
    const cs = await tx.get(cref);
    const refs = roomDocs.flatMap(r => ns.map(n => ({ ref: nightRef(r.id, n), roomId: r.id, date: n })));
    const snaps = await Promise.all(refs.map(x => tx.get(x.ref)));
    const i = snaps.findIndex(s => s.exists());
    if (i >= 0) throw new Error(`Room ${roomDocs.find(r => r.id === refs[i].roomId)?.number} is already booked on ${fmtDate(refs[i].date)}. Pick another room or dates.`);
    if (!cs.exists()) tx.set(cref, { name: o.name, phone: o.phone, email: o.email || "", category: "regular", archived: false, ...stamp(true) });
    refs.forEach(x => tx.set(x.ref, { bookingId: bref.id, roomId: x.roomId, resortId: o.resortId, date: x.date, createdBy: ME.uid, createdAt: serverTimestamp() }));
    tx.set(bref, {
      ref, resortId: o.resortId, customerPhone: o.phone, customerName: o.name, customerEmail: o.email || "",
      roomIds: roomDocs.map(r => r.id), roomNumbers: roomDocs.map(r => r.number), checkIn: o.checkIn, checkOut: o.checkOut, nights: ns.length, roomNights: ns.length * roomDocs.length,
      adults: o.adults, children: o.children, source: o.source, roomRevenue: p.roomRevenue, discount: p.discount, taxable: p.taxable, taxPct: p.taxPct, tax: p.tax, total: p.total,
      amountPaid: 0, refunded: 0, paymentStatus: "unpaid", status, holdExpiresAt: status === "hold" ? Timestamp.fromMillis(Date.now() + HOLD_HOURS * 3600e3) : null,
      notes: o.notes || "", rateSnapshot: p.lines, leadId: lead?.id || null, archived: false, ...stamp(true)
    });
  });
  audit("create", "bookings", bref.id, o.resortId, `${ref} · ${status} · ${o.checkIn}→${o.checkOut} · ${inr(p.total)}`);
  if (lead) { try { await updateDoc(doc(db, "leads", lead.id), { status: "booking_confirmed", bookingId: bref.id, ...stamp(false) }); } catch (e) { console.warn("Lead not updated", e); } }
  return { id: bref.id, ref };
}

async function newBooking(pre = {}) {
  if (!can("bookings", "add")) return toast("You don't have permission to create bookings.", "warn");
  if (RESORT === "all") return toast("Select a resort from the top bar first.", "warn");
  const resortId = RESORT, resort = resortById(resortId), lead = pre.lead;
  const d = openDialog(`<div class="dh"><h3>New booking</h3>${closeBtn}</div><div class="db">${SK}</div>`, { size: "lg" });
  let rooms;
  try { rooms = (await getDocs(query(collection(db, "rooms"), where("resortId", "==", resortId), limit(500)))).docs.map(x => ({ id: x.id, ...x.data() })).filter(r => !r.archived && r.active !== false).sort((a, b) => String(a.number).localeCompare(String(b.number), "en", { numeric: true })); }
  catch (e) { d.innerHTML = `<div class="dh"><h3>New booking</h3>${closeBtn}</div><div class="db">${errBox(e)}</div>`; bindClose(d); return; }
  if (!rooms.length) { d.innerHTML = `<div class="dh"><h3>New booking</h3>${closeBtn}</div><div class="db">${emptyBox("No rooms set up", "Add rooms for this resort before taking bookings.")}</div>`; bindClose(d); return; }
  const T = today(), ci0 = lead?.arrival && lead.arrival >= T ? lead.arrival : T, co0 = lead?.departure && lead.departure > ci0 ? lead.departure : addDays(ci0, 1);
  d.innerHTML = `<form id="bf"><div class="dh"><div><h3>New booking</h3><p>${esc(resort?.name || "")}${lead ? ` · from lead ${esc(lead.name)}` : ""}</p></div>${closeBtn}</div>
  <div class="db"><div class="bk"><div>
   <h4>Guest</h4><div class="f2">
    <div class="fld"><label for="b_phone">Mobile <i>*</i></label><input id="b_phone" name="phone" type="tel" required pattern="\\+?[0-9 \\-]{8,16}" title="10 digits, or + country code for non-Indian numbers" placeholder="10 digits or +country code" value="${esc(lead?.phone || "")}" autocomplete="off"><div class="guest-hint" id="gh"></div></div>
    <div class="fld"><label for="b_name">Guest name <i>*</i></label><input id="b_name" name="name" required value="${esc(lead?.name || "")}"></div>
    <div class="fld"><label for="b_email">Email</label><input id="b_email" name="email" type="email" value="${esc(lead?.email || "")}"></div>
    <div class="fld"><label for="b_src">Source</label><select id="b_src" name="source">${["phone", "walk-in", "website", "agent", "ota", "corporate", "referral", "social"].map(s => `<option value="${s}" ${(lead?.source || "phone") === s ? "selected" : ""}>${label(s)}</option>`).join("")}</select></div>
   </div>
   <h4>Stay</h4><div class="f2">
    <div class="fld"><label for="b_ci">Check-in <i>*</i></label><input id="b_ci" name="checkIn" type="date" required min="${T}" value="${ci0}"></div>
    <div class="fld"><label for="b_co">Check-out <i>*</i></label><input id="b_co" name="checkOut" type="date" required min="${addDays(T, 1)}" value="${co0}"></div>
    <div class="fld"><label for="b_ad">Adults</label><input id="b_ad" name="adults" type="number" min="1" max="50" value="${esc(lead?.adults || 2)}"></div>
    <div class="fld"><label for="b_ch">Children</label><input id="b_ch" name="children" type="number" min="0" max="50" value="${esc(lead?.children || 0)}"></div>
   </div>
   <h4>Rooms <span id="availNote" class="muted" style="text-transform:none;letter-spacing:0;font-weight:500"></span></h4><div class="rooms" id="roomGrid"></div>
   <h4>Pricing</h4><div class="f2">
    <div class="fld"><label for="b_disc">Discount (₹)</label><input id="b_disc" name="discount" type="number" min="0" step="1" value="0"><small>${can("bookings", "approve") ? "You can approve any discount" : `Up to ${MAX_DISCOUNT_PCT}% of room charges`}</small></div>
    <div class="fld"><label for="b_gst">GST</label><select id="b_gst" name="gst"><option value="auto">Auto (by tariff slab)</option><option value="0">0%</option><option value="5">5%</option><option value="12">12%</option><option value="18">18%</option></select><small>Auto: ≤₹1,000 0% · ≤₹7,500 5% · above 18%</small></div>
    <div class="fld"><label for="b_type">Booking type</label><select id="b_type" name="type"><option value="confirmed">Confirmed</option><option value="hold">Tentative hold (${HOLD_HOURS}h)</option></select></div>
    <div class="fld"><label for="b_notes">Special requests</label><input id="b_notes" name="notes" placeholder="e.g. early check-in, cake"></div>
   </div>
  </div><aside class="quote" id="quote"></aside></div><div class="err" id="bErr" role="alert"></div></div>
  <div class="df"><button type="button" data-close>Cancel</button><button class="primary" id="bSave" type="submit">Create booking</button></div></form>`;
  bindClose(d);
  const f = $("#bf"), selected = new Set(); let busy = new Set(), seq = 0;
  const vals = () => { const v = Object.fromEntries(new FormData(f)); v.adults = Math.max(1, +v.adults || 1); v.children = Math.max(0, +v.children || 0); v.discount = Math.max(0, +v.discount || 0); return v; };
  const sel = () => rooms.filter(r => selected.has(r.id));
  const drawRooms = () => {
    $("#roomGrid").innerHTML = rooms.map(r => { const ooo = r.opStatus && r.opStatus !== "available", taken = busy.has(r.id), dis = ooo || taken; if (dis) selected.delete(r.id);
      return `<label class="room${selected.has(r.id) && !dis ? " sel" : ""}"><input type="checkbox" value="${esc(r.id)}" ${selected.has(r.id) ? "checked" : ""} ${dis ? "disabled" : ""}><b>${esc(r.number)}</b>${esc(r.category || "")} · ${esc(r.maxOcc || 1)} pax<br>${inr(r.baseRate)}/night${taken ? '<div class="st">Booked</div>' : ooo ? `<div class="st">${esc(label(r.opStatus))}</div>` : ""}</label>`; }).join("");
    $$("#roomGrid input").forEach(i => i.onchange = () => { i.checked ? selected.add(i.value) : selected.delete(i.value); i.closest(".room").classList.toggle("sel", i.checked); quote(); });
    quote();
  };
  const refreshAvail = async () => {
    const v = vals(); if (!(v.checkIn && v.checkOut && v.checkIn < v.checkOut)) { busy = new Set(); $("#availNote").textContent = "· choose valid dates"; drawRooms(); return; }
    const my = ++seq; $("#availNote").textContent = "· checking availability…";
    try {
      const ss = await Promise.all(chunks(nights(v.checkIn, v.checkOut)).map(ds => getDocs(query(collection(db, "roomNights"), where("resortId", "==", resortId), where("date", "in", ds), limit(5000)))));
      if (my !== seq) return; busy = new Set(ss.flatMap(s => s.docs.map(x => x.data().roomId)));
      const free = rooms.filter(r => !busy.has(r.id) && (!r.opStatus || r.opStatus === "available")).length;
      $("#availNote").textContent = `· ${free} of ${rooms.length} available`;
    } catch (e) { if (my !== seq) return; console.warn(e); busy = new Set(); $("#availNote").textContent = "· availability will be verified on save"; }
    drawRooms();
  };
  const quote = () => {
    const v = vals(), n = v.checkIn && v.checkOut && v.checkIn < v.checkOut ? nights(v.checkIn, v.checkOut).length : 0, s = sel(), p = priceBooking(s, n, v.discount, v.gst), cap = sum(s, r => r.maxOcc || 1);
    const warn = []; if (s.length && v.adults + v.children > cap) warn.push(`Guests exceed room capacity (${cap}).`);
    if (p.roomRevenue && v.discount > p.roomRevenue * MAX_DISCOUNT_PCT / 100 && !can("bookings", "approve")) warn.push(`Discount above ${MAX_DISCOUNT_PCT}% needs approval.`);
    $("#quote").innerHTML = `<div class="eyebrow">Summary</div><div style="font-weight:600;margin-bottom:10px">${n ? `${n} night${n > 1 ? "s" : ""} · ${fmtDay(v.checkIn)} → ${fmtDay(v.checkOut)}` : "Select dates"}</div>
     <div class="sum">${p.lines.map(l => `<div><span>Room ${esc(l.number)} <span class="muted">· ${inr(l.rate)} × ${n}</span></span><span>${inr2(l.amount)}</span></div>`).join("") || '<div class="muted">No rooms selected</div>'}
     ${p.discount ? `<div><span>Discount</span><span>− ${inr2(p.discount)}</span></div>` : ""}
     <div><span>Taxable value</span><span>${inr2(p.taxable)}</span></div><div><span>GST${p.taxPct ? ` (${p.taxPct}%)` : ""}</span><span>${inr2(p.tax)}</span></div>
     <div class="t"><span>Total</span><span>${inr2(p.total)}</span></div></div>
     ${warn.map(w => `<p class="err" style="margin:10px 0 0">${esc(w)}</p>`).join("")}`;
    return { v, n, s, p, warn, cap };
  };
  let lookT, custId = null; $("#b_phone").oninput = () => { clearTimeout(lookT); custId = null; lookT = setTimeout(async () => { const ph = normPhone($("#b_phone").value); $("#gh").textContent = ""; if (ph.replace(/\D/g, "").length < 8) return;
    try { let c = await getDoc(doc(db, "customers", ph)); if (!c.exists()) { const q2 = await getDocs(query(collection(db, "customers"), where("phone", "in", phoneVariants(ph)), limit(1))); if (!q2.empty) c = q2.docs[0]; } if (c.exists()) { custId = c.id; const g = c.data(); if (!$("#b_name").value) $("#b_name").value = g.name || ""; if (!$("#b_email").value) $("#b_email").value = g.email || ""; $("#gh").innerHTML = `<span class="pill ${g.category === "vip" ? "gold" : ""}">Returning guest${g.category && g.category !== "regular" ? " · " + esc(g.category.toUpperCase()) : ""}</span>`; } else $("#gh").innerHTML = '<span class="muted">New guest – profile will be created</span>'; } catch { } }, 400); };
  $("#b_ci").onchange = () => { if ($("#b_co").value <= $("#b_ci").value) $("#b_co").value = addDays($("#b_ci").value, 1); $("#b_co").min = addDays($("#b_ci").value, 1); refreshAvail(); };
  $("#b_co").onchange = refreshAvail;
  ["b_ad", "b_ch", "b_disc", "b_gst"].forEach(id => $("#" + id).addEventListener("input", quote));
  if (lead?.phone) $("#b_phone").dispatchEvent(new Event("input"));
  refreshAvail();
  f.onsubmit = async e => {
    e.preventDefault(); const b = $("#bSave"); if (b.disabled) return; $("#bErr").textContent = "";
    const { v, n, s, p, warn } = quote();
    try {
      v.phone = normPhone(v.phone); v.name = v.name.trim(); v.resortId = resortId; v.custId = custId;
      if (v.phone.replace(/\D/g, "").length < 8) throw new Error("Enter a valid mobile number.");
      if (!n) throw new Error("Check-out must be after check-in.");
      if (v.checkIn < today()) throw new Error("Check-in date is in the past.");
      if (n > 60) throw new Error("Bookings are limited to 60 nights.");
      if (!s.length) throw new Error("Select at least one room.");
      if (s.length * n > 450) throw new Error("Too many room-nights in one booking – split it into smaller bookings.");
      if (warn.length) throw new Error(warn[0]);
      b.disabled = true; b.classList.add("busy");
      const r = await createBooking(v, s, p, lead);
      toast(`Booking ${r.ref} created`, "success");
      if (["bookings", "dashboard", "leads"].includes(CURRENT)) M[CURRENT]();
      openBooking(r.id);
    } catch (er) { console.error(er); $("#bErr").textContent = errMsg(er); b.disabled = false; b.classList.remove("busy"); if (/already booked/.test(er.message || "")) refreshAvail(); }
  };
}

const SKEY = { confirmed: "confirmed", checked_in: "checkedIn", checked_out: "checkedOut", cancelled: "cancelled", no_show: "noShow" };
async function changeStatus(b, status) {
  if (!b) return false;
  let reason = "";
  try {
    if (status === "cancelled" || status === "no_show") { reason = await askText(status === "cancelled" ? "Cancel booking" : "Mark as no-show", `${bookingRef(b)} · ${b.customerName} · rooms will be released`); if (reason === null) return false; }
    else if (status === "checked_out") { const bal = balance(b); if (!await confirmBox(bal > 0 ? `${b.customerName} still owes ${inr2(bal)}. Check out anyway?` : `Check out ${b.customerName} from room ${(b.roomNumbers || []).join(", ")}? Rooms will be flagged for cleaning.`, { title: "Check out", ok: "Check out", danger: bal > 0 })) return false; }
    else if (status === "checked_in") { if (!await confirmBox(`Check in ${b.customerName} to room ${(b.roomNumbers || []).join(", ")}?`, { title: "Check in", ok: "Check in" })) return false; }
    else if (status === "confirmed") { if (!await confirmBox(`Confirm tentative booking ${bookingRef(b)}?`, { title: "Confirm booking", ok: "Confirm" })) return false; }
    await runTransaction(db, async tx => {
      const ref = doc(db, "bookings", b.id), s = await tx.get(ref); if (!s.exists()) throw new Error("Booking not found");
      const x = s.data(), cur = x.status;
      if (!(TRANS[cur] || []).some(([t]) => t === status)) throw new Error(`Can't change ${label(cur)} → ${label(status)} (it may have been updated by someone else).`);
      if (["cancelled", "no_show"].includes(status)) for (const r of x.roomIds || []) for (const n of nights(x.checkIn, x.checkOut)) tx.delete(nightRef(r, n));
      if (status === "checked_out") for (const r of x.roomIds || []) tx.update(doc(db, "rooms", r), { hkStatus: "cleaning_required", updatedAt: serverTimestamp(), updatedBy: ME.uid });
      tx.update(ref, { status, ...(status === "confirmed" ? { holdExpiresAt: null } : {}), ...(reason ? { cancelReason: reason } : {}), [SKEY[status] + "At"]: serverTimestamp(), [SKEY[status] + "By"]: ME.uid, ...stamp(false) });
    });
    audit("status", "bookings", b.id, b.resortId, `${bookingRef(b)} → ${status}${reason ? " · " + reason : ""}`);
    toast({ checked_in: "Guest checked in", checked_out: "Guest checked out", cancelled: "Booking cancelled", no_show: "Marked as no-show", confirmed: "Booking confirmed" }[status], "success");
    return true;
  } catch (e) { fail(e); return false; }
}

async function findBookings(term) {
  const t = term.trim(), out = new Map(), ph = normPhone(t), C = collection(db, "bookings");
  const qs = [query(C, ...scopeC(), where("ref", "==", t.toUpperCase()), limit(5))];
  if (/^\+?\d{8,15}$/.test(ph)) qs.push(query(C, ...scopeC(), where("customerPhone", "in", phoneVariants(t)), limit(100)));
  for (const q of qs) (await getDocs(q)).docs.forEach(x => out.set(x.id, { id: x.id, ...x.data() }));
  if (!out.size && /^[A-Za-z0-9]{20}$/.test(t)) { try { const x = await getDoc(doc(db, "bookings", t)); if (x.exists() && (RESORT === "all" || x.data().resortId === RESORT)) out.set(x.id, { id: x.id, ...x.data() }); } catch { } }
  return [...out.values()].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
}

M.bookings = async (opts = {}) => {
  const m = $("#main"), PS = 25; let status = opts.status || "", term = opts.term || "", rows = [], cursors = [], pageNo = 0, hasNext = false, sort = null;
  m.innerHTML = pageHead("Bookings", "Reservations, stays and guest folios", `${can("bookings", "export") ? `<button id="csv">${ico("download")}Export</button>` : ""}${can("bookings", "add") ? `<button class="primary" id="nb">${ico("plus")}New booking</button>` : ""}`) +
    `<div class="card"><div class="toolbar"><div class="search sm">${ico("search")}<input id="bq" type="search" placeholder="Booking ref or guest mobile" value="${esc(term)}" aria-label="Search bookings"></div>
    <select id="st" aria-label="Status"><option value="">All statuses</option>${BOOKING_STATUSES.map(s => `<option value="${s}" ${s === status ? "selected" : ""}>${label(s)}</option>`).join("")}</select><span class="sp"></span><span id="cnt" class="muted"></span></div>
    <div class="tw" id="tbl">${SK}</div><div class="pager"><span id="pg" class="muted"></span><button id="prev" class="sm">← Prev</button><button id="next" class="sm">Next →</button></div></div>`;
  $("#nb")?.addEventListener("click", () => newBooking());
  const cols = [
    ...(RESORT === "all" ? [{ key: "resortId", label: "Resort", fmt: r => resortName(r.resortId) }] : []),
    { key: "ref", label: "Booking", html: r => `<span class="mono">${esc(bookingRef(r))}</span><span class="sub">${esc(fmtTs(r.createdAt))}</span>`, sortVal: r => r.createdAt?.seconds || 0 },
    { key: "customerName", label: "Guest", html: r => `${esc(r.customerName)}<span class="sub">${esc(r.customerPhone)}</span>` },
    { key: "roomNumbers", label: "Rooms", fmt: r => (r.roomNumbers || []).join(", "), sortVal: r => (r.roomNumbers || []).join(",") },
    { key: "checkIn", label: "Stay", html: r => `${esc(fmtDay(r.checkIn))} → ${esc(fmtDay(r.checkOut))}<span class="sub">${esc(r.nights)} night${r.nights > 1 ? "s" : ""} · ${esc(r.adults)}A${r.children ? " " + esc(r.children) + "C" : ""}</span>` },
    { key: "total", label: "Total", money: 1 },
    { key: "balance", label: "Balance", html: r => { const bl = balance(r); return bl > 0 && !["cancelled", "no_show"].includes(r.status) ? `<b style="color:var(--bad)">${inr(bl)}</b>` : inr(Math.max(0, bl)); }, sortVal: balance, num: 1 },
    { key: "status", label: "Status", html: r => badge(r.status) },
    { key: "paymentStatus", label: "Payment", html: r => badge(r.paymentStatus) }];
  const load = async () => {
    $("#tbl").innerHTML = SK;
    try {
      if (term) { rows = await findBookings(term); hasNext = false; }
      else {
        const after = pageNo ? cursors[pageNo - 1] : null;
        const s = await getDocs(query(collection(db, "bookings"), ...scopeC(), ...(status ? [where("status", "==", status)] : []), ...(after ? [startAfter(after)] : []), limit(PS)));
        rows = s.docs.map(x => ({ id: x.id, ...x.data() })).sort(byNewest); cursors[pageNo] = s.docs[s.docs.length - 1]; hasNext = s.size === PS;
      }
      render();
    } catch (e) { $("#tbl").innerHTML = errBox(e); }
  };
  const render = () => {
    const rs = sortRows(term && status ? rows.filter(r => r.status === status) : rows, cols, sort);
    $("#cnt").textContent = rs.length ? `${rs.length} shown` : ""; $("#pg").textContent = term ? "Search results" : `Page ${pageNo + 1}`; $("#prev").disabled = term || pageNo === 0; $("#next").disabled = !hasNext;
    if (!rs.length) { $("#tbl").innerHTML = emptyBox(term ? "No bookings found" : "No bookings yet", term ? "Search by full booking reference (e.g. GOA-261013-AB12) or the guest's mobile number." : "", can("bookings", "add") && !term ? `<button class="primary" id="nb2">${ico("plus")}Create first booking</button>` : ""); $("#nb2")?.addEventListener("click", () => newBooking()); return; }
    $("#tbl").innerHTML = tableHtml(cols, rs, { sort, rowClass: () => "click", actions: r => transitions(r).slice(0, 1).map(([s, l]) => `<button class="sm ${s === "cancelled" ? "danger" : "primary"}" data-st="${s}" data-i="${esc(r.id)}">${esc(l)}</button>`).join("") + `<button class="sm" data-open="${esc(r.id)}">Open</button>` });
    $$("th.sortable", $("#tbl")).forEach(h => h.onclick = () => { sort = { k: h.dataset.k, d: sort?.k === h.dataset.k ? -sort.d : 1 }; render(); });
    $$("tbody tr", $("#tbl")).forEach(tr => tr.onclick = e => { if (e.target.closest("[data-st],a")) return; openBooking(tr.dataset.id); });
    $$("[data-st]", $("#tbl")).forEach(b => b.onclick = async () => { if (await changeStatus(rows.find(x => x.id === b.dataset.i), b.dataset.st)) load(); });
  };
  let t; $("#bq").oninput = e => { clearTimeout(t); t = setTimeout(() => { term = e.target.value.trim(); cursors = []; pageNo = 0; load(); }, 400); };
  $("#st").onchange = e => { status = e.target.value; cursors = []; pageNo = 0; load(); };
  $("#prev").onclick = () => { if (pageNo > 0) { pageNo--; load(); } };
  $("#next").onclick = () => { if (hasNext) { pageNo++; load(); } };
  $("#csv")?.addEventListener("click", async () => {
    try {
      const s = term ? rows : (await getDocs(query(collection(db, "bookings"), ...scopeC(), ...(status ? [where("status", "==", status)] : []), limit(5000)))).docs.map(x => ({ id: x.id, ...x.data() })).sort(byNewest);
      exportCSV(`bookings-${today()}`, [{ label: "Ref", csv: bookingRef }, { label: "Resort", csv: r => resortName(r.resortId) }, { label: "Guest", key: "customerName" }, { label: "Mobile", key: "customerPhone" }, { label: "Email", key: "customerEmail" }, { label: "Rooms", csv: r => (r.roomNumbers || []).join(" ") }, { label: "Check-in", key: "checkIn" }, { label: "Check-out", key: "checkOut" }, { label: "Nights", key: "nights" }, { label: "Adults", key: "adults" }, { label: "Children", key: "children" }, { label: "Source", key: "source" }, { label: "Room charges", key: "roomRevenue" }, { label: "Discount", key: "discount" }, { label: "GST", key: "tax" }, { label: "Total", key: "total" }, { label: "Paid", key: "amountPaid" }, { label: "Refunded", key: "refunded" }, { label: "Balance", csv: balance }, { label: "Status", key: "status" }, { label: "Payment", key: "paymentStatus" }, { label: "Created", csv: r => fmtTs(r.createdAt) }], s);
      audit("export", "bookings", "", RESORT === "all" ? null : RESORT, `${s.length} rows`); toast(`Exported ${s.length} bookings`, "success");
    } catch (e) { fail(e); }
  });
  load();
};

async function openBooking(id) {
  const d = openDialog(`<div class="dh"><h3>Booking</h3>${closeBtn}</div><div class="db">${SK}</div>`, { size: "lg" });
  try {
    const s = await getDoc(doc(db, "bookings", id)); if (!s.exists()) throw { code: "not-found" };
    const b = { id: s.id, ...s.data() }; let pays = [];
    if (can("payments")) pays = (await getDocs(query(collection(db, "payments"), where("resortId", "==", b.resortId), where("bookingId", "==", b.id), limit(200)))).docs.map(x => ({ id: x.id, ...x.data() })).sort((a, c) => (a.createdAt?.seconds || 0) - (c.createdAt?.seconds || 0));
    renderBooking(b, pays);
  } catch (e) { d.innerHTML = `<div class="dh"><h3>Booking</h3>${closeBtn}</div><div class="db">${errBox(e)}</div>`; bindClose(d); }
}
function roomLines(b) {
  if (Array.isArray(b.rateSnapshot) && b.rateSnapshot.length && b.rateSnapshot[0].amount != null) return b.rateSnapshot;
  return (b.roomIds || []).map((rid, i) => { const rs = (b.rateSnapshot || []).find(x => x.roomId === rid) || {}; return { roomId: rid, number: b.roomNumbers?.[i] || "", category: "", rate: rs.rate || 0, nights: b.nights, amount: (rs.rate || 0) * b.nights, taxPct: b.taxPct || 0 }; });
}
function renderBooking(b, pays) {
  const r = resortById(b.resortId) || {}, lines = roomLines(b), bal = balance(b), live = !["cancelled", "no_show"].includes(b.status);
  const d = openDialog(`<div class="dh"><div><div class="eyebrow">Booking <span class="mono">${esc(bookingRef(b))}</span> · ${esc(r.name || "")}</div><h3>${esc(b.customerName)}</h3><p>Created ${esc(fmtTs(b.createdAt))}${b.holdExpiresAt && b.status === "hold" ? ` · hold expires ${esc(fmtTs(b.holdExpiresAt))}` : ""}</p></div><div class="bar">${badge(b.status)}${badge(b.paymentStatus)}${closeBtn}</div></div>
  <div class="db">
   <div class="cols3">
    <section class="sec"><h4>Guest</h4><dl class="dl"><dt>Mobile</dt><dd>${phoneLinks(b.customerPhone)}</dd><dt>Email</dt><dd>${b.customerEmail ? `<a href="mailto:${esc(b.customerEmail)}">${esc(b.customerEmail)}</a>` : "—"}</dd><dt>Guests</dt><dd>${esc(b.adults)} adult(s)${b.children ? `, ${esc(b.children)} child(ren)` : ""}</dd><dt>Source</dt><dd>${esc(label(b.source || "—"))}</dd></dl></section>
    <section class="sec"><h4>Stay</h4><dl class="dl"><dt>Check-in</dt><dd>${esc(fmtDate(b.checkIn))}${r.checkInTime ? ` <span class="muted">from ${esc(r.checkInTime)}</span>` : ""}</dd><dt>Check-out</dt><dd>${esc(fmtDate(b.checkOut))}${r.checkOutTime ? ` <span class="muted">by ${esc(r.checkOutTime)}</span>` : ""}</dd><dt>Nights</dt><dd>${esc(b.nights)}</dd><dt>Rooms</dt><dd>${lines.map(l => `${esc(l.number)}${l.category ? ` <span class="muted">${esc(l.category)}</span>` : ""}`).join(", ")}</dd></dl></section>
    <section class="sec"><h4>Folio</h4><div class="sum"><div><span>Room charges</span><span>${inr2(b.roomRevenue)}</span></div>${b.discount ? `<div><span>Discount</span><span>− ${inr2(b.discount)}</span></div>` : ""}<div><span>GST</span><span>${inr2(b.tax)}</span></div><div class="t"><span>Total</span><span>${inr2(b.total)}</span></div><div><span>Paid</span><span>${inr2(b.amountPaid)}</span></div>${b.refunded ? `<div><span>Refunded</span><span>− ${inr2(b.refunded)}</span></div>` : ""}<div class="${bal > 0 && live ? "due" : ""}"><span>Balance due</span><span>${inr2(Math.max(0, bal))}</span></div></div></section>
   </div>
   ${b.notes ? `<div class="sec" style="margin-bottom:14px"><h4>Special requests</h4><div class="note">${esc(b.notes)}</div></div>` : ""}
   ${b.cancelReason ? `<div class="sec" style="margin-bottom:14px"><h4>${b.status === "no_show" ? "No-show" : "Cancellation"} reason</h4><div class="note">${esc(b.cancelReason)}</div></div>` : ""}
   ${can("payments") ? `<div class="sec"><h4>Payments</h4>${pays.length ? `<div class="card"><div class="tw"><table><thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Reference</th><th class="num">Amount</th><th>Verified</th></tr></thead><tbody>${pays.map(p => `<tr><td>${esc(fmtTs(p.createdAt))}</td><td>${badge(p.type)}</td><td>${esc(label(p.method))}</td><td class="mono">${esc(p.reference || "—")}</td><td class="num">${p.type === "refund" ? "− " : ""}${inr2(p.amount)}</td><td>${p.verified ? badge("verified", "Verified") : badge("unverified", "Pending")}</td></tr>`).join("")}</tbody></table></div></div>` : '<p class="muted" style="margin:0">No payments recorded yet.</p>'}</div>` : ""}
  </div>
  <div class="df"><button data-pdf="confirmation">${ico("download")}Confirmation PDF</button>${b.status !== "hold" ? `<button data-pdf="invoice">${ico("download")}Invoice PDF</button>` : ""}<button data-pr="confirmation" class="ghost" title="Print">${ico("print")}Print</button>${b.status !== "hold" ? `<button data-pr="invoice" class="hidden">${ico("print")}Invoice</button>` : ""}<span class="sp"></span>
   ${can("bookings", "edit") && live ? '<button data-edit="1">Edit details</button>' : ""}
   ${can("payments", "approve") && (b.amountPaid || 0) - (b.refunded || 0) > 0 ? '<button data-pay="refund">Refund</button>' : ""}
   ${can("payments", "add") && bal > 0 && live ? '<button data-pay="payment">Record payment</button>' : ""}
   ${transitions(b).map(([s, l]) => `<button data-st="${s}" class="${s === "cancelled" || s === "no_show" ? "danger" : "primary"}">${esc(l)}</button>`).join("")}</div>`, { size: "lg" });
  $$("[data-pr]", d).forEach(x => x.onclick = () => printBooking(b, pays, x.dataset.pr));
  $$("[data-pdf]", d).forEach(x => x.onclick = () => downloadPdf(b, pays, x.dataset.pdf, x));
  $$("[data-pay]", d).forEach(x => x.onclick = () => recordPayment(b, x.dataset.pay));
  $("[data-edit]", d)?.addEventListener("click", () => modal("Edit booking details", [
    { key: "customerName", label: "Guest name", req: 1 }, { key: "customerEmail", label: "Email", type: "email" },
    { key: "adults", label: "Adults", type: "number", min: 1 }, { key: "children", label: "Children", type: "number", min: 0 },
    { key: "source", label: "Source", type: "select", opts: ["phone", "walk-in", "website", "agent", "ota", "corporate", "referral", "social"] },
    { key: "notes", label: "Special requests", type: "textarea", wide: 1 }
  ], b, async o => {
    if (o.adults < 1) throw new Error("At least 1 adult");
    await updateDoc(doc(db, "bookings", b.id), { ...o, ...stamp(false) }); audit("update", "bookings", b.id, b.resortId, `${bookingRef(b)} details`);
    toast("Booking updated", "success"); if (CURRENT === "bookings") M.bookings(); openBooking(b.id); return true;
  }, { sub: `${bookingRef(b)} · to change dates or rooms, cancel and re-book` }));
  $$("[data-st]", d).forEach(x => x.onclick = async () => { const ok = await changeStatus(b, x.dataset.st); if (CURRENT === "bookings" || CURRENT === "dashboard" || CURRENT === "housekeeping") M[CURRENT](); openBooking(b.id); if (!ok) return; });
}

function recordPayment(b, type = "payment") {
  const bal = balance(b), netPaid = round2((b.amountPaid || 0) - (b.refunded || 0));
  modal(type === "refund" ? "Issue refund" : "Record payment", [
    { key: "amount", label: "Amount (₹)", type: "number", min: 1, step: "0.01", req: 1, def: type === "refund" ? netPaid : Math.max(0, bal), hint: type === "refund" ? `Net paid so far: ${inr2(netPaid)}` : `Balance due: ${inr2(bal)}` },
    { key: "method", label: "Method", type: "select", opts: [["upi", "UPI"], ["cash", "Cash"], ["card", "Card"], ["bank_transfer", "Bank transfer"], ["cheque", "Cheque"]] },
    { key: "reference", label: "Reference / UTR / cheque no." }, { key: "note", label: "Note" }
  ], null, async o => {
    const amt = round2(o.amount); if (!(amt > 0)) throw new Error("Enter a valid amount.");
    if (o.method !== "cash" && !o.reference) throw new Error("Reference number is required for non-cash payments.");
    const bref = doc(db, "bookings", b.id), pref = newRef("payments");
    await runTransaction(db, async tx => {
      const s = await tx.get(bref); if (!s.exists()) throw new Error("Booking not found"); const x = s.data();
      let paid = x.amountPaid || 0, ref = x.refunded || 0;
      if (type === "payment") { if (round2(paid - ref + amt) > round2(x.total) + 0.01) throw new Error(`Amount exceeds balance due (${inr2(x.total - (paid - ref))}).`); paid = round2(paid + amt); }
      else { if (!can("payments", "approve")) throw new Error("Refunds need approval permission."); if (amt > round2(paid - ref) + 0.01) throw new Error("Refund exceeds net amount paid."); ref = round2(ref + amt); }
      const net = round2(paid - ref), ps = net <= 0 ? (ref > 0 ? "refunded" : "unpaid") : net >= x.total - 0.01 ? "paid" : "partial";
      tx.set(pref, { bookingId: s.id, bookingRef: bookingRef({ id: s.id, ...x }), resortId: x.resortId, customerName: x.customerName, type, amount: amt, method: o.method, reference: o.reference || "", note: o.note || "", verified: false, ...stamp(true) });
      tx.update(bref, { amountPaid: paid, refunded: ref, paymentStatus: ps, ...stamp(false) });
    });
    audit(type, "payments", pref.id, b.resortId, `${bookingRef(b)} · ${inr2(amt)} · ${o.method}`);
    toast(type === "refund" ? "Refund recorded" : "Payment recorded", "success");
    if (CURRENT === "payments" || CURRENT === "bookings") M[CURRENT]();
    openBooking(b.id); return true;
  }, { size: "sm", saveText: type === "refund" ? "Issue refund" : "Record payment", sub: `${bookingRef(b)} · ${b.customerName}` });
}

function docHtml(b, pays, kind) {
  const r = resortById(b.resortId) || {}, lines = roomLines(b), inv = kind === "invoice", half = round2((b.tax || 0) / 2);
  return `<div class="inv">
  <header><div><h1>${esc(r.name || "Resort")}</h1><p>${esc(r.address || "")}${r.address ? "<br>" : ""}${esc([r.city, r.state, r.pincode].filter(Boolean).join(", "))}<br>${r.phone ? "Tel: " + esc(r.phone) : ""}${r.email ? " · " + esc(r.email) : ""}${r.gst ? `<br>GSTIN: <b>${esc(r.gst)}</b>` : ""}</p></div>
  <div class="r"><h2>${inv ? "TAX INVOICE" : "BOOKING CONFIRMATION"}</h2><p>${inv ? "Invoice" : "Booking"} no: <b>${esc(bookingRef(b))}</b><br>Date: ${esc(fmtDate(today()))}<br>Status: ${esc(label(b.status))}</p></div></header>
  <section class="two"><div><h3>${inv ? "Billed to" : "Guest"}</h3><p><b>${esc(b.customerName)}</b><br>${esc(b.customerPhone)}${b.customerEmail ? "<br>" + esc(b.customerEmail) : ""}</p></div>
  <div><h3>Stay details</h3><p>Check-in: <b>${esc(fmtDate(b.checkIn))}</b>${r.checkInTime ? " from " + esc(r.checkInTime) : ""}<br>Check-out: <b>${esc(fmtDate(b.checkOut))}</b>${r.checkOutTime ? " by " + esc(r.checkOutTime) : ""}<br>${esc(b.nights)} night(s) · ${esc(b.adults)} adult(s)${b.children ? `, ${esc(b.children)} child(ren)` : ""}</p></div></section>
  <table><thead><tr><th>Description</th>${inv ? "<th>SAC</th>" : ""}<th class="num">Rate</th><th class="num">Nights</th><th class="num">Amount</th>${inv ? '<th class="num">GST %</th>' : ""}</tr></thead>
  <tbody>${lines.map(l => `<tr><td>Room ${esc(l.number)}${l.category ? " – " + esc(l.category) : ""}</td>${inv ? "<td>996311</td>" : ""}<td class="num">${inr2(l.rate)}</td><td class="num">${esc(l.nights)}</td><td class="num">${inr2(l.amount)}</td>${inv ? `<td class="num">${esc(l.taxPct ?? b.taxPct ?? 0)}%</td>` : ""}</tr>`).join("")}</tbody></table>
  <div class="tot"><div><span>Room charges</span><span>${inr2(b.roomRevenue)}</span></div>${b.discount ? `<div><span>Discount</span><span>− ${inr2(b.discount)}</span></div>` : ""}<div><span>Taxable value</span><span>${inr2(b.taxable ?? (b.roomRevenue - (b.discount || 0)))}</span></div>
  ${inv ? `<div><span>CGST</span><span>${inr2(half)}</span></div><div><span>SGST</span><span>${inr2(round2(b.tax - half))}</span></div>` : `<div><span>GST</span><span>${inr2(b.tax)}</span></div>`}
  <div class="g"><span>Total</span><span>${inr2(b.total)}</span></div><div><span>Paid</span><span>${inr2(b.amountPaid)}</span></div>${b.refunded ? `<div><span>Refunded</span><span>− ${inr2(b.refunded)}</span></div>` : ""}<div><span><b>Balance due</b></span><span><b>${inr2(Math.max(0, balance(b)))}</b></span></div></div>
  ${inv && pays.length ? `<h3>Payments received</h3><table><thead><tr><th>Date</th><th>Type</th><th>Method</th><th>Reference</th><th class="num">Amount</th></tr></thead><tbody>${pays.map(p => `<tr><td>${esc(fmtTs(p.createdAt))}</td><td>${esc(label(p.type))}</td><td>${esc(label(p.method))}</td><td>${esc(p.reference || "")}</td><td class="num">${inr2(p.amount)}</td></tr>`).join("")}</tbody></table>` : ""}
  ${b.notes ? `<h3>Special requests</h3><p>${esc(b.notes)}</p>` : ""}
  ${r.cancellationPolicy ? `<h3>Cancellation policy</h3><p>${esc(r.cancellationPolicy)}</p>` : ""}
  <footer>${inv ? "SAC 996311 – Accommodation services. CGST/SGST shown for intra-state supply. " : "Please carry a valid government photo ID for all guests at check-in. "}This is a computer-generated document and does not require a signature.</footer></div>`;
}
function printBooking(b, pays, kind) {
  $("#print").innerHTML = docHtml(b, pays, kind);
  audit("print", "bookings", b.id, b.resortId, `${kind} ${bookingRef(b)}`);
  closeDialog(); setTimeout(() => window.print(), 60);
}
addEventListener("afterprint", () => { $("#print").innerHTML = ""; });
// PDF download (loads the PDF library only when first needed)
let pdfLib = null;
const loadPdfLib = () => pdfLib ||= new Promise((res, rej) => { const sc = document.createElement("script"); sc.src = "https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"; sc.onload = () => res(window.html2pdf); sc.onerror = () => { pdfLib = null; rej(new Error("Couldn't load the PDF tool. Check your internet connection and try again.")); }; document.head.append(sc); });
async function downloadPdf(b, pays, kind, btn) {
  if (btn) { btn.disabled = true; btn.classList.add("busy"); }
  const wrap = document.createElement("div"); wrap.className = "pdfwrap"; wrap.innerHTML = docHtml(b, pays, kind); document.body.append(wrap);
  try {
    const h2p = await loadPdfLib();
    await h2p().set({ margin: [10, 10, 12, 10], filename: `${kind === "invoice" ? "Invoice" : "Booking"}-${bookingRef(b)}.pdf`, image: { type: "jpeg", quality: 0.96 }, html2canvas: { scale: 2, backgroundColor: "#ffffff", useCORS: true }, jsPDF: { unit: "mm", format: "a4", orientation: "portrait" }, pagebreak: { mode: ["css", "legacy"] } }).from(wrap.firstElementChild).save();
    audit("pdf", "bookings", b.id, b.resortId, `${kind} ${bookingRef(b)}`); toast("PDF downloaded", "success");
  } catch (e) { console.error(e); toast("Opening print screen instead – choose 'Save as PDF'.", "warn"); wrap.remove(); printBooking(b, pays, kind); }
  finally { wrap.remove(); if (btn) { btn.disabled = false; btn.classList.remove("busy"); } }
}

// ---------- Payments
M.payments = async () => {
  const m = $("#main"), PS = 25; let type = "", cursors = [], pageNo = 0, rows = [], hasNext = false;
  m.innerHTML = pageHead("Payments", "Receipts, refunds and reconciliation", `${can("payments", "export") ? `<button id="csv">${ico("download")}Export</button>` : ""}${can("payments", "add") ? `<button class="primary" id="rp">${ico("plus")}Record payment</button>` : ""}`) +
    `<div class="card"><div class="toolbar"><select id="pt" aria-label="Type"><option value="">Payments & refunds</option><option value="payment">Payments only</option><option value="refund">Refunds only</option></select><span class="sp"></span><span id="cnt" class="muted"></span></div><div class="tw" id="tbl">${SK}</div><div class="pager"><span id="pg" class="muted"></span><button id="prev" class="sm">← Prev</button><button id="next" class="sm">Next →</button></div></div>`;
  const cons = () => [...scopeC(), ...(type ? [where("type", "==", type)] : [])];
  const load = async () => {
    $("#tbl").innerHTML = SK;
    try {
      const after = pageNo ? cursors[pageNo - 1] : null;
      const s = await getDocs(query(collection(db, "payments"), ...cons(), ...(after ? [startAfter(after)] : []), limit(PS)));
      rows = s.docs.map(x => ({ id: x.id, ...x.data() })).sort(byNewest); cursors[pageNo] = s.docs[s.docs.length - 1]; hasNext = s.size === PS;
      $("#pg").textContent = `Page ${pageNo + 1}`; $("#prev").disabled = !pageNo; $("#next").disabled = !hasNext;
      const tot = sum(rows, p => p.type === "refund" ? -p.amount : p.amount); $("#cnt").textContent = rows.length ? `${rows.length} shown · net ${inr(tot)}` : "";
      if (!rows.length) { $("#tbl").innerHTML = emptyBox("No payments yet", "Payments are recorded from a booking's folio."); return; }
      $("#tbl").innerHTML = tableHtml([
        ...(RESORT === "all" ? [{ key: "resortId", label: "Resort", fmt: r => resortName(r.resortId), nosort: 1 }] : []),
        { key: "createdAt", label: "Date", fmt: r => fmtTs(r.createdAt), nosort: 1 },
        { key: "bookingRef", label: "Booking", html: r => `<a href="#" data-open="${esc(r.bookingId)}" class="mono">${esc(r.bookingRef || String(r.bookingId || "").slice(0, 8).toUpperCase())}</a><span class="sub">${esc(r.customerName || "")}</span>`, nosort: 1 },
        { key: "type", label: "Type", html: r => badge(r.type), nosort: 1 }, { key: "method", label: "Method", fmt: r => label(r.method), nosort: 1 },
        { key: "reference", label: "Reference", html: r => `<span class="mono">${esc(r.reference || "—")}</span>`, nosort: 1 },
        { key: "amount", label: "Amount", html: r => (r.type === "refund" ? "− " : "") + inr2(r.amount), num: 1, nosort: 1 },
        { key: "verified", label: "Reconciled", html: r => r.verified ? badge("verified", "Verified") : badge("unverified", "Pending"), nosort: 1 }
      ], rows, { actions: r => !r.verified && can("payments", "approve") ? `<button class="sm" data-v="${esc(r.id)}">Mark verified</button>` : "" });
      $$("[data-open]", $("#tbl")).forEach(a => a.onclick = e => { e.preventDefault(); openBooking(a.dataset.open); });
      $$("[data-v]", $("#tbl")).forEach(b => b.onclick = async () => { try { await updateDoc(doc(db, "payments", b.dataset.v), { verified: true, verifiedBy: ME.uid, verifiedAt: serverTimestamp() }); const p = rows.find(x => x.id === b.dataset.v); audit("verify", "payments", b.dataset.v, p?.resortId, inr2(p?.amount)); toast("Payment verified", "success"); load(); } catch (e) { fail(e); } });
    } catch (e) { $("#tbl").innerHTML = errBox(e); }
  };
  $("#pt").onchange = e => { type = e.target.value; cursors = []; pageNo = 0; load(); };
  $("#prev").onclick = () => { if (pageNo) { pageNo--; load(); } };
  $("#next").onclick = () => { if (hasNext) { pageNo++; load(); } };
  $("#rp")?.addEventListener("click", () => modal("Record payment", [{ key: "t", label: "Booking reference or guest mobile", req: 1, wide: 1, ph: "e.g. GOA-261013-AB12 or 9876543210" }], null, async o => {
    const res = (await findBookings(o.t)).filter(b => !["cancelled", "no_show"].includes(b.status));
    if (!res.length) throw new Error("No active booking found.");
    if (res.length === 1) { recordPayment(res[0]); return true; }
    openDialog(`<div class="dh"><h3>Select booking</h3>${closeBtn}</div><div class="db"><div class="card"><div class="tw"><table><tbody>${res.map(b => `<tr class="click" data-pick="${esc(b.id)}"><td class="mono">${esc(bookingRef(b))}</td><td>${esc(b.customerName)}</td><td>${esc(fmtDay(b.checkIn))} → ${esc(fmtDay(b.checkOut))}</td><td class="num">${inr(balance(b))} due</td><td>${badge(b.status)}</td></tr>`).join("")}</tbody></table></div></div></div>`, { size: "md" });
    $$("[data-pick]", dlg()).forEach(tr => tr.onclick = () => recordPayment(res.find(b => b.id === tr.dataset.pick)));
    return true;
  }, { size: "sm", saveText: "Find booking" }));
  $("#csv")?.addEventListener("click", async () => {
    try {
      const s = (await getDocs(query(collection(db, "payments"), ...cons(), limit(5000)))).docs.map(x => ({ id: x.id, ...x.data() })).sort(byNewest);
      exportCSV(`payments-${today()}`, [{ label: "Date", csv: r => fmtTs(r.createdAt) }, { label: "Resort", csv: r => resortName(r.resortId) }, { label: "Booking", csv: r => r.bookingRef || r.bookingId }, { label: "Guest", key: "customerName" }, { label: "Type", key: "type" }, { label: "Method", key: "method" }, { label: "Reference", key: "reference" }, { label: "Amount", key: "amount" }, { label: "Verified", csv: r => r.verified ? "yes" : "no" }, { label: "Note", key: "note" }], s);
      audit("export", "payments", "", RESORT === "all" ? null : RESORT, `${s.length} rows`); toast(`Exported ${s.length} rows`, "success");
    } catch (e) { fail(e); }
  });
  load();
};

// ---------- Housekeeping board
M.housekeeping = async () => {
  const m = $("#main"); let filter = "all";
  m.innerHTML = pageHead("Housekeeping", "Live room status board", `<button id="hkr">Refresh</button>`) + `<div class="chips" id="chips"></div><div id="hb">${SK}</div>`;
  const load = async () => {
    try {
      const [rs, inh] = await Promise.all([getDocs(query(collection(db, "rooms"), ...scopeC(), limit(1000))), can("bookings") ? getDocs(query(collection(db, "bookings"), ...scopeC(), where("status", "==", "checked_in"), limit(1000))).catch(() => null) : null]);
      if (CURRENT !== "housekeeping") return;
      const occ = new Set((inh?.docs || []).flatMap(x => x.data().roomIds || []));
      const rooms = rs.docs.map(x => ({ id: x.id, ...x.data() })).filter(r => !r.archived).sort((a, b) => String(a.number).localeCompare(String(b.number), "en", { numeric: true }));
      const grp = r => r.opStatus && r.opStatus !== "available" ? "ooo" : r.hkStatus || "ready";
      const cnt = k => rooms.filter(r => k === "all" || grp(r) === k).length;
      const F = [["all", "All rooms"], ["cleaning_required", "Dirty"], ["cleaning_in_progress", "Cleaning"], ["ready", "Ready"], ["ooo", "Out of order"]];
      $("#chips").innerHTML = F.map(([k, l]) => `<button class="sm ${filter === k ? "on" : ""}" data-c="${k}">${l} · ${cnt(k)}</button>`).join("");
      $$("[data-c]").forEach(b => b.onclick = () => { filter = b.dataset.c; load(); });
      const list = rooms.filter(r => filter === "all" || grp(r) === filter), ed = can("housekeeping", "edit");
      const next = { ready: ["cleaning_required", "Mark dirty"], cleaning_required: ["cleaning_in_progress", "Start cleaning"], cleaning_in_progress: ["ready", "Inspected · ready"] };
      $("#hb").innerHTML = list.length ? `<div class="board">${list.map(r => { const g = grp(r), n = next[r.hkStatus || "ready"]; return `<div class="card tile ${g}"><div style="display:flex;justify-content:space-between;align-items:center"><span class="no">${esc(r.number)}</span>${occ.has(r.id) ? '<span class="pill">Occupied</span>' : '<span class="pill">Vacant</span>'}</div><span class="muted" style="font-size:12.5px">${esc(r.category || "")}${RESORT === "all" ? " · " + esc(resortName(r.resortId)) : ""}</span>${badge(r.hkStatus || "ready")}${g === "ooo" ? badge(r.opStatus) : ""}${ed && n ? `<button class="sm ${n[0] === "ready" ? "primary" : ""}" data-hk="${n[0]}" data-i="${esc(r.id)}">${n[1]}</button>` : ""}</div>`; }).join("")}</div>` : emptyBox("No rooms in this view");
      $$("[data-hk]").forEach(b => b.onclick = async () => { b.disabled = true; try { await updateDoc(doc(db, "rooms", b.dataset.i), { hkStatus: b.dataset.hk, updatedAt: serverTimestamp(), updatedBy: ME.uid }); const rr = rooms.find(x => x.id === b.dataset.i); audit("hk", "housekeeping", b.dataset.i, rr?.resortId, `Room ${rr?.number} → ${b.dataset.hk}`); load(); } catch (e) { fail(e); b.disabled = false; } });
    } catch (e) { $("#hb").innerHTML = errBox(e); }
  };
  $("#hkr").onclick = load; load();
};

// ---------- Staff (provisioning through Cloud Functions)
let CUSTOM_ROLES = [];
const roleOpts = () => [...Object.keys(DEFAULT_ROLES), ...CUSTOM_ROLES].filter((r, i, a) => a.indexOf(r) === i).filter(r => ROLE === "super_admin" || !["super_admin", "company_admin"].includes(r)).map(r => [r, roleLabel(r)]);
M.users = async () => {
  const m = $("#main"), manage = isAdmin();
  m.innerHTML = pageHead("Staff", "User accounts, roles and resort access", manage ? `<button class="primary" id="addU">${ico("plus")}Add staff</button>` : "") + `<div class="card"><div class="tw" id="tbl">${SK}</div></div>`;
  try { CUSTOM_ROLES = (await getDocs(collection(db, "roles"))).docs.map(x => x.id).filter(id => !DEFAULT_ROLES[id]); } catch { }
  const resortChecks = RESORTS.map(r => [r.id, r.name]);
  let rows = [];
  const load = async () => {
    try {
      rows = (await getDocs(query(collection(db, "users"), limit(500)))).docs.map(x => ({ id: x.id, ...x.data() })).sort((a, b) => String(a.name || a.email).localeCompare(String(b.name || b.email)));
      $("#tbl").innerHTML = tableHtml([
        { key: "name", label: "Name", html: u => `<div style="display:flex;gap:10px;align-items:center"><span class="avatar">${esc(initials(u.name || u.email))}</span><div>${esc(u.name || "—")}<span class="sub">${esc(u.email)}</span></div></div>` },
        { key: "role", label: "Role", fmt: u => roleLabel(u.role) },
        { key: "resortIds", label: "Resort access", fmt: u => ["super_admin", "company_admin", "management"].includes(u.role) ? "All resorts" : (u.resortIds || []).map(resortName).join(", ") || "None" },
        { key: "active", label: "Status", html: u => u.active === false ? badge("inactive", "Disabled") : badge("active") }
      ], rows, { actions: u => manage && u.id !== ME.uid && !(u.role === "super_admin" && ROLE !== "super_admin") ? `<button class="sm" data-rs="${esc(u.id)}">Reset password</button><button class="sm" data-ed="${esc(u.id)}">Edit access</button>` : "" });
      $$("[data-ed]").forEach(b => b.onclick = () => editUser(rows.find(u => u.id === b.dataset.ed)));
      $$("[data-rs]").forEach(b => b.onclick = async () => { const u = rows.find(x => x.id === b.dataset.rs); if (!await confirmBox(`Send a password reset email to ${u.email}?`, { ok: "Send email" })) return; try { await sendPasswordResetEmail(auth, u.email); audit("password_reset", "users", u.id, null, u.email); toast("Reset email sent", "success"); } catch (e) { fail(e); } });
    } catch (e) { $("#tbl").innerHTML = errBox(e); }
  };
  const editUser = u => modal(`Edit access · ${u.name || u.email}`, [
    { key: "role", label: "Role", type: "select", opts: roleOpts() },
    { key: "active", label: "Account", type: "select", opts: [["true", "Active"], ["false", "Disabled (signs out immediately)"]] },
    { key: "resortIds", label: "Resort access (ignored for admins & management)", type: "checks", opts: resortChecks, wide: 1 }
  ], { ...u, active: String(u.active !== false) }, async o => {
    const resortIds = ["super_admin", "company_admin", "management"].includes(o.role) ? [] : o.resortIds;
    if (!resortIds.length && !["super_admin", "company_admin", "management"].includes(o.role)) throw new Error("Select at least one resort.");
    await updateDoc(doc(db, "users", u.id), { role: o.role, resortIds, active: o.active === "true", updatedAt: serverTimestamp(), updatedBy: ME.uid });
    audit("role_change", "users", u.id, null, `${u.email} · ${o.role} · ${o.active === "true" ? "active" : "disabled"}`);
    toast("Access updated. It applies immediately.", "success"); load();
  }, { saveText: "Save access" });
  $("#addU")?.addEventListener("click", () => modal("Add staff member", [
    { key: "name", label: "Full name", req: 1 }, { key: "email", label: "Work email", type: "email", req: 1, auto: "off" },
    { key: "password", label: "Temporary password", type: "password", req: 1, auto: "new-password", hint: "Min. 10 characters. They also get an email to set their own password. using 'Forgot password'." },
    { key: "role", label: "Role", type: "select", opts: roleOpts(), def: "front_desk" },
    { key: "resortIds", label: "Resort access", type: "checks", opts: resortChecks, wide: 1, def: RESORT !== "all" ? [RESORT] : [] }
  ], null, async o => {
    if (o.password.length < 10) throw new Error("Password must be at least 10 characters.");
    const resortIds = ["super_admin", "company_admin", "management"].includes(o.role) ? [] : o.resortIds;
    if (!resortIds.length && !["super_admin", "company_admin", "management"].includes(o.role)) throw new Error("Select at least one resort.");
    // create the login on a separate, in-memory Firebase instance so the admin stays signed in
    const sec = initializeApp(FIREBASE_CONFIG, "staff-" + Date.now()), sa = initializeAuth(sec, { persistence: inMemoryPersistence });
    let uid;
    try { uid = (await createUserWithEmailAndPassword(sa, o.email.trim().toLowerCase(), o.password)).user.uid; }
    catch (e) { throw new Error(e.code === "auth/email-already-in-use" ? "An account with this email already exists." : e.code === "auth/weak-password" ? "Password is too weak." : e.code === "auth/operation-not-allowed" ? "Turn on Email/Password sign-in in Firebase Authentication first." : (e.message || "Could not create the login.")); }
    finally { try { await signOut(sa); } catch { } deleteApp(sec).catch(() => { }); }
    await setDoc(doc(db, "users", uid), { email: o.email.trim().toLowerCase(), name: o.name, role: o.role, resortIds, active: true, createdAt: serverTimestamp(), createdBy: ME.uid });
    audit("user_create", "users", uid, null, `${o.email} · ${o.role}`);
    try { await sendPasswordResetEmail(auth, o.email.trim().toLowerCase()); } catch (e) { console.warn(e); }
    toast(`${o.name} added. A 'set your password' email was sent to them.`, "success"); load();
  }, { saveText: "Create account" }));
  load();
};

// ---------- Roles
M.roles = async () => {
  const m = $("#main"), edit = isAdmin(); m.innerHTML = pageHead("Roles & permissions", "What each role can see and do") + `<div class="card">${SK}</div>`;
  const saved = {}; try { (await getDocs(collection(db, "roles"))).forEach(x => saved[x.id] = x.data().permissions); } catch (e) { console.warn(e); }
  const roles = { ...DEFAULT_ROLES, ...saved }; delete roles.super_admin; delete roles.company_admin;
  const MOD_LABEL = { auditLogs: "Audit log", users: "Staff", customers: "Guests" };
  m.innerHTML = pageHead("Roles & permissions", "Super Admin and Company Admin always have full access", edit ? `<button id="nr">${ico("plus")}Custom role</button><button class="primary" id="save">Save changes</button>` : "") +
    `<div class="card"><div class="toolbar"><label for="rs" style="margin:0">Role</label><select id="rs" style="max-width:260px">${Object.keys(roles).map(r => `<option value="${esc(r)}">${esc(roleLabel(r))}</option>`).join("")}</select><span class="sp"></span>${edit ? "" : '<span class="muted">Read-only</span>'}</div><div class="tw" id="tbl"></div></div>`;
  const draw = () => {
    const p = roles[$("#rs").value] || {};
    $("#tbl").innerHTML = `<table class="matrix"><thead><tr><th>Module</th>${ACT.map(a => `<th>${esc(label(a))}</th>`).join("")}</tr></thead><tbody>${MODS.map(mm => `<tr><td>${esc(MOD_LABEL[mm] || label(mm))}</td>${ACT.map(a => `<td><input type="checkbox" data-m="${mm}" data-a="${a}" ${p[mm]?.[a] ? "checked" : ""} ${edit ? "" : "disabled"} aria-label="${esc(mm + " " + a)}"></td>`).join("")}</tr>`).join("")}</tbody></table>`;
  };
  $("#rs").onchange = draw; draw();
  $("#nr")?.addEventListener("click", () => modal("New custom role", [{ key: "name", label: "Role ID", req: 1, pattern: "[a-z][a-z_]{2,30}", title: "lowercase letters and _", hint: "e.g. night_auditor" }], null, async o => {
    if (roles[o.name] || DEFAULT_ROLES[o.name]) throw new Error("That role already exists"); roles[o.name] = {};
    $("#rs").insertAdjacentHTML("beforeend", `<option value="${esc(o.name)}">${esc(roleLabel(o.name))}</option>`); $("#rs").value = o.name; draw();
  }, { size: "sm", saveText: "Create" }));
  $("#save")?.addEventListener("click", async () => {
    const p = {}; $$("#tbl input:checked").forEach(i => { (p[i.dataset.m] ??= {})[i.dataset.a] = true; });
    const id = $("#rs").value;
    try { await setDoc(doc(db, "roles", id), { permissions: p, updatedAt: serverTimestamp(), updatedBy: ME.uid }); roles[id] = p; audit("role_update", "roles", id, null, Object.keys(p).join(",")); toast(`${roleLabel(id)} saved`, "success"); } catch (e) { fail(e); }
  });
};

// ---------- Audit log
M.auditLogs = async () => {
  const m = $("#main"); let mod = "", last = null, rows = [];
  m.innerHTML = pageHead("Audit log", "Every create, change, export and print – tamper-proof") + `<div class="card"><div class="toolbar"><select id="am"><option value="">All modules</option>${MODS.map(x => `<option value="${x}">${esc(label(x))}</option>`).join("")}</select></div><div class="tw" id="tbl">${SK}</div><div class="pager"><button id="more" class="sm">Load more</button></div></div>`;
  const load = async more => {
    try {
      const s = await getDocs(query(collection(db, "auditLogs"), ...(mod ? [where("module", "==", mod)] : [orderBy("ts", "desc")]), ...(more && last ? [startAfter(last)] : []), limit(100)));
      rows = (more ? rows.concat(s.docs.map(x => x.data())) : s.docs.map(x => x.data())).sort((a, b) => (b.ts?.seconds || 0) - (a.ts?.seconds || 0)); last = s.docs[s.docs.length - 1]; $("#more").disabled = s.size < 100;
      $("#tbl").innerHTML = rows.length ? tableHtml([{ key: "ts", label: "Time", fmt: r => fmtTs(r.ts), nosort: 1 }, { key: "userEmail", label: "User", fmt: r => r.userEmail || String(r.userId || "").slice(0, 8), nosort: 1 }, { key: "action", label: "Action", html: r => `<span class="pill">${esc(r.action)}</span>`, nosort: 1 }, { key: "module", label: "Module", fmt: r => label(r.module), nosort: 1 }, { key: "resortId", label: "Resort", fmt: r => r.resortId ? resortName(r.resortId) : "—", nosort: 1 }, { key: "summary", label: "Details", nosort: 1 }], rows) : emptyBox("No activity yet");
    } catch (e) { $("#tbl").innerHTML = errBox(e); }
  };
  $("#am").onchange = e => { mod = e.target.value; last = null; load(false); };
  $("#more").onclick = () => load(true); load(false);
};

// ---------- Settings
const THEMES = [["default", "Lagoon", "Teal & gold – the default"], ["neu", "Neumorphic Light", "Soft, raised surfaces"], ["neu-dark", "Neumorphic Dark", "Soft surfaces, dark"], ["corporate", "Corporate", "Calm navy blue"], ["minimal", "Minimal", "Monochrome, light sidebar"], ["dark", "Dark", "Easy on the eyes at night"]];
M.settings = async () => {
  const m = $("#main"), cur = document.documentElement.dataset.theme || "default";
  m.innerHTML = pageHead("Settings", "Your profile, appearance and security") + `<div class="grid3">
  <div class="card pad"><h3>Profile</h3><dl class="dl" style="margin-top:12px"><dt>Name</dt><dd>${esc(ME.name || "—")}</dd><dt>Email</dt><dd>${esc(ME.email)}</dd><dt>Role</dt><dd>${esc(roleLabel(ROLE))}</dd><dt>Resorts</dt><dd>${esc(seesAll() ? "All resorts" : RESORTS.map(r => r.name).join(", ") || "None")}</dd></dl></div>
  <div class="card pad"><h3>Appearance</h3><div style="display:grid;gap:8px;margin-top:12px">${THEMES.map(([k, l, s]) => `<label class="chk" style="padding:10px;border:1px solid var(--border);border-radius:10px"><input type="radio" name="th" value="${k}" ${cur === k ? "checked" : ""}><span><b>${esc(l)}</b><br><span class="muted">${esc(s)}</span></span></label>`).join("")}</div></div>
  <div class="card pad"><h3>Security</h3><p class="muted">Sessions end when the browser closes and after ${IDLE_MINUTES} minutes of inactivity.</p><div class="bar"><button id="sReset">Email me a password reset link</button><button id="sOut" class="danger">Sign out</button></div></div>
  </div><div class="card pad"><h3>System</h3><dl class="dl" style="margin-top:12px"><dt>App version</dt><dd>${APP_VERSION}</dd><dt>Firebase project</dt><dd class="mono">${esc(FIREBASE_CONFIG.projectId)}</dd><dt>Payments</dt><dd>Manual receipts (no gateway connected)</dd><dt>Notifications</dt><dd>Email / WhatsApp not connected</dd></dl></div>`;
  $$("[name=th]").forEach(r => r.onchange = () => saveTheme(r.value));
  $("#sReset").onclick = async () => { try { await sendPasswordResetEmail(auth, ME.email); toast("Reset email sent to " + ME.email, "success"); } catch (e) { fail(e); } };
  $("#sOut").onclick = () => signOut(auth);
};

// ============================================================ SHELL
const NAV = [
  ["Overview", [["dashboard", "Dashboard", "grid"]]],
  ["Front office", [["bookings", "Bookings", "calendar"], ["housekeeping", "Housekeeping", "broom"]]],
  ["Sales", [["leads", "Leads", "phone"], ["customers", "Guests", "users"]]],
  ["Finance", [["payments", "Payments", "card"]]],
  ["Property", [["rooms", "Rooms", "bed"], ["maintenance", "Maintenance", "tool"], ["resorts", "Resorts", "pin"]]],
  ["Administration", [["users", "Staff", "user"], ["roles", "Roles & permissions", "shield"], ["auditLogs", "Audit log", "file"], ["settings", "Settings", "sliders"]]]
];
const NAV_COLOR = { dashboard: "#6366f1", bookings: "#0ea5e9", housekeeping: "#14b8a6", leads: "#f97316", customers: "#ec4899", payments: "#22c55e", rooms: "#8b5cf6", maintenance: "#f59e0b", resorts: "#ef4444", users: "#06b6d4", roles: "#64748b", auditLogs: "#a855f7", settings: "#78716c" };
const allowed = mod => mod === "settings" || can(mod, "view");
const navLabel = mod => NAV.flatMap(g => g[1]).find(x => x[0] === mod)?.[1] || "ResortHub";
const firstAllowed = () => NAV.flatMap(g => g[1]).map(x => x[0]).find(allowed) || "settings";
const closeSide = () => { $("#side").classList.remove("open"); $("#scrim").classList.remove("on"); document.body.classList.remove("lock"); $("#content")?.removeAttribute("inert"); };
function go(mod, opts, push = true) {
  if (!M[mod] || !allowed(mod)) mod = firstAllowed();
  CURRENT = mod; closeDialog();
  $$("#nav a").forEach(a => a.classList.toggle("on", a.dataset.m === mod)); closeSide();
  if (push && location.hash !== "#" + mod) history.pushState(null, "", "#" + mod);
  document.title = `${navLabel(mod)} · ResortHub`;
  Promise.resolve(M[mod](opts)).catch(e => { $("#main").innerHTML = errBox(e); });
  window.scrollTo(0, 0); $("#main").focus({ preventScroll: true });
}
addEventListener("popstate", () => { if (ME) go(location.hash.slice(1) || "dashboard", undefined, false); });

async function enter(user) {
  let prof = await getDoc(doc(db, "users", user.uid)).catch(() => null);
  if (prof && !prof.exists()) prof = await ownerSetup(user) || prof;   // first login of the owner creates the Super Admin
  if (!prof?.exists() || prof.data().active !== true || !prof.data().role) { await signOut(auth); $("#loginErr").textContent = "Your account isn't set up or has been disabled. Contact your administrator."; return; }
  const P = prof.data(); ROLE = P.role;
  ME = { uid: user.uid, email: user.email, name: P.name || user.email, resortIds: Array.isArray(P.resortIds) ? P.resortIds : [] };
  let p = DEFAULT_ROLES[ROLE];
  if (!isAdmin()) { try { const r = await getDoc(doc(db, "roles", ROLE)); if (r.exists()) p = r.data().permissions; } catch (e) { console.warn(e); } }
  PERMS = p || {};
  await loadResorts();
  if (!seesAll() && !RESORTS.length) { await signOut(auth); $("#loginErr").textContent = "No resort is assigned to your account. Contact your administrator."; return; }
  $("#whoName").textContent = ME.name; $("#whoRole").textContent = roleLabel(ROLE); $("#avatar").textContent = initials(ME.name);
  $("#nav").innerHTML = NAV.map(([g, items]) => { const v = items.filter(([k]) => allowed(k)); return v.length ? `<div class="nav-g">${esc(g)}</div>` + v.map(([k, l, i]) => `<a data-m="${k}" href="#${k}"><span class="ni" style="--c:${NAV_COLOR[k] || "#64748b"}">${ico(i)}</span><span>${esc(l)}</span></a>`).join("") : ""; }).join("");
  $$("#nav a").forEach(a => a.onclick = e => { e.preventDefault(); go(a.dataset.m); });
  applyTheme(P.theme || "default");
  $("#auth").classList.add("hidden"); $("#app").classList.remove("hidden"); $("#loginErr").textContent = "";
  resetIdle();
  go(location.hash.slice(1) || "dashboard", undefined, false);
  expireHolds();
}
// One-time setup: the owner email written in firestore.rules becomes Super Admin on first sign-in.
async function ownerSetup(user) {
  try {
    const b = writeBatch(db);
    b.set(doc(db, "users", user.uid), { email: user.email, name: user.email.split("@")[0], role: "super_admin", resortIds: [], active: true, createdAt: serverTimestamp(), createdBy: user.uid });
    b.set(doc(db, "config", "setup"), { ownerUid: user.uid, at: serverTimestamp() });
    await b.commit();
    for (const [id, permissions] of Object.entries(DEFAULT_ROLES)) if (!["super_admin", "company_admin"].includes(id)) await setDoc(doc(db, "roles", id), { permissions, updatedAt: serverTimestamp(), updatedBy: user.uid });
    toast("Welcome! Your Super Admin account is ready. Start by adding a resort.", "success");
    return await getDoc(doc(db, "users", user.uid));
  } catch (e) { console.info("Not the owner account or setup already done", e?.code); return null; }
}
// Tentative holds past their expiry are released automatically whenever a staff member with booking rights opens the app.
async function expireHolds() {
  if (!can("bookings")) return;
  try {
    const s = await getDocs(query(collection(db, "bookings"), ...scopeC(), where("status", "==", "hold"), limit(100)));
    const now = Date.now();
    for (const d of s.docs) {
      const x = d.data(); if (!x.holdExpiresAt || x.holdExpiresAt.toMillis() > now) continue;
      try {
        await runTransaction(db, async tx => {
          const cur = await tx.get(d.ref); if (!cur.exists() || cur.data().status !== "hold") return;
          for (const r of x.roomIds || []) for (const n of nights(x.checkIn, x.checkOut)) tx.delete(nightRef(r, n));
          tx.update(d.ref, { status: "cancelled", cancelReason: "Tentative hold expired", cancelledAt: serverTimestamp(), ...stamp(false) });
        });
        audit("hold_expired", "bookings", d.id, x.resortId, `${bookingRef({ id: d.id, ...x })} released`);
      } catch (e) { console.warn("hold expiry", d.id, e); }
    }
  } catch (e) { console.warn("hold expiry", e); }
}
// Loads the resorts this user may see and refreshes the top-bar selector (called at sign-in and after a resort is saved).
async function loadResorts() {
  if (seesAll()) RESORTS = (await getDocs(query(collection(db, "resorts"), limit(300)))).docs.map(x => ({ id: x.id, ...x.data() }));
  else RESORTS = (await Promise.all(ME.resortIds.map(id => getDoc(doc(db, "resorts", id)).catch(() => null)))).filter(s => s?.exists()).map(s => ({ id: s.id, ...s.data() }));
  RESORTS = RESORTS.filter(r => !r.archived).sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const sel = $("#resortSel"), keep = RESORT;
  sel.innerHTML = (seesAll() ? '<option value="all">All resorts</option>' : "") + RESORTS.map(r => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("");
  let saved = keep; if (!saved || saved === "all") { try { saved = localStorage.getItem("rh.resort") || saved; } catch { } }
  sel.value = [...sel.options].some(o => o.value === saved) ? saved : sel.options[0]?.value || "all";
  RESORT = sel.value || "all";
}
const THEME_MAP = { glass: "default", tropical: "default", light: "minimal" };
function applyTheme(t) { t = THEME_MAP[t] || t; if (!THEMES.some(x => x[0] === t)) t = "default"; if (t === "default") document.documentElement.removeAttribute("data-theme"); else document.documentElement.dataset.theme = t; }
async function saveTheme(t) { applyTheme(t); try { await updateDoc(doc(db, "users", ME.uid), { theme: t }); } catch (e) { console.warn(e); } }
function clearSession() {
  clearTimeout(idleT); ME = null; ROLE = null; PERMS = {}; RESORTS = []; RESORT = "all";
  $("#main").innerHTML = ""; $("#nav").innerHTML = ""; $("#loginForm").reset(); $("#pw").type = "password"; $("#showPw").textContent = "Show";
  closeDialog(); $("#app").classList.add("hidden"); $("#auth").classList.remove("hidden"); document.documentElement.removeAttribute("data-theme");
  $("#loginBtn").disabled = false; $("#loginBtn").textContent = "Sign in";
}
let idleT; function resetIdle() { clearTimeout(idleT); if (ME) idleT = setTimeout(async () => { await signOut(auth); $("#loginErr").textContent = `You were signed out after ${IDLE_MINUTES} minutes of inactivity.`; }, IDLE_MINUTES * 60e3); }
["pointerdown", "keydown", "wheel", "touchstart"].forEach(ev => addEventListener(ev, () => { if (ME) resetIdle(); }, { passive: true }));

// static chrome
$("#ver").textContent = "v" + APP_VERSION;
$("#menuBtn").onclick = () => { $("#side").classList.add("open"); $("#scrim").classList.add("on"); document.body.classList.add("lock"); $("#content")?.setAttribute("inert", ""); $("#nav a")?.focus(); };
addEventListener("keydown", e => { if (e.key === "Escape" && $("#side").classList.contains("open")) closeSide(); });
// login screen floating icons
const fl = (id, list) => { $(id).innerHTML = list.map(([n, c]) => `<span style="--c:${c}">${ico(n)}</span>`).join(""); };
fl("#flTop", [["bed", "#0ea5e9"], ["key", "#f59e0b"], ["bell", "#8b5cf6"], ["calendar", "#ec4899"]]);
fl("#flBot", [["mountain", "#14b8a6"], ["umbrella", "#f97316"], ["coffee", "#a16207"], ["wave", "#06b6d4"]]);
$("#scrim").onclick = closeSide;
$("#resortSel").onchange = e => { RESORT = e.target.value; try { localStorage.setItem("rh.resort", RESORT); } catch { } go(CURRENT); };
$("#userChip").onclick = () => go("settings"); $("#userChip").onkeydown = e => { if (e.key === "Enter") go("settings"); };
$("#showPw").onclick = () => { const p = $("#pw"); p.type = p.type === "password" ? "text" : "password"; $("#showPw").textContent = p.type === "password" ? "Show" : "Hide"; };
$("#loginForm").onsubmit = async e => {
  e.preventDefault(); const b = $("#loginBtn"); if (b.disabled) return; b.disabled = true; b.textContent = "Signing in…"; $("#loginErr").textContent = "";
  try { await setPersistence(auth, browserSessionPersistence); await signInWithEmailAndPassword(auth, $("#em").value.trim(), $("#pw").value); }
  catch (er) { $("#loginErr").textContent = ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"].includes(er.code) ? "Incorrect email or password." : er.code === "auth/too-many-requests" ? "Too many attempts. Please wait a few minutes and try again." : er.code === "auth/user-disabled" ? "This account has been disabled." : er.code === "auth/network-request-failed" ? "Network error. Check your connection." : "Sign-in failed. Please try again."; b.disabled = false; b.textContent = "Sign in"; }
};
$("#forgot").onclick = async e => { e.preventDefault(); const em = $("#em").value.trim(); if (!em) { $("#loginErr").textContent = "Enter your email above first."; $("#em").focus(); return; } try { await sendPasswordResetEmail(auth, em); } catch { } $("#loginErr").textContent = "If an account exists for that email, a reset link is on its way."; };
$("#logout").onclick = () => signOut(auth);
$("#gs").onkeydown = async e => {
  if (e.key !== "Enter") return; const v = e.target.value.trim(); if (!v) return;
  if (!can("bookings")) return toast("You don't have access to bookings.", "warn");
  try { const r = await findBookings(v); if (r.length === 1) { openBooking(r[0].id); } else if (r.length > 1) { go("bookings", { term: v }); } else guestSearch(v); } catch (er) { fail(er); }
};
async function guestSearch(v) {
  if (!can("customers") && !can("bookings")) return toast("No match found.", "warn");
  const t = v.toLowerCase(), s = await getDocs(query(collection(db, "customers"), limit(3000)));
  const res = s.docs.map(x => ({ id: x.id, ...x.data() })).filter(c => !c.archived && (String(c.name || "").toLowerCase().includes(t) || String(c.email || "").toLowerCase().includes(t))).slice(0, 30);
  if (!res.length) return toast("No booking or guest found.", "warn");
  openDialog(`<div class="dh"><div><h3>Guests matching “${esc(v)}”</h3><p>${res.length} found · tap a guest to see their stays</p></div>${closeBtn}</div><div class="db"><div class="card"><div class="tw"><table><tbody>${res.map(c => `<tr class="click" data-g="${esc(c.id)}"><td>${esc(c.name)}<span class="sub">${esc(c.email || "")}</span></td><td>${esc(c.phone || c.id)}</td><td>${badge(c.category || "regular")}</td></tr>`).join("")}</tbody></table></div></div></div>`, { size: "md" });
  $$("[data-g]", dlg()).forEach(tr => tr.onclick = () => customerHistory(res.find(c => c.id === tr.dataset.g)));
}
const setNet = () => { const on = navigator.onLine; $("#netTxt").textContent = on ? "Online" : "Offline"; $("#netDot").classList.toggle("off", !on); if (!on && ME) toast("You're offline. Changes will fail until the connection returns.", "warn"); };
addEventListener("online", setNet); addEventListener("offline", setNet); setNet();
let dip = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); dip = e; $("#installBtn").classList.remove("hidden"); });
$("#installBtn").onclick = async () => { if (!dip) return; dip.prompt(); await dip.userChoice; dip = null; $("#installBtn").classList.add("hidden"); };
addEventListener("appinstalled", () => $("#installBtn").classList.add("hidden"));
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").then(reg => reg.addEventListener("updatefound", () => { const w = reg.installing; w?.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) toast("A new version is available – reload to update.", "info"); }); })).catch(console.error);
}

onAuthStateChanged(auth, async u => { if (u) { try { await enter(u); } catch (e) { console.error(e); $("#loginErr").textContent = errMsg(e); await signOut(auth); } } else clearSession(); });
