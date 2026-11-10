import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  ClipboardList,
  CircleHelp,
  Clock3,
  Command,
  Eye,
  EyeOff,
  FileText,
  Flame,
  KeyRound,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Settings,
  Sparkles,
  Target,
  TimerReset,
  Trash2,
} from "lucide-react";
import { flushOfflineMutations, pendingMutationCount, queueMutation } from "./offline";

const StudyLibrary = lazy(() => import("./StudyLibrary").then((module) => ({ default: module.StudyLibrary })));
const StudyModules = lazy(() => import("./StudyModules").then((module) => ({ default: module.StudyModules })));

type Task = {
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
  short: string;
  name: string;
  starts_at: string;
  time_label: string;
  marks: number;
};

type Page = "today" | "focus" | "planner" | "subjects" | "exams" | "revision" | "pyq" | "mocks" | "analytics" | "settings" | "motivation";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
let rememberSession = true;
const authStorage = {
  async getItem(key: string) {
    const shouldRemember = localStorage.getItem("ecc_remember") !== "false";
    const preferred = shouldRemember ? localStorage : sessionStorage;
    const fallback = shouldRemember ? sessionStorage : localStorage;
    return preferred.getItem(key) ?? fallback.getItem(key);
  },
  async setItem(key: string, value: string) {
    const preferred = rememberSession ? localStorage : sessionStorage;
    const fallback = rememberSession ? sessionStorage : localStorage;
    preferred.setItem(key, value);
    fallback.removeItem(key);
  },
  async removeItem(key: string) {
    localStorage.removeItem(key);
    sessionStorage.removeItem(key);
  },
};
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey, { auth: { storage: authStorage, persistSession: true, autoRefreshToken: true } }) : null;

function indiaDate(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", hour: "2-digit", hourCycle: "h23" }).format(new Date()),
  );
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function prettyDate(date: Date, options: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" }) {
  return new Intl.DateTimeFormat("en-IN", { ...options, timeZone: "Asia/Kolkata" }).format(date);
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [checkingSession, setCheckingSession] = useState(Boolean(supabase));

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setCheckingSession(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setCheckingSession(false);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  if (!supabase) return <ConfigurationScreen />;
  if (checkingSession) return <LoadingScreen />;
  if (!session) return <LoginScreen client={supabase} />;
  const displayName = session.user.user_metadata?.name || (session.user.email?.toLowerCase() === "golee@examcc.app" ? "Golee" : "Student");
  return <AuthenticatedWorkspace client={supabase} userId={session.user.id} displayName={displayName} onSignOut={() => supabase.auth.signOut()} />;
}

function AuthenticatedWorkspace({ client, userId, displayName, onSignOut }: { client: SupabaseClient; userId: string; displayName: string; onSignOut: () => void }) {
  const [mustChangePassword, setMustChangePassword] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    client.from("profiles").select("must_change_password").eq("id", userId).single().then(({ data, error: profileError }) => {
      if (!active) return;
      if (profileError) setError("Your account profile could not be loaded. Sign out and confirm the Supabase migration has been applied.");
      else setMustChangePassword(Boolean(data.must_change_password));
    });
    return () => { active = false; };
  }, [client, userId]);

  async function finishPasswordChange() {
    const { error: updateError } = await client.from("profiles").update({ must_change_password: false }).eq("id", userId);
    if (updateError) { setError("Password changed, but the first-login flag could not be cleared. Retry from Settings."); return false; }
    setMustChangePassword(false);
    return true;
  }

  if (error) return <main className="loading-screen"><div className="error-banner" role="alert">{error}</div><button className="secondary-button" onClick={onSignOut}>Sign out</button></main>;
  if (mustChangePassword === null) return <LoadingScreen />;
  if (mustChangePassword) return <PasswordChangeScreen client={client} onChanged={finishPasswordChange} onSignOut={onSignOut} initial />;
  return <CommandCenter client={client} userId={userId} displayName={displayName} onSignOut={onSignOut} />;
}

function ConfigurationScreen() {
  return (
    <main className="setup-screen">
      <div className="setup-mark"><Command size={24} /></div>
      <p className="eyebrow">EXAM COMMAND CENTER</p>
      <h1>One clear plan.<br />One step at a time.</h1>
      <p className="setup-copy">Connect this app to your Supabase project to sign in and sync your study plan.</p>
      <section className="setup-checklist" aria-label="Configuration required">
        <h2>Required environment variables</h2>
        <code>VITE_SUPABASE_URL</code>
        <code>VITE_SUPABASE_ANON_KEY</code>
        <p>Add both in Vercel under <strong>Project Settings → Environment Variables</strong>, then redeploy.</p>
      </section>
      <a className="setup-link" href="https://supabase.com/dashboard" target="_blank" rel="noreferrer">
        Open Supabase dashboard <ArrowUpRight size={16} />
      </a>
    </main>
  );
}

function LoadingScreen() {
  return <main className="loading-screen"><LoaderCircle className="spin" size={28} /><span>Opening your study space</span></main>;
}

function LoginScreen({ client }: { client: SupabaseClient }) {
  const [login, setLogin] = useState("Golee");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    rememberSession = remember;
    localStorage.setItem("ecc_remember", String(remember));
    const identity = login.trim();
    const email = identity.toLowerCase() === "golee" ? "golee@examcc.app" : identity;
    const { error: authError } = await client.auth.signInWithPassword({ email, password });
    if (authError) setError("That sign-in didn't work. Check your username and password and try again.");
    setBusy(false);
  }

  return (
    <main className="login-screen">
      <section className="login-story">
        <div className="brand-lockup"><span className="brand-icon"><Command size={19} /></span><span>EXAM COMMAND CENTER</span></div>
        <div className="story-copy">
          <p className="eyebrow">YOUR PREPARATION, IN FOCUS</p>
          <h1>Make today<br />count.</h1>
          <p>Turn the long syllabus into a plan you can finish, one focused session at a time.</p>
        </div>
        <div className="story-footer"><span className="story-dot" /> A calmer way to prepare</div>
      </section>
      <section className="login-panel">
        <div className="login-card">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Sign in to continue</h2>
          <p className="muted">Your tasks and exam plan are waiting.</p>
          <form onSubmit={handleSubmit} className="login-form">
            <label htmlFor="login">Username or email</label>
            <input id="login" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder="Golee or name@example.com" required />
            <label htmlFor="password">Password</label>
            <div className="password-field"><input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required /><button className="password-toggle" type="button" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            <label className="remember-row"><input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} /> Remember this device</label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="primary-button login-submit" type="submit" disabled={busy}>
              {busy ? <LoaderCircle className="spin" size={17} /> : null}
              {busy ? "Signing in" : "Sign in"}
              {!busy && <ChevronRight size={17} />}
            </button>
          </form>
          <p className="login-footnote"><CircleHelp size={15} /> Sign-in access is managed by your administrator.</p>
        </div>
        <span className="login-version">STUDY WITH INTENTION · 2026</span>
      </section>
    </main>
  );
}

function PasswordChangeScreen({ client, onChanged, onSignOut, initial = false }: { client: SupabaseClient; onChanged: () => Promise<boolean>; onSignOut: () => void; initial?: boolean }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(""); setNotice("");
    if (password.length < 12) { setError("Use at least 12 characters for a stronger password."); return; }
    if (password !== confirmation) { setError("The password confirmation does not match."); return; }
    setBusy(true);
    const { error: updateError } = await client.auth.updateUser({ password });
    if (updateError) setError("Password could not be changed. Try again.");
    else if (await onChanged()) setNotice("Password updated. Your study space is unlocked.");
    setBusy(false);
  }

  return <main className="password-screen"><section className="password-card"><span className="password-mark"><KeyRound size={20} /></span><p className="eyebrow">ACCOUNT SECURITY</p><h1>{initial ? "Set a new password" : "Change your password"}</h1><p className="muted">{initial ? "For your security, change the initial password before opening your dashboard." : "Choose a unique password with at least 12 characters."}</p><form className="password-change-form" onSubmit={(event) => void submit(event)}><label>New password<div className="password-field"><input type={visible ? "text" : "password"} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} minLength={12} required /><button className="password-toggle" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Hide password" : "Show password"}>{visible ? <EyeOff size={17} /> : <Eye size={17} />}</button></div></label><label>Confirm new password<input type={visible ? "text" : "password"} autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} minLength={12} required /></label>{error && <p className="form-error" role="alert">{error}</p>}{notice && <p className="notice" role="status">{notice}</p>}<button className="primary-button login-submit" type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin" size={17} /> : <KeyRound size={16} />}{busy ? "Updating" : "Update password"}</button></form><button className="secondary-button" onClick={onSignOut}>Sign out</button></section></main>;
}

function CommandCenter({ client, userId, displayName, onSignOut }: { client: SupabaseClient; userId: string; displayName: string; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>("today");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSync, setPendingSync] = useState(pendingMutationCount());

  useEffect(() => {
    let active = true;
    async function loadDashboard() {
      setLoading(true);
      const [taskResult, examResult] = await Promise.all([
        client.from("tasks").select("id,title,subject,task_date,start_time,end_time,done").eq("user_id", userId).eq("task_date", indiaDate()).order("start_time"),
        client.from("exams").select("id,short,name,starts_at,time_label,marks").eq("user_id", userId).order("starts_at"),
      ]);
      if (!active) return;
      if (taskResult.error) setError("Your plan couldn't load. Check the Supabase setup, then refresh.");
      else setTasks((taskResult.data ?? []) as Task[]);
      if (!examResult.error) setExams((examResult.data ?? []) as Exam[]);
      setLoading(false);
    }
    void loadDashboard();
    return () => { active = false; };
  }, [client, userId]);

  useEffect(() => {
    const sync = async () => {
      const online = navigator.onLine;
      setIsOnline(online);
      if (!online) return;
      const result = await flushOfflineMutations(client, userId);
      setPendingSync(result.pending);
      if (result.synced) setNotice(`${result.synced} offline change${result.synced === 1 ? "" : "s"} synced.`);
    };
    const handleOnline = () => { void sync(); };
    const handleOffline = () => setIsOnline(false);
    const handleQueueChange = (event: Event) => setPendingSync((event as CustomEvent<{ count: number }>).detail.count);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("ecc-sync-queue-change", handleQueueChange);
    void sync();
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("ecc-sync-queue-change", handleQueueChange);
    };
  }, [client, userId]);

  useEffect(() => {
    const reload = async (table: "tasks" | "exams") => {
      if (table === "tasks") {
        const { data } = await client.from("tasks").select("id,title,subject,task_date,start_time,end_time,done").eq("user_id", userId).eq("task_date", indiaDate()).order("start_time");
        if (data) setTasks(data as Task[]);
      } else {
        const { data } = await client.from("exams").select("id,short,name,starts_at,time_label,marks").eq("user_id", userId).order("starts_at");
        if (data) setExams(data as Exam[]);
      }
    };
    const channel = client.channel(`dashboard-sync-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tasks", filter: `user_id=eq.${userId}` }, () => { void reload("tasks"); })
      .on("postgres_changes", { event: "*", schema: "public", table: "exams", filter: `user_id=eq.${userId}` }, () => { void reload("exams"); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, userId]);

  async function addTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const payload = {
      user_id: userId,
      title: String(values.get("title")).trim(),
      subject: String(values.get("subject") || "").trim() || null,
      task_date: String(values.get("task_date")),
      start_time: String(values.get("start_time")),
      end_time: String(values.get("end_time")),
    };
    if (!navigator.onLine) {
      const queuedTask: Task = { ...payload, id: crypto.randomUUID(), done: false };
      queueMutation({ userId, table: "tasks", operation: "insert", row: queuedTask });
      if (payload.task_date === indiaDate()) setTasks((current) => [...current, queuedTask].sort((a, b) => a.start_time.localeCompare(b.start_time)));
      form.reset(); setShowForm(false); setNotice("Saved offline. This task will sync when you reconnect."); return;
    }
    const { data, error: insertError } = await client.from("tasks").insert(payload).select("id,title,subject,task_date,start_time,end_time,done").single();
    if (insertError) {
      setNotice(insertError.message.includes("end_time") ? "End time must be after start time." : "Task could not be saved. Try again.");
      return;
    }
    if (payload.task_date === indiaDate()) setTasks((current) => [...current, data as Task].sort((a, b) => a.start_time.localeCompare(b.start_time)));
    form.reset();
    setShowForm(false);
    setNotice("Task added to your plan.");
  }

  async function toggleTask(task: Task) {
    const done = !task.done;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "tasks", operation: "update", filterColumn: "id", filterValue: task.id, row: { done, done_at: done ? new Date().toISOString() : null } });
      setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done } : item));
      setNotice("Changed offline. It will sync when you reconnect.");
      return;
    }
    const { error: updateError } = await client.from("tasks").update({ done, done_at: done ? new Date().toISOString() : null }).eq("id", task.id).eq("user_id", userId);
    if (updateError) {
      setNotice("Couldn't update that task. Please retry.");
      return;
    }
    setTasks((current) => current.map((item) => item.id === task.id ? { ...item, done } : item));
    if (done) {
      await client.functions.invoke("notify", { body: { type: "task_done", task_id: task.id } }).catch(() => undefined);
      setNotice("Task completed. Nice work.");
    }
  }

  async function deleteTask(taskId: string) {
    if (!navigator.onLine) {
      queueMutation({ userId, table: "tasks", operation: "delete", filterColumn: "id", filterValue: taskId });
      setTasks((current) => current.filter((task) => task.id !== taskId));
      setNotice("Removed offline. The change will sync when you reconnect.");
      return;
    }
    const { error: deleteError } = await client.from("tasks").delete().eq("id", taskId).eq("user_id", userId);
    if (deleteError) setNotice("Couldn't remove that task. Please retry.");
    else {
      setTasks((current) => current.filter((task) => task.id !== taskId));
      setNotice("Task removed.");
    }
  }

  const upcomingExam = exams.find((exam) => new Date(exam.starts_at).getTime() >= Date.now());
  const completed = tasks.filter((task) => task.done).length;
  const progress = tasks.length ? Math.round((completed / tasks.length) * 100) : 0;
  const name = displayName;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand-lockup side-brand" href="#today" aria-label="Exam Command Center home"><span className="brand-icon"><Command size={19} /></span><span>EXAM COMMAND<br />CENTER</span></a>
        <div className="side-label">WORKSPACE</div>
        <nav className="side-nav" aria-label="Main navigation">
          <button className={page === "today" ? "nav-item active" : "nav-item"} onClick={() => setPage("today")}><BookOpen size={18} /> Today <span className="nav-count">{tasks.length}</span></button>
          <button className={page === "planner" ? "nav-item active" : "nav-item"} onClick={() => setPage("planner")}><CalendarDays size={18} /> Planner</button>
          <button className={page === "subjects" ? "nav-item active" : "nav-item"} onClick={() => setPage("subjects")}><BookOpen size={18} /> Subjects &amp; topics</button>
          <button className={page === "exams" ? "nav-item active" : "nav-item"} onClick={() => setPage("exams")}><Flame size={18} /> Exam calendar</button>
          <button className={page === "revision" ? "nav-item active" : "nav-item"} onClick={() => setPage("revision")}><RotateCcw size={18} /> Revision</button>
          <button className={page === "pyq" ? "nav-item active" : "nav-item"} onClick={() => setPage("pyq")}><FileText size={18} /> PYQ tracker</button>
          <button className={page === "mocks" ? "nav-item active" : "nav-item"} onClick={() => setPage("mocks")}><ClipboardList size={18} /> Mock tests</button>
          <button className={page === "analytics" ? "nav-item active" : "nav-item"} onClick={() => setPage("analytics")}><Activity size={18} /> Analytics</button>
          <button className={page === "motivation" ? "nav-item active" : "nav-item"} onClick={() => setPage("motivation")}><Sparkles size={18} /> Motivation</button>
          <button className={page === "settings" ? "nav-item active" : "nav-item"} onClick={() => setPage("settings")}><Settings size={18} /> Settings</button>
          <button className={page === "focus" ? "nav-item active" : "nav-item"} onClick={() => setPage("focus")}><Target size={18} /> Focus room</button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><Sparkles size={16} /><p>Progress is built<br />in small sessions.</p></div>
          <button className="nav-item signout" onClick={onSignOut}><LogOut size={17} /> Sign out</button>
          <span className="sidebar-caption">EXAM CC · 2026</span>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="mobile-brand"><span className="brand-icon"><Command size={18} /></span> EXAM CC</div>
          <div className="topbar-date">{prettyDate(new Date())}</div>
          <div className="profile-chip"><span className={isOnline ? "connection-dot online" : "connection-dot offline"} title={isOnline ? "Online" : "Offline"} /><span className="sync-caption">{isOnline ? pendingSync ? `${pendingSync} syncing` : "Synced" : "Offline"}</span><span className="avatar">{name[0]}</span><span>{name}</span><button aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div>
        </header>

        <Suspense fallback={<LoadingScreen />}>
        {page === "today" ? (
          <section className="dashboard-content">
            <div className="welcome-row">
              <div><p className="eyebrow">YOUR STUDY DESK · {prettyDate(new Date(), { month: "short", day: "numeric", year: "numeric" }).toUpperCase()}</p><h1>{greeting()}, {name}<span className="greeting-period">.</span></h1><p className="welcome-subtitle">Small, steady progress adds up. Let’s make this a good study day.</p></div>
              <button className="primary-button add-task-top" onClick={() => setShowForm((open) => !open)}><Plus size={17} /> Add a task</button>
            </div>

            <div className="overview-grid">
              <section className="progress-panel">
                <div className="panel-topline"><span className="panel-icon green-icon"><CheckCircle2 size={19} /></span><span className="panel-kicker">TODAY'S PROGRESS</span><span className="progress-percent">{progress}%</span></div>
                <div className="progress-track"><span style={{ width: `${progress}%` }} /></div>
                <div className="progress-footer"><strong>{completed} of {tasks.length} tasks complete</strong><span>{tasks.length - completed} left to go</span></div>
              </section>
              <section className="exam-panel">
                <div className="panel-topline"><span className="panel-icon orange-icon"><Flame size={18} /></span><span className="panel-kicker">NEXT EXAM</span><ArrowUpRight className="panel-arrow" size={17} /></div>
                {upcomingExam ? <div className="exam-info"><strong>{upcomingExam.short}</strong><span>{upcomingExam.name}</span><p>{prettyDate(new Date(upcomingExam.starts_at), { month: "short", day: "numeric" })} <i /> {upcomingExam.time_label}</p></div> : <div className="exam-info"><strong>No upcoming exams</strong><span>Your exam schedule will appear here.</span></div>}
              </section>
            </div>

            <div className="section-heading"><div><p className="eyebrow">THE PLAN</p><h2>Today's tasks</h2></div><button className="text-button" onClick={() => setPage("focus")}>Start a focus session <ChevronRight size={16} /></button></div>

            {showForm && <form className="task-form" onSubmit={addTask}>
              <div className="form-heading"><div><span className="eyebrow">MAKE A PLAN</span><h3>Add a study task</h3></div><button type="button" className="icon-button" onClick={() => setShowForm(false)} aria-label="Close form"><span aria-hidden="true">×</span></button></div>
              <label>Task title<input name="title" placeholder="e.g. Revise Kirchhoff's laws" maxLength={200} required /></label>
              <div className="form-row"><label>Subject<input name="subject" placeholder="e.g. BEE" /></label><label>Date<input name="task_date" type="date" defaultValue={indiaDate()} required /></label></div>
              <div className="form-row"><label>Start time<input name="start_time" type="time" defaultValue="09:00" required /></label><label>End time<input name="end_time" type="time" defaultValue="10:00" required /></label></div>
              <button className="primary-button" type="submit"><Plus size={16} /> Save task</button>
            </form>}

            {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
            {error && <div className="error-banner" role="alert">{error}</div>}
            <section className="task-list" aria-label="Today's tasks">
              {loading ? <div className="empty-state"><LoaderCircle className="spin" size={23} /><span>Loading your plan</span></div> : tasks.length ? tasks.map((task) => <TaskRow key={task.id} task={task} onToggle={() => void toggleTask(task)} onDelete={() => void deleteTask(task.id)} />) : <div className="empty-state empty-plan"><span className="empty-illustration"><BookOpen size={22} /></span><strong>Your day is still open.</strong><span>Add one clear task to get started.</span><button className="text-button" onClick={() => setShowForm(true)}><Plus size={16} /> Create your first task</button></div>}
            </section>
            <div className="day-note"><span className="day-note-mark"><Check size={14} /></span><span>Leave a little room for rest. Consistency beats cramming.</span></div>
          </section>
        ) : page === "subjects" ? <StudyLibrary client={client} userId={userId} />
          : page !== "focus" ? <StudyModules page={page} client={client} userId={userId} /> : null}
        </Suspense>
        <div hidden={page !== "focus"}><FocusRoom client={client} userId={userId} onBack={() => setPage("today")} /></div>
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={page === "today" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("today")}><BookOpen size={19} /><span>Today</span></button>
        <button className={page === "planner" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("planner")}><CalendarDays size={19} /><span>Plan</span></button>
        <button className={page === "subjects" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("subjects")}><BookOpen size={19} /><span>Subjects</span></button>
        <button className={page === "exams" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("exams")}><Flame size={19} /><span>Exams</span></button>
        <button className={page === "revision" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("revision")}><RotateCcw size={19} /><span>Revision</span></button>
        <button className={page === "pyq" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("pyq")}><FileText size={19} /><span>PYQ</span></button>
        <button className={page === "mocks" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("mocks")}><ClipboardList size={19} /><span>Mocks</span></button>
        <button className={page === "analytics" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("analytics")}><Activity size={19} /><span>Stats</span></button>
        <button className={page === "motivation" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("motivation")}><Sparkles size={19} /><span>Motivation</span></button>
        <button className={page === "settings" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("settings")}><Settings size={19} /><span>Settings</span></button>
        <button className={page === "focus" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("focus")}><Target size={19} /><span>Focus</span></button>
      </nav>
    </div>
  );
}

function TaskRow({ task, onToggle, onDelete }: { task: Task; onToggle: () => void; onDelete: () => void }) {
  const start = task.start_time.slice(0, 5);
  const end = task.end_time.slice(0, 5);
  return (
    <article className={task.done ? "task-row task-done" : "task-row"}>
      <button className="task-check" onClick={onToggle} aria-label={task.done ? `Mark ${task.title} incomplete` : `Complete ${task.title}`}>
        {task.done && <Check size={15} strokeWidth={2.6} />}
      </button>
      <div className="task-time"><span>{start}</span><i /> <span>{end}</span></div>
      <div className="task-copy"><strong>{task.title}</strong><span>{task.subject || "General"}</span></div>
      <span className={task.done ? "task-status done-status" : "task-status"}>{task.done ? "Done" : "Planned"}</span>
      <button className="task-delete" onClick={onDelete} aria-label={`Delete ${task.title}`}><Trash2 size={16} /></button>
    </article>
  );
}

function FocusRoom({ client, userId, onBack }: { client: SupabaseClient; userId: string; onBack: () => void }) {
  type TimerSubject = { id: string; name: string };
  type TimerTopic = { id: string; subject_id: string; title: string; actual_minutes: number };
  const [subjects, setSubjects] = useState<TimerSubject[]>([]);
  const [topics, setTopics] = useState<TimerTopic[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [selectedTopicId, setSelectedTopicId] = useState("");
  const [sessionType, setSessionType] = useState<"study" | "break">("study");
  const [durationMinutes, setDurationMinutes] = useState(25);
  const [customMinutes, setCustomMinutes] = useState(25);
  const [sessionLength, setSessionLength] = useState(25 * 60);
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [sessionStartedAt, setSessionStartedAt] = useState<string | null>(null);
  const [sessions, setSessions] = useState(0);
  const [totalFocusedMinutes, setTotalFocusedMinutes] = useState(0);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const finishLock = useRef(false);
  const running = deadline !== null;
  const currentTopics = topics.filter((topic) => topic.subject_id === selectedSubjectId);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const circumference = 2 * Math.PI * 106;
  const dashOffset = circumference * (1 - remainingSeconds / Math.max(sessionLength, 1));

  useEffect(() => {
    let active = true;
    async function loadTimerData() {
      const [subjectResult, topicResult, sessionResult] = await Promise.all([
        client.from("subjects").select("id,name").eq("user_id", userId).order("name"),
        client.from("topics").select("id,subject_id,title,actual_minutes").eq("user_id", userId).order("title"),
        client.from("study_sessions").select("id,duration_minutes").eq("user_id", userId).eq("session_type", "study").gte("started_at", `${indiaDate()}T00:00:00+05:30`),
      ]);
      if (!active) return;
      if (!subjectResult.error) setSubjects((subjectResult.data ?? []) as TimerSubject[]);
      if (!topicResult.error) setTopics((topicResult.data ?? []) as TimerTopic[]);
      if (!sessionResult.error) {
        const history = sessionResult.data ?? [];
        setSessions(history.length);
        setTotalFocusedMinutes(history.reduce((total, item) => total + Number(item.duration_minutes), 0));
      }
    }
    void loadTimerData();
    return () => { active = false; };
  }, [client, userId]);

  useEffect(() => {
    if (deadline === null) return;
    const timer = window.setInterval(() => {
      const next = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      setRemainingSeconds(next);
      if (next !== 0 || finishLock.current) return;
      finishLock.current = true;
      setDeadline(null);
      const endedAt = new Date();
      const startedAt = sessionStartedAt ?? new Date(deadline - sessionLength * 1000).toISOString();
      const savedMinutes = Math.max(1, Math.round(sessionLength / 60));
      void (async () => {
        const sessionRow = {
          id: crypto.randomUUID(),
          user_id: userId,
          subject_id: sessionType === "study" ? selectedSubjectId || null : null,
          topic_id: sessionType === "study" ? selectedTopicId || null : null,
          session_type: sessionType,
          started_at: startedAt,
          ended_at: endedAt.toISOString(),
          duration_minutes: savedMinutes,
        };
        let sessionId = sessionRow.id;
        if (!navigator.onLine) queueMutation({ userId, table: "study_sessions", operation: "insert", row: sessionRow });
        else {
          const { data, error: saveError } = await client.from("study_sessions").insert(sessionRow).select("id").single();
          if (saveError) { setError("Session ended, but its history could not be saved. Check your connection and retry from the planner."); return; }
          sessionId = data.id;
        }
        if (sessionType === "study") {
          setSessions((count) => count + 1);
          setTotalFocusedMinutes((total) => total + savedMinutes);
          if (selectedTopicId) {
            const topic = topics.find((item) => item.id === selectedTopicId);
            const nextActual = (topic?.actual_minutes ?? 0) + savedMinutes;
            if (!navigator.onLine) queueMutation({ userId, table: "topics", operation: "update", filterColumn: "id", filterValue: selectedTopicId, row: { actual_minutes: nextActual } });
            else await client.from("topics").update({ actual_minutes: nextActual }).eq("id", selectedTopicId).eq("user_id", userId);
            setTopics((current) => current.map((item) => item.id === selectedTopicId ? { ...item, actual_minutes: nextActual } : item));
          }
          if (navigator.onLine) await client.functions.invoke("notify", { body: { type: "session_done", session_id: sessionId } }).catch(() => undefined);
        }
        setSessionStartedAt(null);
        setNotice(navigator.onLine ? sessionType === "study" ? "Study session saved. Excellent work." : "Break complete. Ready for the next block." : "Session saved offline and queued for sync.");
      })();
    }, 250);
    return () => window.clearInterval(timer);
  }, [client, deadline, selectedSubjectId, selectedTopicId, sessionLength, sessionStartedAt, sessionType, topics, userId]);

  function chooseDuration(minutesValue: number, type: "study" | "break" = sessionType) {
    if (running) return;
    setSessionType(type);
    setDurationMinutes(minutesValue);
    setSessionLength(minutesValue * 60);
    setRemainingSeconds(minutesValue * 60);
    setSessionStartedAt(null);
    finishLock.current = false;
  }

  function startOrPause() {
    if (running) {
      const left = Math.max(0, Math.ceil((deadline! - Date.now()) / 1000));
      setRemainingSeconds(left);
      setDeadline(null);
      return;
    }
    if (remainingSeconds <= 0) return;
    const now = Date.now();
    setSessionStartedAt((current) => current ?? new Date(now).toISOString());
    finishLock.current = false;
    setDeadline(now + remainingSeconds * 1000);
  }

  function reset() {
    setDeadline(null);
    setSessionStartedAt(null);
    setSessionLength(durationMinutes * 60);
    setRemainingSeconds(durationMinutes * 60);
    finishLock.current = false;
  }

  function saveCustom() {
    const bounded = Math.min(180, Math.max(1, Math.round(customMinutes)));
    chooseDuration(bounded);
  }

  return (
    <section className="focus-content">
      <button className="back-link" onClick={onBack}><ChevronRight size={16} /> Back to today</button>
      <div className="focus-intro"><p className="eyebrow">FOCUS ROOM</p><h1>Give one thing<br />your full attention.</h1><p>{sessionType === "study" ? "Choose a block and connect it to your syllabus." : "A short break keeps your next study block sustainable."}</p></div>
      <div className="timer-panel">
        <div className="timer-mode-switch"><button className={sessionType === "study" ? "selected" : ""} onClick={() => chooseDuration(25, "study")} disabled={running}>Study</button><button className={sessionType === "break" ? "selected" : ""} onClick={() => chooseDuration(5, "break")} disabled={running}>Break</button></div>
        <div className="timer-presets">{(sessionType === "study" ? [25, 50, 60, 90] : [5, 10, 15, 30]).map((preset) => <button className={durationMinutes === preset ? "active" : ""} key={preset} onClick={() => chooseDuration(preset)} disabled={running}>{preset}m</button>)}</div>
        <div className="custom-timer"><label>Custom minutes<input type="number" min="1" max="180" value={customMinutes} onChange={(event) => setCustomMinutes(Number(event.target.value))} disabled={running} /></label><button className="secondary-button" onClick={saveCustom} disabled={running}>Set</button></div>
        {sessionType === "study" && <div className="timer-context"><label>Subject<select value={selectedSubjectId} onChange={(event) => { setSelectedSubjectId(event.target.value); setSelectedTopicId(""); }} disabled={running}><option value="">Unassigned</option>{subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label><label>Topic<select value={selectedTopicId} onChange={(event) => setSelectedTopicId(event.target.value)} disabled={running || !selectedSubjectId}><option value="">Unassigned</option>{currentTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}</select></label></div>}
        {notice && <div className="notice" role="status">{notice}</div>}{error && <div className="error-banner" role="alert">{error}</div>}
        <div className="timer-ring" aria-label={`${minutes} minutes ${String(seconds).padStart(2, "0")} seconds remaining`}>
          <svg viewBox="0 0 240 240" aria-hidden="true"><circle className="timer-track" cx="120" cy="120" r="106" /><circle className="timer-progress" cx="120" cy="120" r="106" strokeDasharray={circumference} strokeDashoffset={dashOffset} /></svg>
          <div className="timer-value"><span>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span><small>{running ? "IN SESSION" : "READY WHEN YOU ARE"}</small></div>
        </div>
        <div className="timer-actions"><button className="primary-button timer-start" onClick={startOrPause} disabled={remainingSeconds === 0}>{running ? <Pause size={17} /> : <Play size={17} />}{running ? "Pause session" : sessionStartedAt ? "Resume session" : "Start session"}</button><button className="icon-button reset-button" onClick={reset} title="Reset timer" aria-label="Reset timer"><RotateCcw size={17} /></button><button className="secondary-button" onClick={() => chooseDuration(sessionType === "study" ? 5 : 25, sessionType === "study" ? "break" : "study")} disabled={running}>Switch to {sessionType === "study" ? "break" : "study"}</button></div>
        <div className="session-count"><TimerReset size={16} /><span>{sessions} study sessions · {Math.floor(totalFocusedMinutes / 60)}h {totalFocusedMinutes % 60}m focused today</span></div>
      </div>
      <div className="focus-quote"><Clock3 size={17} /><span>Timer progress uses timestamps, so switching tabs does not lose time. Completed sessions are saved to your cloud history.</span></div>
    </section>
  );
}

export default App;