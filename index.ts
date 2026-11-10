// Edge Function "notify".
// 1) Scheduled sweep: POST with header x-cron-secret (pg_cron every minute).
// 2) User call: POST with the user's JWT and {type:"task_done"|"test"|"session_done", ...}.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
webpush.setVapidDetails(Deno.env.get("VAPID_SUBJECT")!, Deno.env.get("VAPID_PUBLIC_KEY")!, Deno.env.get("VAPID_PRIVATE_KEY")!);
const APP_URL = Deno.env.get("APP_URL") ?? "/";

const istParts = (d: Date) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(d).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, hour: +p.hour };
};
const dayDiff = (a: string, b: string) => Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 864e5);
const deadline = (t: any) => new Date(`${t.task_date}T${t.end_time}+05:30`);

async function send(userId: string, type: string, key: string, title: string, body: string,
  opt: { subject?: string; task_id?: string; url?: string } = {}) {
  // Insert the log row first; the unique(user_id, dedupe_key) constraint blocks duplicates.
  const { data: log, error } = await sb.from("notification_log").insert({
    user_id: userId, type, dedupe_key: key, subject: opt.subject ?? null, task_id: opt.task_id ?? null }).select("id").single();
  if (error) return error.code === "23505" ? "duplicate" : `log_error:${error.message}`;
  const { data: subs } = await sb.from("push_subscriptions").select("*").eq("user_id", userId);
  if (!subs?.length) { await sb.from("notification_log").update({ status: "no_device" }).eq("id", log.id); return "no_device"; }
  const payload = JSON.stringify({ title, body, url: opt.url ?? APP_URL, tag: key });
  let ok = 0; const errs: string[] = [];
  for (const s of subs) {
    try { await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload); ok++; }
    catch (e: any) {
      if (e.statusCode === 404 || e.statusCode === 410) await sb.from("push_subscriptions").delete().eq("id", s.id); // expired
      else errs.push(`${e.statusCode ?? ""} ${e.body ?? e.message}`);
    }
  }
  await sb.from("notification_log").update({ status: ok ? "sent" : "failed", error: errs.join("; ") || null }).eq("id", log.id);
  return ok ? "sent" : "failed";
}

async function sweep() {
  const now = new Date(), ist = istParts(now);
  const { data: users } = await sb.from("notification_prefs").select("*");
  for (const p of users ?? []) {
    const uid = p.user_id;
    const { data: tasks } = await sb.from("tasks").select("*").eq("user_id", uid).eq("task_date", ist.date);
    const open = (tasks ?? []).filter((t: any) => !t.done);

    if (p.pending) for (const t of open) {
      const mins = (now.getTime() - deadline(t).getTime()) / 6e4, link = `${APP_URL}#plan-${t.id}`;
      if (mins < 0 && mins >= -p.lead_minutes)
        await send(uid, "task_lead", `lead:${t.id}`, "⏰ TASK DEADLINE SOON", `"${t.title}" (${t.subject ?? "General"}) is due in ${Math.ceil(-mins)} min.`, { subject: t.subject, task_id: t.id, url: link });
      else if (mins >= 0 && mins < p.followup_minutes)
        await send(uid, "task_due", `due:${t.id}`, "⚠️ PENDING TASK!", `Deadline reached for "${t.title}" (${t.subject ?? "General"}). You still have ${open.length} unfinished task(s) today.`, { subject: t.subject, task_id: t.id, url: link });
      else if (mins >= p.followup_minutes) {
        const n = Math.floor(mins / p.followup_minutes);
        if (n <= 3) await send(uid, "task_followup", `follow:${t.id}:${n}`, "⚠️ PENDING TASK!", `You still have ${open.length} unfinished task(s) today. Don't postpone your preparation.`, { subject: t.subject, task_id: t.id, url: link });
      }
    }

    if (p.daily_summary && ist.hm >= p.summary_time.slice(0, 5)) {
      const done = (tasks ?? []).length - open.length;
      await send(uid, "daily_summary", `summary:${ist.date}`, "YOUR DAILY STUDY REPORT",
        `Planned tasks: ${(tasks ?? []).length}\nCompleted: ${done}\nPending: ${open.length}\nFinish strong!`);
    }

    if (p.motivation && ist.hm >= p.motivation_time.slice(0, 5) && ist.hour < 12)
      await send(uid, "motivation", `motiv:${ist.date}`, "🔥 MISSION", "CLEAR ALL BACKLOGS. PASS ALL EIGHT EXAMINATIONS. MAKE YOURSELF PROUD.");

    if (p.water && ist.hour >= 7 && ist.hour < 22)
      await send(uid, "water", `water:${ist.date}:${Math.floor((ist.hour * 60 + +ist.hm.slice(3)) / p.water_minutes)}`, "💧 HYDRATION CHECK!", "Take a few sips of water. Your brain needs energy too!");

    if (p.exam && ist.hm >= "07:00") {
      const { data: exams } = await sb.from("exams").select("*").eq("user_id", uid);
      const byDate: Record<string, any[]> = {};
      for (const e of exams ?? []) (byDate[istParts(new Date(e.starts_at)).date] ??= []).push(e);
      for (const [d, list] of Object.entries(byDate)) {
        const left = dayDiff(ist.date, d);
        if (!p.exam_days.includes(left)) continue;
        if (list.length > 1 && left === 0) {
          list.sort((a, b) => +new Date(a.starts_at) - +new Date(b.starts_at));
          await send(uid, "exam_double", `double:${d}`, "⚠️ DOUBLE EXAMINATION ALERT!",
            `Today you have:\n${list.map(e => `${e.short}: ${e.time_label}`).join("\n")}\n\nStay calm. You have prepared for both.`);
        } else for (const e of list) {
          const when = left === 0 ? "is TODAY" : `is in ${left} day(s)`;
          await send(uid, "exam", `exam:${e.id}:${left}`, "⏳ EXAM ALERT!",
            `${e.short} examination ${when}.\nDate: ${d}\nTime: ${e.time_label}\nMarks: ${e.marks}\n\nCheck your preparation and finish pending topics.`, { subject: e.short });
        }
      }
    }
  }
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get("x-cron-secret") && req.headers.get("x-cron-secret") === Deno.env.get("CRON_SECRET")) {
      await sweep(); return new Response("ok");
    }
    const jwt = req.headers.get("Authorization")?.replace("Bearer ", "");
    const { data: { user } } = await sb.auth.getUser(jwt ?? "");
    if (!user) return new Response("unauthorized", { status: 401 });
    const b = await req.json();
    let r = "bad_request";
    if (b.type === "test") r = await send(user.id, "test", `test:${Date.now()}`, "✅ Test notification", "Push notifications are working on this device.");
    if (b.type === "task_done") {
      const { data: t } = await sb.from("tasks").select("*").eq("id", b.task_id).eq("user_id", user.id).single(); // authorization check
      const { data: p } = await sb.from("notification_prefs").select("task_done").eq("user_id", user.id).single();
      if (t?.done && p?.task_done) r = await send(user.id, "task_done", `done:${t.id}`, "✅ TASK COMPLETED!",
        `You completed: ${t.title}.\nSubject: ${t.subject ?? "General"}\nAt ${istParts(new Date(t.done_at ?? Date.now())).hm} IST\n\nOne more step towards clearing your backlog!`, { subject: t.subject, task_id: t.id });
    }
    if (b.type === "session_done") {
      const { data: p } = await sb.from("notification_prefs").select("session_done").eq("user_id", user.id).single();
      if (p?.session_done) r = await send(user.id, "session_done", `session:${String(b.session_id).slice(0, 40)}`, "⏱️ SESSION COMPLETE", "Excellent work! Another step towards clearing your examinations.");
    }
    return new Response(JSON.stringify({ result: r }), { headers: { "content-type": "application/json" } });
  } catch (e) { return new Response(String(e), { status: 500 }); }
});
