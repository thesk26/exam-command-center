import { useEffect, useState, type FormEvent } from "react";
import { Activity, Bell, BookOpen, CalendarDays, Check, ChevronLeft, ChevronRight, Clock3, Download, LoaderCircle, Plus, Save, ShieldCheck, Trash2, Upload, Wifi, WifiOff } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { subscribeToPush, unsubscribeFromPush } from "./push";
import { queueMutation } from "./offline";

export type ModulePage = "planner" | "exams" | "revision" | "pyq" | "mocks" | "analytics" | "settings" | "motivation";
type PlannerTask = {
  id: string;
  title: string;
  subject: string | null;
  task_date: string;
  start_time: string;
  end_time: string;
  done: boolean;
};
type Exam = {
  id: string;
  code: string;
  short: string;
  name: string;
  starts_at: string;
  time_label: string;
  marks: number;
  exam_type: "backlog" | "regular";
};
type SubjectOption = { id: string; name: string };


function formatDay(date: string) {
  return new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T12:00:00+05:30`));
}

export function StudyModules({ page, client, userId }: { page: ModulePage; client: SupabaseClient; userId: string }) {
  if (page === "planner") return <PlannerPage client={client} userId={userId} />;
  if (page === "exams") return <ExamCalendarPage client={client} userId={userId} />;
  if (page === "revision") return <RevisionPage client={client} userId={userId} />;
  if (page === "pyq" || page === "mocks") return <PracticePage client={client} userId={userId} mode={page} />;
  if (page === "analytics") return <AnalyticsPage client={client} userId={userId} />;
  if (page === "motivation") return <MotivationPage />;
  return <SettingsPage client={client} userId={userId} />;
}

function PlannerPage({ client, userId }: { client: SupabaseClient; userId: string }) {
  const [date, setDate] = useState(indiaDate());
  const [tasks, setTasks] = useState<PlannerTask[]>([]);
  const [subjects, setSubjects] = useState<SubjectOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const [taskResult, subjectResult] = await Promise.all([
        client.from("tasks").select("id,title,subject,task_date,start_time,end_time,done").eq("user_id", userId).eq("task_date", date).order("start_time"),
        client.from("subjects").select("id,name").eq("user_id", userId).order("name"),
      ]);
      if (!active) return;
      if (taskResult.error) setError("Planner tasks could not be loaded.");
      else setTasks((taskResult.data ?? []) as PlannerTask[]);
      if (!subjectResult.error) setSubjects((subjectResult.data ?? []) as SubjectOption[]);
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [client, date, userId]);

  useEffect(() => {
    const channel = client.channel(`planner-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` }, () => {
        client.from("tasks").select("id,title,subject,task_date,start_time,end_time,done").eq("user_id", userId).eq("task_date", date).order("start_time").then(({ data }) => { if (data) setTasks(data as PlannerTask[]); });
      })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, date, userId]);

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const selected = subjects.find((subject) => subject.id === values.get("subject_id"));
    const payload = {
      id: crypto.randomUUID(),
      user_id: userId,
      title: String(values.get("title")).trim(),
      subject: selected?.name ?? null,
      task_date: date,
      start_time: String(values.get("start_time")),
      end_time: String(values.get("end_time")),
    };
    if (!navigator.onLine) {
      const task: PlannerTask = { ...payload, done: false };
      queueMutation({ userId, table: "tasks", operation: "insert", row: task });
      setTasks((current) => [...current, task].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      form.reset(); setShowForm(false); setNotice("Saved offline. This task will sync when you reconnect."); return;
    }
    const { data, error: insertError } = await client.from("tasks").insert(payload).select("id,title,subject,task_date,start_time,end_time,done").single();
    if (insertError) setError("Task could not be saved. End time must be after start time.");
    else {
      setTasks((current) => [...current, data as PlannerTask].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      form.reset();
      setShowForm(false);
      setNotice("Task added to the cloud planner.");
    }
  }

  async function setDone(task: PlannerTask) {
    const done = !task.done;
    if (!navigator.onLine) {
      const changes = { done, done_at: done ? new Date().toISOString() : null };
      queueMutation({ userId, table: "tasks", operation: "update", filterColumn: "id", filterValue: task.id, row: changes });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done } : item));
      setNotice("Task status queued for sync."); return;
    }
    const { error: updateError } = await client.from("tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", task.id).eq("user_id", userId);
    if (updateError) setError("Task status could not be updated.");
    else {
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done } : item));
      if (done) await client.functions.invoke("notify", { body: { type: "task_done", task_id: task.id } }).catch(() => undefined);
    }
  }

  async function removeTask(task: PlannerTask) {
    if (!window.confirm(`Delete “${task.title}” from the planner?`)) return;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "tasks", operation: "delete", filterColumn: "id", filterValue: task.id });
      setTasks((current) => current.filter((item) => item.id !== task.id)); setNotice("Task removal queued for sync."); return;
    }
    const { error: deleteError } = await client.from("tasks").delete().eq("id", task.id).eq("user_id", userId);
    if (deleteError) setError("Task could not be deleted.");
    else setTasks((current) => current.filter((item) => item.id !== task.id));
  }

  async function rescheduleTask(task: PlannerTask, nextDate: string) {
    if (!nextDate || nextDate === task.task_date) return;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "tasks", operation: "update", filterColumn: "id", filterValue: task.id, row: { task_date: nextDate } });
      setTasks((current) => current.filter((item) => item.id !== task.id)); setNotice("Reschedule queued for sync."); return;
    }
    const { error: updateError } = await client.from("tasks").update({ task_date: nextDate }).eq("id", task.id).eq("user_id", userId);
    if (updateError) setError("Task could not be rescheduled.");
    else { setTasks((current) => current.filter((item) => item.id !== task.id)); setNotice(`Task moved to ${formatDay(nextDate)}.`); }
  }

  function moveDay(amount: number) {
    const current = new Date(`${date}T12:00:00+05:30`);
    current.setDate(current.getDate() + amount);
    setDate(indiaDate(current));
  }

  const completeCount = tasks.filter((task) => task.done).length;

  return (
    <section className="module-content">
      <header className="module-header">
        <div><p className="eyebrow">DAILY PLANNER</p><h1>Plan a steady day.</h1><p className="module-subtitle">Your plan syncs through Supabase across your devices.</p></div>
        <button className="primary-button" onClick={() => setShowForm((open) => !open)}><Plus size={16} /> Add task</button>
      </header>
      <div className="planner-date-row"><button className="icon-button" onClick={() => moveDay(-1)} aria-label="Previous day"><ChevronLeft size={18} /></button><div className="planner-date"><CalendarDays size={18} /><strong>{formatDay(date)}</strong><input aria-label="Choose date" type="date" value={date} onChange={(event) => setDate(event.target.value)} /></div><button className="icon-button" onClick={() => moveDay(1)} aria-label="Next day"><ChevronRight size={18} /></button><button className="secondary-button today-button" onClick={() => setDate(indiaDate())}>Today</button></div>
      <div className="planner-summary"><span>{tasks.length} planned</span><span>{completeCount} completed</span><span>{tasks.length - completeCount} remaining</span></div>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
      {showForm && <form className="module-form" onSubmit={(event) => void addTask(event)}><h2>Plan a study block</h2><div className="module-form-grid"><label>Task<input name="title" placeholder="What will you work on?" required /></label><label>Subject<select name="subject_id" defaultValue=""><option value="">General study</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label>Start<input name="start_time" type="time" defaultValue="09:00" required /></label><label>End<input name="end_time" type="time" defaultValue="10:00" required /></label></div><div className="module-form-actions"><button className="primary-button" type="submit"><SaveIcon /> Save task</button><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button></div></form>}
      <section className="planner-timeline" aria-label="Scheduled tasks">
        {loading ? <div className="module-loading"><LoaderCircle className="spin" size={20} /> Loading plan</div> : tasks.length ? tasks.map((task) => <article className={task.done ? "planner-task is-done" : "planner-task"} key={task.id}><button className="task-check" onClick={() => void setDone(task)} aria-label={task.done ? "Mark incomplete" : "Mark complete"}>{task.done && <Check size={14} />}</button><div className="planner-task-time"><Clock3 size={15} /><span>{task.start_time.slice(0, 5)}–{task.end_time.slice(0, 5)}</span></div><div className="planner-task-copy"><strong>{task.title}</strong><span>{task.subject || "General"}</span></div><span className={task.done ? "task-status done-status" : "task-status"}>{task.done ? "Completed" : "Planned"}</span><label className="reschedule-control" title="Reschedule task"><CalendarDays size={14} /><input type="date" aria-label={`Reschedule ${task.title}`} value={date} onChange={(event) => void rescheduleTask(task, event.target.value)} disabled={task.done} /></label><button className="icon-button danger-icon" onClick={() => void removeTask(task)} aria-label={`Delete ${task.title}`}><Trash2 size={15} /></button></article>) : <div className="module-empty"><CalendarDays size={23} /><strong>No tasks planned</strong><span>Add a study block when you are ready. No sample schedule is inserted.</span></div>}
      </section>
    </section>
  );
}

function SaveIcon() {
  return <Check size={15} />;
}

function ExamCalendarPage({ client, userId }: { client: SupabaseClient; userId: string }) {
  const [exams, setExams] = useState<Exam[]>([]);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    const refresh = () => client.from("exams").select("id,code,short,name,starts_at,time_label,marks,exam_type").eq("user_id", userId).order("starts_at").then(({ data, error: fetchError }) => {
      if (!active) return;
      if (fetchError) setError("Examination dates could not be loaded.");
      else setExams((data ?? []) as Exam[]);
      setLoading(false);
    });
    void refresh();
    const channel = client.channel(`exams-${userId}`).on("postgres_changes", { event: "*", schema: "public", table: "exams", filter: `user_id=eq.${userId}` }, () => { void refresh(); }).subscribe();
    const ticker = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { active = false; window.clearInterval(ticker); void client.removeChannel(channel); };
  }, [client, userId]);

  const byDay = exams.reduce<Record<string, Exam[]>>((groups, exam) => {
    const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(exam.starts_at));
    (groups[date] ??= []).push(exam);
    return groups;
  }, {});

  return (
    <section className="module-content">
      <header className="module-header"><div><p className="eyebrow">ASIA/KOLKATA · ALL 8 PAPERS</p><h1>Exam calendar</h1><p className="module-subtitle">Countdowns use each exam’s configured time and the Asia/Kolkata timezone.</p></div></header>
      {error && <div className="error-banner" role="alert">{error}</div>}
      {loading ? <div className="module-loading"><LoaderCircle className="spin" size={20} /> Loading examinations</div> : <div className="exam-calendar-list">{Object.entries(byDay).map(([date, dailyExams]) => {
        const doubleDay = dailyExams.length > 1;
        return <section className={doubleDay ? "exam-day double-exam-day" : "exam-day"} key={date}>
          <div className="exam-day-heading"><div><span className="eyebrow">{doubleDay ? "DOUBLE EXAM DAY" : dailyExams[0].exam_type === "backlog" ? "BACKLOG PAPER" : "REGULAR PAPER"}</span><h2>{new Intl.DateTimeFormat("en-IN", { weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Kolkata" }).format(new Date(`${date}T12:00:00+05:30`))}</h2></div>{doubleDay && <span className="double-day-badge">{dailyExams.length} exams</span>}</div>
          <div className="exam-day-cards">{dailyExams.map((exam) => <ExamCard key={exam.id} exam={exam} now={now} />)}</div>
        </section>;
      })}{!exams.length && <div className="module-empty"><CalendarDays size={23} /><strong>No exam records</strong><span>The configured eight exams will appear here after the setup migration.</span></div>}</div>}
    </section>
  );
}

function ExamCard({ exam, now }: { exam: Exam; now: number }) {
  const difference = Math.max(0, new Date(exam.starts_at).getTime() - now);
  const seconds = Math.floor(difference / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  const started = difference === 0;
  return <article className="exam-countdown-card"><div className="exam-card-title"><span className={exam.exam_type === "backlog" ? "subject-badge backlog-badge" : "subject-badge regular-badge"}>{exam.exam_type === "backlog" ? "B" : "R"}</span><div><strong>{exam.short}</strong><span>{exam.name}</span></div></div><div className="countdown-values">{started ? <strong>Exam started</strong> : <><span><b>{days}</b><small>days</small></span><i>:</i><span><b>{String(hours).padStart(2, "0")}</b><small>hrs</small></span><i>:</i><span><b>{String(minutes).padStart(2, "0")}</b><small>min</small></span><i>:</i><span><b>{String(remainingSeconds).padStart(2, "0")}</b><small>sec</small></span></>}</div><div className="exam-card-meta"><span>{exam.time_label}</span><span>{exam.marks} marks</span><span>{exam.code}</span></div></article>;
}

type Revision = { id: string; topic_id: string; due_at: string; completed_at: string | null; confidence: number | null; notes: string };
type RevisionTopic = { id: string; title: string; subject_id: string; revision_count: number };

function RevisionPage({ client, userId }: { client: SupabaseClient; userId: string }) {
  const [revisions, setRevisions] = useState<Revision[]>([]);
  const [topics, setTopics] = useState<RevisionTopic[]>([]);
  const [subjectNames, setSubjectNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showDone, setShowDone] = useState(false);

  async function load() {
    setLoading(true);
    const [revisionResult, topicResult, subjectResult] = await Promise.all([
      client.from("revision_records").select("id,topic_id,due_at,completed_at,confidence,notes").eq("user_id", userId).order("due_at"),
      client.from("topics").select("id,title,subject_id,revision_count").eq("user_id", userId),
      client.from("subjects").select("id,name").eq("user_id", userId),
    ]);
    if (revisionResult.error || topicResult.error || subjectResult.error) setError("Revision records could not be loaded.");
    else {
      setRevisions((revisionResult.data ?? []) as Revision[]);
      setTopics((topicResult.data ?? []) as RevisionTopic[]);
      setSubjectNames(Object.fromEntries((subjectResult.data ?? []).map((subject: { id: string; name: string }) => [subject.id, subject.name])));
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [client, userId]);

  useEffect(() => {
    const refresh = () => { void load(); };
    const channel = client.channel(`revisions-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "revision_records", filter: `user_id=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "topics", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, userId]);

  async function completeRevision(revision: Revision) {
    const completedAt = new Date();
    const topic = topics.find((item) => item.id === revision.topic_id);
    if (!topic) {
      setError("This revision could not be marked complete.");
      return;
    }
    const nextCount = topic.revision_count + 1;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "revision_records", operation: "update", filterColumn: "id", filterValue: revision.id, row: { completed_at: completedAt.toISOString() } });
      queueMutation({ userId, table: "topics", operation: "update", filterColumn: "id", filterValue: topic.id, row: { revision_count: nextCount } });
      setRevisions((current) => current.map((item) => item.id === revision.id ? { ...item, completed_at: completedAt.toISOString() } : item));
      setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, revision_count: nextCount } : item));
      const offlineInterval = [2, 5, 10][nextCount - 1];
      if (offlineInterval) {
        const dueAt = new Date(completedAt.getTime() + offlineInterval * 86400000);
        const nextId = crypto.randomUUID();
        queueMutation({ userId, table: "revision_records", operation: "insert", row: { id: nextId, user_id: userId, topic_id: topic.id, due_at: dueAt.toISOString() } });
        setRevisions((current) => [...current, { id: nextId, topic_id: topic.id, due_at: dueAt.toISOString(), completed_at: null, confidence: null, notes: "" }]);
      }
      setNotice("Revision saved offline and queued for sync.");
      return;
    }
    const { error: updateError } = await client.from("revision_records").update({ completed_at: completedAt.toISOString() }).eq("id", revision.id).eq("user_id", userId);
    if (updateError) { setError("This revision could not be marked complete."); return; }
    await client.from("topics").update({ revision_count: nextCount }).eq("id", topic.id).eq("user_id", userId);
    setRevisions((current) => current.map((item) => item.id === revision.id ? { ...item, completed_at: completedAt.toISOString() } : item));
    setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, revision_count: nextCount } : item));
    const intervals = [2, 5, 10];
    const interval = intervals[nextCount - 1];
    if (interval) {
      const dueAt = new Date(completedAt.getTime() + interval * 86400000);
      const { data: nextRevision, error: insertError } = await client.from("revision_records").insert({ user_id: userId, topic_id: topic.id, due_at: dueAt.toISOString() }).select("id,topic_id,due_at,completed_at,confidence,notes").single();
      if (insertError) setNotice("Revision saved, but the next reminder could not be scheduled.");
      else setRevisions((current) => [...current, nextRevision as Revision].sort((a, b) => a.due_at.localeCompare(b.due_at)));
    }
    if (!interval) setNotice("Revision cycle complete for this topic.");
  }

  const today = new Date().toISOString().slice(0, 10);
  const visible = revisions.filter((item) => showDone ? Boolean(item.completed_at) : !item.completed_at);
  const dueCount = revisions.filter((item) => !item.completed_at && item.due_at.slice(0, 10) <= today).length;

  return <section className="module-content">
    <header className="module-header"><div><p className="eyebrow">SPACED PRACTICE</p><h1>Revision manager</h1><p className="module-subtitle">Revisions are scheduled when you mark a topic complete: same day, then 2, 5, and 10 days.</p></div><button className="secondary-button" onClick={() => setShowDone((value) => !value)}>{showDone ? "Show due" : "Show history"}</button></header>
    <div className="planner-summary"><span>{dueCount} due now</span><span>{revisions.filter((item) => item.completed_at).length} completed revisions</span></div>
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}{error && <div className="error-banner" role="alert">{error}</div>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={20} /> Loading revisions</div> : <div className="revision-list">{visible.map((revision) => {
      const topic = topics.find((item) => item.id === revision.topic_id);
      if (!topic) return null;
      const overdue = !revision.completed_at && revision.due_at.slice(0, 10) < today;
      return <article className="revision-row" key={revision.id}><span className={overdue ? "revision-marker overdue" : "revision-marker"} /><div className="revision-topic"><strong>{topic.title}</strong><span>{subjectNames[topic.subject_id] ?? "Subject"} · Revision {topic.revision_count + (revision.completed_at ? 0 : 1)}</span></div><div className="revision-due"><small>{revision.completed_at ? "COMPLETED" : overdue ? "OVERDUE" : "DUE"}</small><span>{new Date(revision.completed_at ?? revision.due_at).toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}</span></div>{!revision.completed_at && <button className="primary-button compact-button" onClick={() => void completeRevision(revision)}><Check size={14} /> Done</button>}</article>;
    })}{!visible.length && <div className="module-empty"><Check size={22} /><strong>{showDone ? "No revision history yet" : "Nothing due right now"}</strong><span>Complete topics in Subjects &amp; Topics to start a revision cycle.</span></div>}</div>}
  </section>;
}

type PracticeSubject = { id: string; name: string; total_marks: number };
type Pyq = { id: string; subject_id: string; question: string; unit_label: string; exam_year: number | null; marks: number | null; difficulty: "easy" | "medium" | "hard"; solved: boolean; accuracy: number | null; notes: string };
type Mock = { id: string; subject_id: string; test_date: string; total_marks: number; marks_obtained: number; duration_minutes: number | null; weak_topics: string[]; mistakes: string; improvement_strategy: string };

function PracticePage({ client, userId, mode }: { client: SupabaseClient; userId: string; mode: "pyq" | "mocks" }) {
  const isPyq = mode === "pyq";
  const [subjects, setSubjects] = useState<PracticeSubject[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [pyqs, setPyqs] = useState<Pyq[]>([]);
  const [mocks, setMocks] = useState<Mock[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function load() {
    setLoading(true);
    const [subjectResult, pyqResult, mockResult] = await Promise.all([
      client.from("subjects").select("id,name,total_marks").eq("user_id", userId).order("name"),
      client.from("pyq_records").select("id,subject_id,question,unit_label,exam_year,marks,difficulty,solved,accuracy,notes").eq("user_id", userId).order("created_at", { ascending: false }),
      client.from("mock_tests").select("id,subject_id,test_date,total_marks,marks_obtained,duration_minutes,weak_topics,mistakes,improvement_strategy").eq("user_id", userId).order("test_date", { ascending: false }),
    ]);
    if (subjectResult.error) setError("Subjects could not be loaded.");
    else {
      const loadedSubjects = (subjectResult.data ?? []) as PracticeSubject[];
      setSubjects(loadedSubjects);
      setSelectedSubjectId((current) => loadedSubjects.some((subject) => subject.id === current) ? current : loadedSubjects[0]?.id ?? "");
    }
    if (pyqResult.error || mockResult.error) setError("Practice records could not be loaded. Confirm the study modules migration.");
    else {
      setPyqs((pyqResult.data ?? []) as Pyq[]);
      setMocks((mockResult.data ?? []) as Mock[]);
    }
    setLoading(false);
  }

  useEffect(() => { void load(); }, [client, userId]);

  useEffect(() => {
    const table = mode === "pyq" ? "pyq_records" : "mock_tests";
    const channel = client.channel(`practice-${mode}-${userId}`).on("postgres_changes", { event: "*", schema: "public", table, filter: `user_id=eq.${userId}` }, () => { void load(); }).subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, mode, userId]);

  async function addRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const subject = subjects.find((item) => item.id === selectedSubjectId);
    if (!subject) {
      setError("Add a subject before recording practice work.");
      return;
    }
    if (isPyq) {
      const payload = {
        id: crypto.randomUUID(),
        user_id: userId,
        subject_id: subject.id,
        question: String(values.get("question")).trim(),
        unit_label: String(values.get("unit_label") || "").trim(),
        exam_year: values.get("exam_year") ? Number(values.get("exam_year")) : null,
        marks: values.get("marks") ? Number(values.get("marks")) : null,
        difficulty: String(values.get("difficulty")) as Pyq["difficulty"],
        notes: String(values.get("notes") || "").trim(),
      };
      if (!navigator.onLine) {
        queueMutation({ userId, table: "pyq_records", operation: "insert", row: payload });
        setPyqs((current) => [{ ...payload, solved: false, accuracy: null }, ...current] as Pyq[]); setShowForm(false); form.reset(); setNotice("Question saved offline and queued for sync."); return;
      }
      const { data, error: insertError } = await client.from("pyq_records").insert(payload).select("id,subject_id,question,unit_label,exam_year,marks,difficulty,solved,accuracy,notes").single();
      if (insertError) setError("PYQ record could not be saved.");
      else {
        setPyqs((current) => [data as Pyq, ...current]);
        setShowForm(false);
        form.reset();
        setNotice("Question saved.");
      }
    } else {
      const totalMarks = subject.total_marks;
      const payload = {
        id: crypto.randomUUID(),
        user_id: userId,
        subject_id: subject.id,
        test_date: String(values.get("test_date")),
        total_marks: totalMarks,
        marks_obtained: Number(values.get("marks_obtained")),
        duration_minutes: values.get("duration_minutes") ? Number(values.get("duration_minutes")) : null,
        weak_topics: String(values.get("weak_topics") || "").split(",").map((item) => item.trim()).filter(Boolean),
        mistakes: String(values.get("mistakes") || "").trim(),
        improvement_strategy: String(values.get("improvement_strategy") || "").trim(),
      };
      if (!navigator.onLine) {
        queueMutation({ userId, table: "mock_tests", operation: "insert", row: payload });
        setMocks((current) => [{ ...payload }, ...current] as Mock[]); setShowForm(false); form.reset(); setNotice("Mock result saved offline and queued for sync."); return;
      }
      const { data, error: insertError } = await client.from("mock_tests").insert(payload).select("id,subject_id,test_date,total_marks,marks_obtained,duration_minutes,weak_topics,mistakes,improvement_strategy").single();
      if (insertError) setError("Mock test could not be saved. Check that the marks are within the subject's total.");
      else {
        setMocks((current) => [data as Mock, ...current]);
        setShowForm(false);
        form.reset();
        setNotice("Mock result saved.");
      }
    }
  }

  async function toggleSolved(record: Pyq) {
    const solved = !record.solved;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "pyq_records", operation: "update", filterColumn: "id", filterValue: record.id, row: { solved } });
      setPyqs((current) => current.map((item) => item.id === record.id ? { ...item, solved } : item)); return;
    }
    const { error: updateError } = await client.from("pyq_records").update({ solved }).eq("id", record.id).eq("user_id", userId);
    if (updateError) setError("PYQ status could not be updated.");
    else setPyqs((current) => current.map((item) => item.id === record.id ? { ...item, solved } : item));
  }

  async function deleteRecord(id: string) {
    const table = isPyq ? "pyq_records" : "mock_tests";
    if (!navigator.onLine) {
      queueMutation({ userId, table, operation: "delete", filterColumn: "id", filterValue: id });
      if (isPyq) setPyqs((current) => current.filter((item) => item.id !== id)); else setMocks((current) => current.filter((item) => item.id !== id));
      setNotice("Removal queued for sync."); return;
    }
    const { error: deleteError } = await client.from(table).delete().eq("id", id).eq("user_id", userId);
    if (deleteError) setError("Record could not be deleted.");
    else {
      if (isPyq) setPyqs((current) => current.filter((item) => item.id !== id));
      else setMocks((current) => current.filter((item) => item.id !== id));
    }
  }

  const visiblePyqs = pyqs.filter((item) => item.subject_id === selectedSubjectId);
  const visibleMocks = mocks.filter((item) => item.subject_id === selectedSubjectId);
  const selectedSubject = subjects.find((item) => item.id === selectedSubjectId);

  return <section className="module-content">
    <header className="module-header"><div><p className="eyebrow">PRACTICE RECORDS</p><h1>{isPyq ? "Previous questions" : "Mock tests"}</h1><p className="module-subtitle">Record your real practice and scores. No marks or questions are fabricated.</p></div><button className="primary-button" onClick={() => setShowForm((open) => !open)} disabled={!subjects.length}><Plus size={16} /> {isPyq ? "Add question" : "Add mock result"}</button></header>
    <div className="practice-subject-select"><label>Subject<select value={selectedSubjectId} onChange={(event) => setSelectedSubjectId(event.target.value)}><option value="">Choose a subject</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>{selectedSubject && <span>{isPyq ? `${visiblePyqs.length} questions` : `${visibleMocks.length} tests`} · {selectedSubject.total_marks} marks</span>}</div>
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}{error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    {showForm && <form className="module-form" onSubmit={(event) => void addRecord(event)}><h2>{isPyq ? "Record a question" : "Record a mock test"}</h2>{isPyq ? <div className="module-form-grid"><label>Question<input name="question" required /></label><label>Unit<input name="unit_label" placeholder="Optional" /></label><label>Year<input name="exam_year" type="number" min="1990" max="2100" /></label><label>Marks<input name="marks" type="number" min="1" /></label><label>Difficulty<select name="difficulty"><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label><label>Notes<input name="notes" /></label></div> : <div className="module-form-grid"><label>Test date<input name="test_date" type="date" defaultValue={indiaDate()} required /></label><label>Marks obtained<input name="marks_obtained" type="number" min="0" max={selectedSubject?.total_marks ?? 60} required /></label><label>Duration (min)<input name="duration_minutes" type="number" min="1" /></label><label>Weak topics, comma separated<input name="weak_topics" /></label><label>Mistakes<input name="mistakes" /></label><label>Improvement strategy<input name="improvement_strategy" /></label></div>}<div className="module-form-actions"><button className="primary-button" type="submit"><Check size={15} /> Save record</button><button className="secondary-button" type="button" onClick={() => setShowForm(false)}>Cancel</button></div></form>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={20} /> Loading practice records</div> : !subjects.length ? <div className="module-empty"><Plus size={22} /><strong>Add a subject first</strong><span>Practice records are linked to a subject in your library.</span></div> : isPyq ? <div className="practice-list">{visiblePyqs.map((record) => <article className="practice-row" key={record.id}><button className={record.solved ? "task-check done-check" : "task-check"} onClick={() => void toggleSolved(record)} aria-label={record.solved ? "Mark unsolved" : "Mark solved"}>{record.solved && <Check size={14} />}</button><div className="practice-main"><strong>{record.question}</strong><span>{[record.unit_label, record.exam_year, record.marks ? `${record.marks} marks` : null, record.difficulty].filter(Boolean).join(" · ")}</span>{record.notes && <small>{record.notes}</small>}</div><span className={record.solved ? "task-status done-status" : "task-status"}>{record.solved ? "Solved" : "Pending"}</span><button className="icon-button danger-icon" onClick={() => void deleteRecord(record.id)} aria-label="Delete question"><Trash2 size={15} /></button></article>)}{!visiblePyqs.length && <div className="module-empty"><BookOpen size={22} /><strong>No questions recorded yet</strong><span>Add actual past-paper questions to start tracking practice.</span></div>}</div> : <div className="mock-grid">{visibleMocks.map((mock) => <article className="mock-card" key={mock.id}><div className="mock-card-head"><span>{new Date(`${mock.test_date}T12:00:00+05:30`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}</span><button className="icon-button danger-icon" onClick={() => void deleteRecord(mock.id)} aria-label="Delete mock test"><Trash2 size={15} /></button></div><div className="mock-score"><strong>{mock.marks_obtained}</strong><span>/ {mock.total_marks}</span><b>{Math.round(mock.marks_obtained / mock.total_marks * 100)}%</b></div><div className="mock-score-track"><span style={{ width: `${Math.min(100, mock.marks_obtained / mock.total_marks * 100)}%` }} /></div><div className="mock-detail-line">{mock.duration_minutes ? `${mock.duration_minutes} min` : "Duration not recorded"}{mock.weak_topics.length ? ` · Weak: ${mock.weak_topics.join(", ")}` : ""}</div>{mock.mistakes && <p>{mock.mistakes}</p>}{mock.improvement_strategy && <small>{mock.improvement_strategy}</small>}</article>)}{!visibleMocks.length && <div className="module-empty"><Check size={22} /><strong>No mock tests recorded</strong><span>Enter your actual scores to build a performance history.</span></div>}</div>}
  </section>;
}

type SessionRecord = { id: string; session_type: string; started_at: string; duration_minutes: number };
type TopicSummary = { subject_id: string; status: string };

function AnalyticsPage({ client, userId }: { client: SupabaseClient; userId: string }) {
  const [sessions, setSessions] = useState<SessionRecord[]>([]);
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [subjects, setSubjects] = useState<PracticeSubject[]>([]);
  const [mocks, setMocks] = useState<Mock[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    async function load() {
      const [sessionResult, topicResult, subjectResult, mockResult] = await Promise.all([
        client.from("study_sessions").select("id,session_type,started_at,duration_minutes").eq("user_id", userId).order("started_at"),
        client.from("topics").select("subject_id,status").eq("user_id", userId),
        client.from("subjects").select("id,name,total_marks").eq("user_id", userId).order("name"),
        client.from("mock_tests").select("id,subject_id,test_date,total_marks,marks_obtained,duration_minutes,weak_topics,mistakes,improvement_strategy").eq("user_id", userId).order("test_date", { ascending: false }),
      ]);
      if (!active) return;
      if (sessionResult.error || topicResult.error || subjectResult.error || mockResult.error) setError("Some analytics could not be loaded.");
      else {
        setSessions((sessionResult.data ?? []) as SessionRecord[]);
        setTopics((topicResult.data ?? []) as TopicSummary[]);
        setSubjects((subjectResult.data ?? []) as PracticeSubject[]);
        setMocks((mockResult.data ?? []) as Mock[]);
      }
      setLoading(false);
    }
    void load();
    return () => { active = false; };
  }, [client, userId]);

  useEffect(() => {
    const refresh = () => {
      Promise.all([
        client.from("study_sessions").select("id,session_type,started_at,duration_minutes").eq("user_id", userId).order("started_at"),
        client.from("topics").select("subject_id,status").eq("user_id", userId),
        client.from("mock_tests").select("id,subject_id,test_date,total_marks,marks_obtained,duration_minutes,weak_topics,mistakes,improvement_strategy").eq("user_id", userId).order("test_date", { ascending: false }),
      ]).then(([sessionResult, topicResult, mockResult]) => {
        if (sessionResult.data) setSessions(sessionResult.data as SessionRecord[]);
        if (topicResult.data) setTopics(topicResult.data as TopicSummary[]);
        if (mockResult.data) setMocks(mockResult.data as Mock[]);
      });
    };
    const channel = client.channel(`analytics-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "study_sessions", filter: `user_id=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "topics", filter: `user_id=eq.${userId}` }, refresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "mock_tests", filter: `user_id=eq.${userId}` }, refresh)
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, userId]);

  const studySessions = sessions.filter((session) => session.session_type === "study");
  const totalMinutes = studySessions.reduce((total, session) => total + session.duration_minutes, 0);
  const completedTopics = topics.filter((topic) => topic.status === "completed").length;
  const todayKey = indiaDate();
  const weekly = Array.from({ length: 7 }, (_value, index) => {
    const date = new Date(`${todayKey}T12:00:00+05:30`);
    date.setDate(date.getDate() - (6 - index));
    const key = indiaDate(date);
    const minutes = studySessions.filter((session) => indiaDate(new Date(session.started_at)) === key).reduce((total, session) => total + session.duration_minutes, 0);
    return { key, label: new Intl.DateTimeFormat("en-IN", { weekday: "short", timeZone: "Asia/Kolkata" }).format(date), minutes };
  });
  const maximumMinutes = Math.max(60, ...weekly.map((day) => day.minutes));
  const streak = (() => {
    let count = 0;
    for (let offset = 0; offset < 365; offset += 1) {
      const date = new Date(`${todayKey}T12:00:00+05:30`);
      date.setDate(date.getDate() - offset);
      if (!studySessions.some((session) => indiaDate(new Date(session.started_at)) === indiaDate(date))) break;
      count += 1;
    }
    return count;
  })();
  const averageMockPercent = mocks.length ? Math.round(mocks.reduce((total, mock) => total + mock.marks_obtained / mock.total_marks * 100, 0) / mocks.length) : null;

  return <section className="module-content">
    <header className="module-header"><div><p className="eyebrow">MEASURE REAL WORK</p><h1>Progress analytics</h1><p className="module-subtitle">All figures are derived from your saved sessions, topics, and mock scores.</p></div></header>
    {error && <div className="error-banner" role="alert">{error}</div>}
    {loading ? <div className="module-loading"><LoaderCircle className="spin" size={20} /> Loading analytics</div> : <>
      <div className="analytics-metrics"><Metric label="Focused study" value={`${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`} note={`${studySessions.length} completed sessions`} /><Metric label="Topics complete" value={`${completedTopics}/${topics.length}`} note={topics.length ? `${Math.round(completedTopics / topics.length * 100)}% of entered syllabus` : "No topics entered"} /><Metric label="Study streak" value={`${streak} days`} note="Based on recorded study sessions" /><Metric label="Average mock" value={averageMockPercent === null ? "—" : `${averageMockPercent}%`} note={`${mocks.length} recorded tests`} /></div>
      <section className="analytics-panel"><div className="analytics-panel-head"><div><p className="eyebrow">LAST 7 DAYS</p><h2>Focused study time</h2></div><span>hours per day</span></div><div className="weekly-bars">{weekly.map((day) => <div className="weekly-bar-column" key={day.key}><span className="weekly-bar-value">{day.minutes ? `${(day.minutes / 60).toFixed(1)}h` : ""}</span><div className="weekly-bar-track"><span style={{ height: `${day.minutes ? Math.max(5, day.minutes / maximumMinutes * 100) : 0}%` }} /></div><small>{day.label}</small></div>)}</div></section>
      <section className="analytics-panel"><div className="analytics-panel-head"><div><p className="eyebrow">SUBJECT BREAKDOWN</p><h2>Topic completion</h2></div></div><div className="subject-analytics">{subjects.map((subject) => { const subjectTopics = topics.filter((topic) => topic.subject_id === subject.id); const done = subjectTopics.filter((topic) => topic.status === "completed").length; const percent = subjectTopics.length ? Math.round(done / subjectTopics.length * 100) : 0; return <div className="subject-analytics-row" key={subject.id}><div><strong>{subject.name}</strong><span>{done}/{subjectTopics.length} topics</span></div><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><b>{percent}%</b></div>; })}{!subjects.length && <span className="muted-small">Add subjects to begin tracking preparation.</span>}</div></section>
      <section className="analytics-panel"><div className="analytics-panel-head"><div><p className="eyebrow">MOCK HISTORY</p><h2>Scores</h2></div></div>{mocks.length ? <div className="mock-history">{mocks.slice(0, 10).map((mock) => <div className="mock-history-row" key={mock.id}><span>{subjects.find((subject) => subject.id === mock.subject_id)?.name ?? "Subject"}</span><span>{mock.test_date}</span><b>{mock.marks_obtained}/{mock.total_marks}</b></div>)}</div> : <span className="muted-small">No mock scores recorded yet.</span>}</section>
    </>}
  </section>;
}

function Metric({ label, value, note }: { label: string; value: string; note: string }) {
  return <article className="analytics-metric"><span>{label}</span><strong>{value}</strong><small>{note}</small></article>;
}

type Preferences = {
  task_done: boolean;
  pending: boolean;
  exam: boolean;
  daily_summary: boolean;
  motivation: boolean;
  water: boolean;
  session_done: boolean;
  summary_time: string;
  motivation_time: string;
  lead_minutes: number;
  followup_minutes: number;
  exam_days: number[];
  daily_target_minutes: number;
  water_interval_minutes: number;
  motivation_interval_minutes: number;
  remember_session: boolean;
};

const defaultPreferences: Preferences = {
  task_done: true, pending: true, exam: true, daily_summary: true, motivation: true, water: false, session_done: true,
  summary_time: "21:00:00", motivation_time: "08:00:00", lead_minutes: 30, followup_minutes: 60, exam_days: [7, 3, 1, 0],
  daily_target_minutes: 600, water_interval_minutes: 60, motivation_interval_minutes: 30, remember_session: true,
};

function SettingsPage({ client, userId }: { client: SupabaseClient; userId: string }) {
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [pushCount, setPushCount] = useState(0);
  const [waterCount, setWaterCount] = useState(0);
  const [permission, setPermission] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [online, setOnline] = useState(navigator.onLine);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  useEffect(() => {
    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, []);

  useEffect(() => {
    let active = true;
    const refresh = () => Promise.all([
      client.from("notification_prefs").select("task_done,pending,exam,daily_summary,motivation,water,session_done,summary_time,motivation_time,lead_minutes,followup_minutes,exam_days,daily_target_minutes,water_interval_minutes,motivation_interval_minutes,remember_session").eq("user_id", userId).maybeSingle(),
      client.from("push_subscriptions").select("id").eq("user_id", userId),
      client.from("water_log").select("id").eq("user_id", userId).gte("drank_at", `${indiaDate()}T00:00:00+05:30`),
    ]).then(([prefsResult, pushResult, waterResult]) => {
      if (!active) return;
      if (prefsResult.data) setPreferences({ ...defaultPreferences, ...prefsResult.data, summary_time: prefsResult.data.summary_time ?? "21:00:00", motivation_time: prefsResult.data.motivation_time ?? "08:00:00" } as Preferences);
      if (!prefsResult.error && pushResult.data) setPushCount(pushResult.data.length);
      if (!waterResult.error) setWaterCount(waterResult.data?.length ?? 0);
      if (prefsResult.error || pushResult.error || waterResult.error) setError("Settings could not be loaded.");
      setLoading(false);
    });
    void refresh();
    const channel = client.channel(`settings-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "notification_prefs", filter: `user_id=eq.${userId}` }, () => { void refresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "push_subscriptions", filter: `user_id=eq.${userId}` }, () => { void refresh(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "water_log", filter: `user_id=eq.${userId}` }, () => { void refresh(); })
      .subscribe();
    return () => { active = false; void client.removeChannel(channel); };
  }, [client, userId]);

  function updatePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function savePreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    if (!navigator.onLine) {
      queueMutation({ userId, table: "notification_prefs", operation: "update", filterColumn: "user_id", filterValue: userId, row: preferences as unknown as Record<string, unknown> });
      setNotice("Preferences saved offline and queued for sync."); setSaving(false); return;
    }
    const payload = { ...preferences, user_id: userId };
    const { error: saveError } = await client.from("notification_prefs").upsert(payload, { onConflict: "user_id" });
    if (saveError) setError("Preferences could not be saved.");
    else setNotice("Notification and study preferences synced.");
    setSaving(false);
  }

  async function updatePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (newPassword.length < 12) { setError("Use at least 12 characters for a new password."); return; }
    if (newPassword !== confirmPassword) { setError("The password confirmation does not match."); return; }
    const { error: passwordError } = await client.auth.updateUser({ password: newPassword });
    if (passwordError) setError("Password change failed. Please try again.");
    else { setNewPassword(""); setConfirmPassword(""); setNotice("Password changed successfully."); }
  }

  async function enablePush() {
    setError("");
    try { await subscribeToPush(client, userId); setPermission(Notification.permission); setPushCount((count) => count + 1); setNotice("This device is subscribed to push notifications."); }
    catch (pushError) { setError(pushError instanceof Error ? pushError.message : "Could not enable push."); }
  }

  async function disablePush() {
    setError("");
    try { await unsubscribeFromPush(client); setPushCount(0); setNotice("This device subscription was removed."); }
    catch (pushError) { setError(pushError instanceof Error ? pushError.message : "Could not remove push subscription."); }
  }

  async function testNotification() {
    const { error: invokeError } = await client.functions.invoke("notify", { body: { type: "test" } });
    if (invokeError) setError("The notification function is not deployed or configured yet.");
    else setNotice("Test notification requested.");
  }

  async function logWater() {
    if (!navigator.onLine) {
      queueMutation({ userId, table: "water_log", operation: "insert", row: { id: crypto.randomUUID(), user_id: userId, drank_at: new Date().toISOString() } });
      setWaterCount((count) => count + 1); setNotice("Hydration logged offline and queued for sync."); return;
    }
    const { error: logError } = await client.from("water_log").insert({ user_id: userId, drank_at: new Date().toISOString() });
    if (logError) setError("Water reminder could not be logged.");
    else { setWaterCount((count) => count + 1); setNotice("Hydration logged."); }
  }

  async function exportBackup() {
    const tables = ["subjects", "units", "topics", "tasks", "exams", "study_sessions", "revision_records", "pyq_records", "mock_tests", "water_log", "notification_prefs", "app_state"];
    const results = await Promise.all(tables.map((table) => client.from(table).select("*").eq("user_id", userId)));
    const failed = results.find((result) => result.error);
    if (failed?.error) { setError("Backup could not be created."); return; }
    const backup = Object.fromEntries(tables.map((table, index) => [table, results[index].data ?? []]));
    const url = URL.createObjectURL(new Blob([JSON.stringify({ version: 1, exported_at: new Date().toISOString(), data: backup }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "exam-command-center-backup.json"; link.click(); URL.revokeObjectURL(url);
    setNotice("Cloud backup downloaded.");
  }

  async function importBackup(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as { data?: Record<string, unknown[]> };
      if (!parsed.data || !window.confirm("Merge backup rows into this account? Existing records with matching IDs will be updated.")) return;
      const tableNames = ["subjects", "units", "topics", "tasks", "exams", "study_sessions", "revision_records", "pyq_records", "mock_tests", "water_log", "notification_prefs", "app_state"];
      for (const table of tableNames) {
        const rows = parsed.data[table];
        if (!Array.isArray(rows) || !rows.length) continue;
        const payload = rows.map((row) => ({ ...(row as Record<string, unknown>), user_id: userId }));
        const conflict = table === "notification_prefs" || table === "app_state" ? "user_id" : "id";
        const { error: importError } = await client.from(table).upsert(payload, { onConflict: conflict });
        if (importError) throw importError;
      }
      setNotice("Backup rows merged. Refresh the screen to reload all views.");
    } catch { setError("Backup file is invalid or could not be merged."); }
    event.currentTarget.value = "";
  }

  async function toggleExamDay(day: number) {
    const next = preferences.exam_days.includes(day) ? preferences.exam_days.filter((item) => item !== day) : [...preferences.exam_days, day].sort((a, b) => b - a);
    updatePreference("exam_days", next);
  }

  if (loading) return <div className="module-loading"><LoaderCircle className="spin" size={20} /> Loading settings</div>;
  return <section className="module-content">
    <header className="module-header"><div><p className="eyebrow">ACCOUNT &amp; NOTIFICATIONS</p><h1>Settings</h1><p className="module-subtitle">Preferences sync to your Supabase account.</p></div><span className={online ? "connection-status online" : "connection-status offline"}>{online ? <Wifi size={15} /> : <WifiOff size={15} />}{online ? "Online" : "Offline"}</span></header>
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}{error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}
    <section className="settings-panel"><div className="settings-panel-heading"><ShieldCheck size={18} /><div><h2>Account security</h2><p>Change your password without storing it in this app.</p></div></div><form className="settings-inline-form" onSubmit={(event) => void updatePassword(event)}><label>New password<input type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required /></label><label>Confirm password<input type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required /></label><button className="primary-button" type="submit"><Save size={15} /> Change password</button></form></section>
    <form className="settings-panel" onSubmit={(event) => void savePreferences(event)}><div className="settings-panel-heading"><Bell size={18} /><div><h2>Study &amp; notification preferences</h2><p>Scheduled push delivery needs the Supabase notification function and VAPID secrets.</p></div></div>
      <div className="settings-grid"><label>Daily study target (minutes)<input type="number" min="30" max="1440" value={preferences.daily_target_minutes} onChange={(event) => updatePreference("daily_target_minutes", Number(event.target.value))} /></label><label>Daily summary time<input type="time" value={preferences.summary_time.slice(0, 5)} onChange={(event) => updatePreference("summary_time", event.target.value)} /></label><label>Motivation interval (minutes)<input type="number" min="10" max="240" value={preferences.motivation_interval_minutes} onChange={(event) => updatePreference("motivation_interval_minutes", Number(event.target.value))} /></label><label>Water reminder interval (minutes)<input type="number" min="15" max="240" value={preferences.water_interval_minutes} onChange={(event) => updatePreference("water_interval_minutes", Number(event.target.value))} /></label><label>Deadline lead time (minutes)<input type="number" min="1" max="240" value={preferences.lead_minutes} onChange={(event) => updatePreference("lead_minutes", Number(event.target.value))} /></label><label>Pending follow-up interval (minutes)<input type="number" min="10" max="600" value={preferences.followup_minutes} onChange={(event) => updatePreference("followup_minutes", Number(event.target.value))} /></label></div>
      <div className="toggle-list">{([["task_done", "Task completion"], ["pending", "Pending task reminders"], ["exam", "Exam countdowns"], ["daily_summary", "Daily summary"], ["motivation", "Motivational reminders"], ["water", "Water reminders"], ["session_done", "Study session completion"]] as const).map(([key, label]) => <label className="setting-toggle" key={key}><span>{label}</span><input type="checkbox" checked={preferences[key]} onChange={(event) => updatePreference(key, event.target.checked)} /></label>)}</div>
      <div className="exam-alert-days"><strong>Exam alert days</strong>{[7, 3, 1, 0].map((day) => <label key={day}><input type="checkbox" checked={preferences.exam_days.includes(day)} onChange={() => void toggleExamDay(day)} />{day === 0 ? "Exam morning" : `${day} days before`}</label>)}</div>
      <div className="module-form-actions"><button className="primary-button" type="submit" disabled={saving}><Save size={15} /> {saving ? "Saving" : "Save preferences"}</button></div>
    </form>
    <section className="settings-panel"><div className="settings-panel-heading"><Activity size={18} /><div><h2>Push notifications</h2><p>Permission: {permission} · {pushCount} saved device {pushCount === 1 ? "subscription" : "subscriptions"}</p></div></div><div className="settings-action-row"><button className="primary-button" onClick={() => void enablePush()}><Bell size={15} /> Enable on this device</button><button className="secondary-button" onClick={() => void disablePush()}>Remove this device</button><button className="secondary-button" onClick={() => void testNotification()}>Send test</button></div><p className="settings-note">On iPhone or iPad, add this site to the Home Screen first, then enable notifications here.</p></section>
    <section className="settings-panel"><div className="settings-panel-heading"><Activity size={18} /><div><h2>Hydration log</h2><p>{waterCount} reminders logged today. No fixed intake target is imposed.</p></div></div><button className="secondary-button" onClick={() => void logWater()}><Check size={15} /> Drank water</button></section>
    <section className="settings-panel"><div className="settings-panel-heading"><Download size={18} /><div><h2>Backup &amp; restore</h2><p>Cloud storage is primary; JSON backup is an additional export.</p></div></div><div className="settings-action-row"><button className="secondary-button" onClick={() => void exportBackup()}><Download size={15} /> Export JSON backup</button><label className="secondary-button import-backup"><Upload size={15} /> Merge JSON backup<input type="file" accept="application/json,.json" onChange={(event) => void importBackup(event)} /></label></div></section>
  </section>;
}

function indiaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

const motivationMessages = [
  "Three backlogs to clear. Make this attempt count.",
  "Your mission is not finished until all eight examinations are complete.",
  "Every completed topic brings you closer to your goal.",
  "Stop worrying about the result. Focus on today's work.",
  "You are capable of more than you think.",
  "Sixty marks are waiting. Prepare intelligently.",
  "Your future self will thank you for the work you do today.",
  "Don't quit when the work gets difficult. Take a short break, then continue.",
  "Three backlogs. Eight exams. One mission.",
  "Today is a chance to build your comeback.",
];

function MotivationPage() {
  const [message, setMessage] = useState(motivationMessages[0]);
  const [permission, setPermission] = useState(typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  function showMessage() {
    const next = motivationMessages[Math.floor(Math.random() * motivationMessages.length)];
    setMessage(next);
    if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("Exam Command Center", { body: next, icon: "/icon-192.png" });
  }
  async function requestNotifications() {
    if (typeof Notification === "undefined") { setPermission("unsupported"); return; }
    setPermission(await Notification.requestPermission());
  }
  return <section className="module-content"><header className="module-header"><div><p className="eyebrow">MOTIVATION CENTER</p><h1>Keep the mission in view.</h1><p className="module-subtitle">Reminders only run in the background after the scheduled Supabase function is configured.</p></div></header><section className="motivation-panel"><span className="motivation-icon"><Activity size={22} /></span><p className="eyebrow">A NOTE FOR TODAY</p><blockquote>{message}</blockquote><div className="settings-action-row"><button className="primary-button" onClick={showMessage}>New message</button><button className="secondary-button" onClick={() => void requestNotifications()}><Bell size={15} /> Allow browser notifications</button><span className="permission-caption">Permission: {permission}</span></div></section><div className="mission-statement"><p>MISSION</p><strong>CLEAR ALL BACKLOGS.</strong><strong>PASS ALL EIGHT EXAMINATIONS.</strong><strong>MAKE YOURSELF PROUD.</strong></div></section>;
}