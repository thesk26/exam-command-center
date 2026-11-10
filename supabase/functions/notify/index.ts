import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const supabaseUrl = Deno.env.get("SUPABASE_URL");
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const cronSecret = Deno.env.get("CRON_SECRET");
const vapidPublicKey = Deno.env.get("VAPID_PUBLIC_KEY");
const vapidPrivateKey = Deno.env.get("VAPID_PRIVATE_KEY");
const vapidSubject = Deno.env.get("VAPID_SUBJECT");
const appUrl = Deno.env.get("APP_URL") ?? "/";
const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("APP_URL") ?? "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

if (!supabaseUrl || !serviceRoleKey) throw new Error("Supabase function secrets are not configured.");
const supabase = createClient(supabaseUrl, serviceRoleKey);
const vapidReady = Boolean(vapidPublicKey && vapidPrivateKey && vapidSubject);
if (vapidReady) webpush.setVapidDetails(vapidSubject!, vapidPublicKey!, vapidPrivateKey!);

const motivationalMessages = [
  "Three backlogs to clear. Make this attempt count!",
  "Every completed topic brings you closer to success.",
  "Stop worrying about the result. Focus on today's work.",
  "Your future self will thank you for the work you do today.",
  "Three backlogs. Eight exams. One mission.",
];

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function istParts(date: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date).map((part) => [part.type, part.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hm: `${parts.hour}:${parts.minute}`, hour: Number(parts.hour), minute: Number(parts.minute) };
}

function dateDifference(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

function taskDeadline(task: { task_date: string; end_time: string }) {
  return new Date(`${task.task_date}T${task.end_time}+05:30`);
}

async function sendPush(userId: string, type: string, key: string, title: string, body: string, options: { subject?: string; task_id?: string; url?: string } = {}) {
  if (!vapidReady) return "vapid_not_configured";
  const { data: log, error: logError } = await supabase.from("notification_log").insert({
    user_id: userId, type, dedupe_key: key, subject: options.subject ?? null, task_id: options.task_id ?? null,
  }).select("id").single();
  if (logError) return logError.code === "23505" ? "duplicate" : "log_error";
  const { data: subscriptions } = await supabase.from("push_subscriptions").select("id,endpoint,p256dh,auth").eq("user_id", userId);
  if (!subscriptions?.length) {
    await supabase.from("notification_log").update({ status: "no_device" }).eq("id", log.id);
    return "no_device";
  }
  const payload = JSON.stringify({ title, body, url: options.url ?? appUrl, tag: key });
  let delivered = 0;
  const errors: string[] = [];
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
      delivered += 1;
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode;
      if (status === 404 || status === 410) await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
      else errors.push(`status:${status ?? "unknown"}`);
    }
  }
  await supabase.from("notification_log").update({ status: delivered ? "sent" : "failed", error: errors.join(", ") || null }).eq("id", log.id);
  return delivered ? "sent" : "failed";
}

async function runScheduledSweep() {
  const now = new Date();
  const ist = istParts(now);
  const dayStart = `${ist.date}T00:00:00+05:30`;
  const nextDay = new Date(new Date(dayStart).getTime() + 86400000).toISOString();
  const { data: preferences } = await supabase.from("notification_prefs").select("*");

  for (const preference of preferences ?? []) {
    const userId = preference.user_id;
    const { data: taskRows } = await supabase.from("tasks").select("*").eq("user_id", userId).eq("task_date", ist.date);
    const tasks = taskRows ?? [];
    const openTasks = tasks.filter((task) => !task.done);

    if (preference.pending) for (const task of openTasks) {
      const minutesAfterDeadline = (now.getTime() - taskDeadline(task).getTime()) / 60000;
      const taskUrl = `${appUrl}#plan-${task.id}`;
      if (minutesAfterDeadline < 0 && minutesAfterDeadline >= -preference.lead_minutes) {
        await sendPush(userId, "task_lead", `lead:${task.id}`, "⏰ TASK DEADLINE SOON", `“${task.title}” (${task.subject ?? "General"}) is due in ${Math.ceil(-minutesAfterDeadline)} min.`, { subject: task.subject ?? undefined, task_id: task.id, url: taskUrl });
      } else if (minutesAfterDeadline >= 0 && minutesAfterDeadline < preference.followup_minutes) {
        await sendPush(userId, "task_due", `due:${task.id}`, "⚠️ PENDING TASK!", `Deadline reached for “${task.title}” (${task.subject ?? "General"}). You still have ${openTasks.length} unfinished task(s) today.`, { subject: task.subject ?? undefined, task_id: task.id, url: taskUrl });
      } else if (minutesAfterDeadline >= preference.followup_minutes) {
        const followup = Math.floor(minutesAfterDeadline / preference.followup_minutes);
        if (followup <= 3) await sendPush(userId, "task_followup", `follow:${task.id}:${followup}`, "⚠️ PENDING TASK!", `You still have ${openTasks.length} unfinished task(s) today. Don't postpone your preparation.`, { subject: task.subject ?? undefined, task_id: task.id, url: taskUrl });
      }
    }

    if (preference.daily_summary && ist.hm >= String(preference.summary_time).slice(0, 5)) {
      const { data: sessions } = await supabase.from("study_sessions").select("duration_minutes").eq("user_id", userId).eq("session_type", "study").gte("started_at", dayStart).lt("started_at", nextDay);
      const studyMinutes = (sessions ?? []).reduce((total, session) => total + Number(session.duration_minutes), 0);
      const completed = tasks.filter((task) => task.done).length;
      const target = Number(preference.daily_target_minutes ?? 600);
      await sendPush(userId, "daily_summary", `summary:${ist.date}`, "YOUR DAILY STUDY REPORT", `Planned tasks: ${tasks.length}\nCompleted: ${completed}\nPending: ${openTasks.length}\nStudy hours: ${(studyMinutes / 60).toFixed(1)}\nRemaining target: ${(Math.max(0, target - studyMinutes) / 60).toFixed(1)} hours\n\nFinish strong!`);
    }

    if (preference.motivation && ist.hm >= String(preference.motivation_time).slice(0, 5) && ist.hour < 22) {
      const startMinute = Number(String(preference.motivation_time).slice(0, 2)) * 60 + Number(String(preference.motivation_time).slice(3, 5));
      const currentMinute = ist.hour * 60 + ist.minute;
      const interval = Math.max(10, Number(preference.motivation_interval_minutes ?? 30));
      const slot = Math.floor((currentMinute - startMinute) / interval);
      const message = motivationalMessages[(slot + new Date().getDate()) % motivationalMessages.length];
      await sendPush(userId, "motivation", `motiv:${ist.date}:${slot}`, "🔥 MISSION", message);
    }

    if (preference.water && ist.hour >= 7 && ist.hour < 22) {
      const interval = Math.max(15, Number(preference.water_interval_minutes ?? 60));
      const slot = Math.floor((ist.hour * 60 + ist.minute) / interval);
      await sendPush(userId, "water", `water:${ist.date}:${slot}`, "💧 HYDRATION CHECK!", "Take a few sips of water. Your brain needs energy too!");
    }

    if (preference.exam && ist.hm >= "07:00") {
      const { data: exams } = await supabase.from("exams").select("id,code,short,name,starts_at,time_label,marks").eq("user_id", userId);
      const grouped: Record<string, typeof exams> = {};
      for (const exam of exams ?? []) {
        const examDate = istParts(new Date(exam.starts_at)).date;
        (grouped[examDate] ??= []).push(exam);
      }
      for (const [examDate, dayExams] of Object.entries(grouped)) {
        const daysLeft = dateDifference(ist.date, examDate);
        if (!(preference.exam_days as number[]).includes(daysLeft)) continue;
        if (dayExams.length > 1 && daysLeft === 0) {
          const schedule = dayExams.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).map((exam) => `${exam.short}: ${exam.time_label}`).join("\n");
          await sendPush(userId, "exam_double", `double:${examDate}`, "⚠️ DOUBLE EXAMINATION ALERT!", `Today you have:\n${schedule}\n\nStay calm. You have prepared for both.`);
        } else for (const exam of dayExams) {
          const when = daysLeft === 0 ? "is TODAY" : `is in ${daysLeft} day(s)`;
          await sendPush(userId, "exam", `exam:${exam.id}:${daysLeft}`, "⏳ EXAM ALERT!", `${exam.short} examination ${when}.\nDate: ${examDate}\nTime: ${exam.time_label}\nMarks: ${exam.marks}\n\nCheck your preparation and finish pending topics.`, { subject: exam.short });
        }
      }
    }
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);
  try {
    const cronHeader = request.headers.get("x-cron-secret");
    if (cronHeader && cronSecret && cronHeader === cronSecret) {
      await runScheduledSweep();
      return jsonResponse({ result: "ok" });
    }
    const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    const { data: { user } } = await supabase.auth.getUser(token);
    if (!user) return jsonResponse({ error: "unauthorized" }, 401);
    const body = await request.json();
    if (body.type === "test") {
      const result = await sendPush(user.id, "test", `test:${crypto.randomUUID()}`, "✅ Test notification", "Push notifications are working on this device.");
      return jsonResponse({ result });
    }
    if (body.type === "task_done" && typeof body.task_id === "string") {
      const { data: task } = await supabase.from("tasks").select("id,title,subject,done,done_at").eq("id", body.task_id).eq("user_id", user.id).single();
      const { data: preference } = await supabase.from("notification_prefs").select("task_done").eq("user_id", user.id).single();
      if (task?.done && preference?.task_done) {
        const completedAt = istParts(new Date(task.done_at ?? Date.now())).hm;
        const result = await sendPush(user.id, "task_done", `done:${task.id}`, "✅ TASK COMPLETED!", `You completed: ${task.title}.\nSubject: ${task.subject ?? "General"}\nAt ${completedAt} IST\n\nOne more step towards clearing your backlog!`, { subject: task.subject ?? undefined, task_id: task.id });
        return jsonResponse({ result });
      }
      return jsonResponse({ result: "not_eligible" });
    }
    if (body.type === "session_done" && typeof body.session_id === "string") {
      const { data: preference } = await supabase.from("notification_prefs").select("session_done").eq("user_id", user.id).single();
      const { data: session } = await supabase.from("study_sessions").select("id").eq("id", body.session_id).eq("user_id", user.id).single();
      if (preference?.session_done && session) {
        const result = await sendPush(user.id, "session_done", `session:${session.id}`, "⏱️ SESSION COMPLETE", "Excellent work! Another step towards clearing your examinations.");
        return jsonResponse({ result });
      }
      return jsonResponse({ result: "not_eligible" });
    }
    return jsonResponse({ error: "bad_request" }, 400);
  } catch {
    return jsonResponse({ error: "notification_request_failed" }, 500);
  }
});