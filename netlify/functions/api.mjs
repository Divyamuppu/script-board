import { neon } from "@neondatabase/serverless";
import { createHmac, createHash, timingSafeEqual } from "node:crypto";

// Tolerate pasted values like: # comment DATABASE_URL='postgresql://…'
const RAW = process.env.NETLIFY_DATABASE_URL || process.env.DATABASE_URL || "";
const URL_ = (RAW.match(/postgres(?:ql)?:\/\/[^\s'"]+/) || [])[0];
const sql = URL_ ? neon(URL_) : null;
let ready;
const init = () => (ready ||= (async () => {
  await sql`create table if not exists sb_scripts (id text primary key, data jsonb not null, updated_at timestamptz not null default now())`;
  await sql`create table if not exists sb_meta (key text primary key, data jsonb not null)`;
})().catch(e => { ready = null; throw e; }));

const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const MAX = 300_000;

// ---- Google sign-in ----
const list = v => String(v || "").split(",").map(s => s.trim().toLowerCase().replace(/^@/, "")).filter(Boolean);
const CID_RAW = String(process.env.GOOGLE_CLIENT_ID || "").trim();
const CID = (CID_RAW.match(/[\w-]+\.apps\.googleusercontent\.com/) || [CID_RAW.replace(/^['"]|['"]$/g, "")])[0];
const DOMAINS = list(process.env.ALLOWED_DOMAIN);
const EMAILS = list(process.env.ALLOWED_EMAILS);
const SECRET = process.env.SESSION_SECRET || createHash("sha256").update("scriptboard|" + RAW).digest("hex");
const DAYS30 = 30 * 864e5;
const mac = d => createHmac("sha256", SECRET).update(d).digest("base64url");
const sign = p => { const d = Buffer.from(JSON.stringify(p)).toString("base64url"); return d + "." + mac(d); };
const unsign = t => {
  const [d, s] = String(t || "").split(".");
  if (!d || !s) return null;
  const e = mac(d);
  if (s.length !== e.length || !timingSafeEqual(Buffer.from(s), Buffer.from(e))) return null;
  try { const p = JSON.parse(Buffer.from(d, "base64url").toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
};
const allowedEmail = e => (!DOMAINS.length && !EMAILS.length) || EMAILS.includes(e) || DOMAINS.some(d => e.endsWith("@" + d));

export default async (req) => {
  try { return await handle(req); }
  catch (e) { console.error("api error:", e?.name, e?.code || ""); return json({ error: "Database error. Check the DATABASE_URL value and Neon status." }, 500); }
};

async function handle(req) {
  const parts = new URL(req.url).pathname.replace(/^.*?\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const m = req.method, [res, id] = parts;

  if (res === "config" && m === "GET") return json({ auth: !!CID, clientId: CID, domain: DOMAINS[0] || "" });

  if (!sql) return json({ error: "Database not connected. Set DATABASE_URL to your postgresql:// connection string." }, 500);
  await init();

  let body = null;
  if (m !== "GET" && m !== "DELETE") {
    const raw = await req.text();
    if (raw.length > MAX) return json({ error: "too_large" }, 413);
    try { body = raw ? JSON.parse(raw) : null; } catch { return json({ error: "bad_json" }, 400); }
  }

  if (res === "sheet" && m === "POST") {
    const k = process.env.SHEET_KEY; // optional: only checked if set in Netlify
    if (k && req.headers.get("x-sheet-key") !== k) return json({ error: "unauthorized" }, 401);
    const tab = ["perf", "pbv", "pbc", "li"].includes(body?.tab) ? body.tab : "perf";
    let added = 0;
    for (const r of (Array.isArray(body?.rows) ? body.rows : []).slice(0, 50)) {
      const script = String(r?.script || "").replace(/\r\n?/g, "\n").trim().slice(0, 100000);
      if (!script) continue;
      const id = "sh_" + createHash("sha256").update(String(r?.key || script)).digest("hex").slice(0, 16);
      const first = String(r?.title || "").trim() || script.split("\n").find(l => l.trim()).trim();
      const now = Date.now();
      const data = { title: first.length > 80 ? first.slice(0, 79).trimEnd() + "…" : first, tab, stage: "draft", format: "", owner: "", link: "", drive: [], shootDate: "", dueDate: "", notes: "", script, tasks: [], createdAt: now, updatedAt: now, by: "", byName: "Google Doc", source: "doc" };
      const out = await sql`insert into sb_scripts (id, data) values (${id}, ${JSON.stringify(data)}::jsonb) on conflict (id) do nothing returning id`;
      added += out.length;
    }
    return json({ ok: true, added });
  }

  if (res === "login" && m === "POST") {
    if (!CID) return json({ error: "login_off" }, 400);
    const r = await fetch("https://oauth2.googleapis.com/tokeninfo?id_token=" + encodeURIComponent(String(body?.credential || "")));
    if (!r.ok) return json({ error: "bad_token" }, 401);
    const g = await r.json();
    if (g.aud !== CID || !["accounts.google.com", "https://accounts.google.com"].includes(g.iss) || String(g.email_verified) !== "true") return json({ error: "bad_token" }, 401);
    const email = String(g.email || "").toLowerCase();
    if (!allowedEmail(email)) return json({ error: "not_allowed", email }, 403);
    const name = String(g.name || email.split("@")[0]).slice(0, 60);
    // Put the person on the Team (or attach their email to a matching name) so they get tag emails.
    const t = await sql`select data from sb_meta where key = 'team'`;
    const d = t[0]?.data || { members: Array.isArray(body?.seedTeam?.members) ? body.seedTeam.members : Array.isArray(body?.seedTeam) ? body.seedTeam : [] };
    const mem = (Array.isArray(d.members) ? d.members : []).map(x => ({ name: String(x.name || ""), role: String(x.role || ""), email: String(x.email || "") }));
    if (!mem.some(x => x.email.toLowerCase() === email)) {
      const same = mem.find(x => !x.email && x.name.toLowerCase() === name.toLowerCase());
      if (same) same.email = email; else mem.push({ name, role: "", email });
      await sql`insert into sb_meta (key, data) values ('team', ${JSON.stringify({ ...d, members: mem })}::jsonb) on conflict (key) do update set data = excluded.data`;
    }
    return json({ token: sign({ email, name, exp: Date.now() + DAYS30 }), email, name });
  }

  const sess = unsign((req.headers.get("authorization") || "").replace(/^Bearer\s+/i, ""));
  if (CID && !sess) return json({ error: "unauthorized" }, 401);
  if (res === "me" && m === "GET") return json({ email: sess.email, name: sess.name });

  if (res === "state" && m === "GET") {
    const rows = await sql`select id, data from sb_scripts order by updated_at desc`;
    const t = await sql`select data from sb_meta where key = 'team'`;
    return json({ scripts: rows.map(r => ({ ...r.data, id: r.id })), team: t[0]?.data ?? null });
  }

  // First-run import: only fills an empty board.
  if (res === "seed" && m === "POST") {
    const [{ n }] = await sql`select count(*)::int as n from sb_scripts`;
    if (n === 0 && Array.isArray(body?.scripts)) {
      for (const s of body.scripts.slice(0, 200)) await sql`insert into sb_scripts (id, data) values (${crypto.randomUUID().slice(0, 12)}, ${JSON.stringify(s)}::jsonb) on conflict do nothing`;
    }
    if (body?.team) await sql`insert into sb_meta (key, data) values ('team', ${JSON.stringify(body.team)}::jsonb) on conflict (key) do nothing`;
    return json({ ok: true });
  }

  // Passcode only applies when Google sign-in is off.
  const key = process.env.EDIT_KEY;
  if (!CID && m !== "GET" && key && req.headers.get("x-edit-key") !== key) return json({ error: "unauthorized" }, 401);
  if (body !== null && (typeof body !== "object" || Array.isArray(body))) return json({ error: "bad_body" }, 400);
  if (sess && body && res === "scripts") { body.by = sess.email; body.byName = sess.name; }

  if (res === "scripts") {
    if (!id && m === "POST") {
      const nid = crypto.randomUUID().slice(0, 12);
      await sql`insert into sb_scripts (id, data) values (${nid}, ${JSON.stringify(body)}::jsonb)`;
      return json({ ok: true, id: nid });
    }
    if (id && m === "PUT") { await sql`insert into sb_scripts (id, data) values (${id}, ${JSON.stringify(body)}::jsonb) on conflict (id) do update set data = excluded.data, updated_at = now()`; return json({ ok: true }); }
    if (id && m === "PATCH") { await sql`update sb_scripts set data = data || ${JSON.stringify(body)}::jsonb, updated_at = now() where id = ${id}`; return json({ ok: true }); }
    if (id && m === "DELETE") { await sql`delete from sb_scripts where id = ${id}`; return json({ ok: true }); }
  }

  // Email only goes to addresses saved under Team, so the endpoint can't be used to spam others.
  if (res === "notify" && m === "POST") {
    const hook = (String(process.env.MAIL_WEBHOOK || "").match(/https:\/\/script\.google\.com\/[^\s'"]+/) || [])[0];
    if (hook) {
      const t = await sql`select data from sb_meta where key = 'team'`;
      const allowed = new Set((t[0]?.data?.members || []).map(x => String(x.email || "").trim().toLowerCase()).filter(Boolean));
      const to = [...new Set((body?.to || []).map(e => String(e).trim().toLowerCase()))].filter(e => allowed.has(e)).slice(0, 10);
      if (!to.length) return json({ error: "no_recipients" }, 400);
      const r = await fetch(hook, { method: "POST", headers: { "content-type": "application/json" }, redirect: "follow",
        body: JSON.stringify({ to, subject: String(body.subject || "Script board").slice(0, 200), text: String(body.text || "").slice(0, 8000), replyTo: sess?.email || "", fromName: sess?.name || "" }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { console.error("gmail", r.status, JSON.stringify(j).slice(0, 300)); return json({ error: "send_failed" }, 502); }
      return json({ ok: true, sent: to.length });
    }
    const k = process.env.BREVO_API_KEY;
    const from = (process.env.MAIL_FROM || "").match(/^\s*(?:"?([^"<]*?)"?\s*<)?\s*([^\s<>]+@[^\s<>]+)\s*>?\s*$/);
    if (!k || !from) return json({ error: "email_off" }, 501);
    const t = await sql`select data from sb_meta where key = 'team'`;
    const allowed = new Set((t[0]?.data?.members || []).map(x => String(x.email || "").trim().toLowerCase()).filter(Boolean));
    const to = [...new Set((body?.to || []).map(e => String(e).trim().toLowerCase()))].filter(e => allowed.has(e)).slice(0, 10);
    if (!to.length) return json({ error: "no_recipients" }, 400);
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": k, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: (from[1] || "Script board").trim(), email: from[2] },
        ...(sess ? { replyTo: { email: sess.email, name: sess.name } } : {}),
        to: to.map(email => ({ email })),
        subject: String(body.subject || "Script board").slice(0, 200),
        textContent: String(body.text || "").slice(0, 8000),
      }),
    });
    if (!r.ok) { console.error("brevo", r.status, (await r.text()).slice(0, 300)); return json({ error: "send_failed" }, 502); }
    return json({ ok: true, sent: to.length });
  }

  if (res === "team" && m === "PUT") {
    await sql`insert into sb_meta (key, data) values ('team', ${JSON.stringify(body)}::jsonb) on conflict (key) do update set data = excluded.data`;
    return json({ ok: true });
  }

  return json({ error: "not_found" }, 404);
}

export const config = { path: "/api/*" };
