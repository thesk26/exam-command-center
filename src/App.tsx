import { useEffect, useState, type FormEvent } from "react";
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Command,
  Flame,
  LoaderCircle,
  LogOut,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Sparkles,
  Target,
  TimerReset,
  Trash2,
} from "lucide-react";

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

type Page = "today" | "focus";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase: SupabaseClient | null =
  supabaseUrl && supabaseAnonKey ? createClient(supabaseUrl, supabaseAnonKey) : null;

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
  return <CommandCenter client={supabase} userId={session.user.id} displayName={displayName} onSignOut={() => supabase.auth.signOut()} />;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
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
            <input id="password" type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Enter your password" required />
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

function CommandCenter({ client, userId, displayName, onSignOut }: { client: SupabaseClient; userId: string; displayName: string; onSignOut: () => void }) {
  const [page, setPage] = useState<Page>("today");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showForm, setShowForm] = useState(false);

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
          <div className="profile-chip"><span className="avatar">{name[0]}</span><span>{name}</span><button aria-label="Sign out" onClick={onSignOut}><LogOut size={16} /></button></div>
        </header>

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
        ) : <FocusRoom onBack={() => setPage("today")} />}
      </main>
      <nav className="mobile-nav" aria-label="Mobile navigation">
        <button className={page === "today" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("today")}><BookOpen size={19} /><span>Today</span></button>
        <button className={page === "focus" ? "mobile-nav-item active" : "mobile-nav-item"} onClick={() => setPage("focus")}><Target size={19} /><span>Focus</span></button>
        <button className="mobile-nav-item" onClick={onSignOut}><LogOut size={19} /><span>Sign out</span></button>
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

function FocusRoom({ onBack }: { onBack: () => void }) {
  const [remainingSeconds, setRemainingSeconds] = useState(25 * 60);
  const [running, setRunning] = useState(false);
  const [sessions, setSessions] = useState(0);
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds % 60;
  const circumference = 2 * Math.PI * 106;
  const dashOffset = circumference * (1 - remainingSeconds / (25 * 60));

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setRemainingSeconds((current) => Math.max(0, current - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [running]);

  useEffect(() => {
    if (running && remainingSeconds === 0) {
      setRunning(false);
      setSessions((count) => count + 1);
    }
  }, [remainingSeconds, running]);

  function reset() {
    setRunning(false);
    setRemainingSeconds(25 * 60);
  }

  return (
    <section className="focus-content">
      <button className="back-link" onClick={onBack}><ChevronRight size={16} /> Back to today</button>
      <div className="focus-intro"><p className="eyebrow">FOCUS ROOM</p><h1>Give one thing<br />your full attention.</h1><p>Twenty-five minutes. One task. No rush.</p></div>
      <div className="timer-panel">
        <div className="timer-ring" aria-label={`${minutes} minutes ${String(seconds).padStart(2, "0")} seconds remaining`}>
          <svg viewBox="0 0 240 240" aria-hidden="true"><circle className="timer-track" cx="120" cy="120" r="106" /><circle className="timer-progress" cx="120" cy="120" r="106" strokeDasharray={circumference} strokeDashoffset={dashOffset} /></svg>
          <div className="timer-value"><span>{String(minutes).padStart(2, "0")}:{String(seconds).padStart(2, "0")}</span><small>{running ? "IN SESSION" : "READY WHEN YOU ARE"}</small></div>
        </div>
        <div className="timer-actions">
          <button className="primary-button timer-start" onClick={() => setRunning((value) => !value)} disabled={remainingSeconds === 0}>{running ? <Pause size={17} /> : <Play size={17} />}{running ? "Pause session" : "Start session"}</button>
          <button className="icon-button reset-button" onClick={reset} title="Reset timer" aria-label="Reset timer"><RotateCcw size={17} /></button>
        </div>
        <div className="session-count"><TimerReset size={16} /><span>{sessions} {sessions === 1 ? "session" : "sessions"} completed today</span></div>
      </div>
      <div className="focus-quote"><Clock3 size={17} /><span>Take a short break when the timer ends. Your mind needs recovery, too.</span></div>
    </section>
  );
}

export default App;