import { useEffect, useState, type FormEvent } from "react";
import { BookOpen, Download, LoaderCircle, Pencil, Plus, Save, Trash2, Upload, X } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { queueMutation } from "./offline";

type Subject = {
  id: string;
  name: string;
  paper_code: string | null;
  exam_type: "backlog" | "regular";
  total_marks: number;
  target_marks: number | null;
  exam_id: string | null;
  exam: { starts_at: string; time_label: string }[] | null;
};

type Unit = { id: string; subject_id: string; title: string; sort_order: number };
type TopicStatus = "not_started" | "in_progress" | "completed" | "needs_revision";
type Priority = "must_study" | "high" | "medium" | "low";
type Topic = {
  id: string;
  subject_id: string;
  unit_id: string | null;
  title: string;
  priority: Priority;
  status: TopicStatus;
  estimated_minutes: number;
  actual_minutes: number;
  confidence: number;
  revision_count: number;
  notes: string;
};

const statusLabels: Record<TopicStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  completed: "Completed",
  needs_revision: "Needs revision",
};

const priorityLabels: Record<Priority, string> = {
  must_study: "Must study",
  high: "High",
  medium: "Medium",
  low: "Low",
};

export function StudyLibrary({ client, userId }: { client: SupabaseClient; userId: string }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [units, setUnits] = useState<Unit[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [showSubjectForm, setShowSubjectForm] = useState(false);
  const [showTopicForm, setShowTopicForm] = useState(false);
  const [editingSubject, setEditingSubject] = useState(false);

  async function loadLibrary() {
    setLoading(true);
    setError("");
    const [subjectResult, unitResult, topicResult] = await Promise.all([
      client.from("subjects").select("id,name,paper_code,exam_type,total_marks,target_marks,exam_id,exam:exams(starts_at,time_label)").eq("user_id", userId).order("exam_type").order("name"),
      client.from("units").select("id,subject_id,title,sort_order").eq("user_id", userId).order("sort_order"),
      client.from("topics").select("id,subject_id,unit_id,title,priority,status,estimated_minutes,actual_minutes,confidence,revision_count,notes").eq("user_id", userId).order("created_at"),
    ]);
    if (subjectResult.error || unitResult.error || topicResult.error) {
      setError("Study data could not be loaded. Confirm the 002 study modules migration was applied.");
      setLoading(false);
      return;
    }
    const loadedSubjects = (subjectResult.data ?? []) as Subject[];
    setSubjects(loadedSubjects);
    setUnits((unitResult.data ?? []) as Unit[]);
    setTopics((topicResult.data ?? []) as Topic[]);
    setSelectedSubjectId((current) => loadedSubjects.some((subject) => subject.id === current) ? current : loadedSubjects[0]?.id ?? "");
    setLoading(false);
  }

  useEffect(() => { void loadLibrary(); }, [client, userId]);

  useEffect(() => {
    const channel = client.channel(`study-library-${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "subjects", filter: `user_id=eq.${userId}` }, () => { void loadLibrary(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "units", filter: `user_id=eq.${userId}` }, () => { void loadLibrary(); })
      .on("postgres_changes", { event: "*", schema: "public", table: "topics", filter: `user_id=eq.${userId}` }, () => { void loadLibrary(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [client, userId]);

  const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId) ?? null;
  const subjectUnits = units.filter((unit) => unit.subject_id === selectedSubjectId);
  const visibleTopics = topics.filter((topic) => {
    const matchesText = topic.title.toLowerCase().includes(search.toLowerCase()) || topic.notes.toLowerCase().includes(search.toLowerCase());
    return topic.subject_id === selectedSubjectId
      && matchesText
      && (statusFilter === "all" || topic.status === statusFilter)
      && (priorityFilter === "all" || topic.priority === priorityFilter);
  });
  const completedCount = topics.filter((topic) => topic.subject_id === selectedSubjectId && topic.status === "completed").length;
  const topicCount = topics.filter((topic) => topic.subject_id === selectedSubjectId).length;

  async function addSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    const values = new FormData(event.currentTarget);
    const payload = {
      id: crypto.randomUUID(),
      user_id: userId,
      name: String(values.get("name")).trim(),
      paper_code: String(values.get("paper_code")).trim() || null,
      exam_type: String(values.get("exam_type")) as Subject["exam_type"],
      total_marks: Number(values.get("total_marks")),
      target_marks: values.get("target_marks") ? Number(values.get("target_marks")) : null,
    };
    if (!navigator.onLine) {
      queueMutation({ userId, table: "subjects", operation: "insert", row: payload });
      setSubjects((current) => [...current, { ...payload, exam: null, exam_id: null } as Subject]);
      setSelectedSubjectId(payload.id); setShowSubjectForm(false); setNotice("Subject saved offline; it will sync when you reconnect."); setBusy(false); return;
    }
    const { data, error: insertError } = await client.from("subjects").insert(payload).select("id,name,paper_code,exam_type,total_marks,target_marks,exam_id,exam:exams(starts_at,time_label)").single();
    if (insertError) setError("Subject could not be saved. Check that the name is unique and the marks are valid.");
    else {
      setSubjects((current) => [...current, data as Subject].sort((a, b) => a.name.localeCompare(b.name)));
      setSelectedSubjectId((data as Subject).id);
      setShowSubjectForm(false);
      setNotice("Subject saved to your cloud library.");
    }
    setBusy(false);
  }

  async function updateSubject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSubject) return;
    setBusy(true);
    const values = new FormData(event.currentTarget);
    const changes = {
      name: String(values.get("name")).trim(),
      paper_code: String(values.get("paper_code")).trim() || null,
      exam_type: String(values.get("exam_type")) as Subject["exam_type"],
      total_marks: Number(values.get("total_marks")),
      target_marks: values.get("target_marks") ? Number(values.get("target_marks")) : null,
    };
    if (!navigator.onLine) {
      queueMutation({ userId, table: "subjects", operation: "update", filterColumn: "id", filterValue: selectedSubject.id, row: changes });
      setSubjects((current) => current.map((subject) => subject.id === selectedSubject.id ? { ...subject, ...changes } : subject));
      setEditingSubject(false); setNotice("Subject changes saved offline; they will sync when you reconnect."); setBusy(false); return;
    }
    const { error: updateError } = await client.from("subjects").update(changes).eq("id", selectedSubject.id).eq("user_id", userId);
    if (updateError) setError("Subject changes could not be saved.");
    else {
      setSubjects((current) => current.map((subject) => subject.id === selectedSubject.id ? { ...subject, ...changes } : subject));
      setEditingSubject(false);
      setNotice("Subject changes saved.");
    }
    setBusy(false);
  }

  async function deleteSubject(subject: Subject) {
    if (!window.confirm(`Delete ${subject.name} and its units, topics, revisions, PYQs, and mock tests?`)) return;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "subjects", operation: "delete", filterColumn: "id", filterValue: subject.id });
      const remaining = subjects.filter((item) => item.id !== subject.id);
      setSubjects(remaining); setUnits((current) => current.filter((unit) => unit.subject_id !== subject.id)); setTopics((current) => current.filter((topic) => topic.subject_id !== subject.id)); setSelectedSubjectId(remaining[0]?.id ?? ""); setNotice("Subject removal queued for sync."); return;
    }
    const { error: deleteError } = await client.from("subjects").delete().eq("id", subject.id).eq("user_id", userId);
    if (deleteError) setError("Subject could not be deleted.");
    else {
      const remaining = subjects.filter((item) => item.id !== subject.id);
      setSubjects(remaining);
      setUnits((current) => current.filter((unit) => unit.subject_id !== subject.id));
      setTopics((current) => current.filter((topic) => topic.subject_id !== subject.id));
      setSelectedSubjectId(remaining[0]?.id ?? "");
      setNotice("Subject and its syllabus data were removed.");
    }
  }

  async function addUnit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSubject) return;
    const values = new FormData(event.currentTarget);
    const title = String(values.get("unit_title")).trim();
    if (!title) return;
    const unitPayload = { id: crypto.randomUUID(), user_id: userId, subject_id: selectedSubject.id, title, sort_order: subjectUnits.length + 1 };
    if (!navigator.onLine) {
      queueMutation({ userId, table: "units", operation: "insert", row: unitPayload });
      setUnits((current) => [...current, unitPayload]); event.currentTarget.reset(); setNotice("Unit saved offline; it will sync when you reconnect."); return;
    }
    const { data, error: insertError } = await client.from("units").insert(unitPayload).select("id,subject_id,title,sort_order").single();
    if (insertError) setError("Unit could not be saved.");
    else {
      setUnits((current) => [...current, data as Unit]);
      event.currentTarget.reset();
      setNotice("Unit added.");
    }
  }

  async function deleteUnit(unit: Unit) {
    if (!window.confirm(`Remove ${unit.title}? Topics will remain in this subject without a unit.`)) return;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "units", operation: "delete", filterColumn: "id", filterValue: unit.id });
      setUnits((current) => current.filter((item) => item.id !== unit.id)); setTopics((current) => current.map((topic) => topic.unit_id === unit.id ? { ...topic, unit_id: null } : topic)); setNotice("Unit removal queued for sync."); return;
    }
    const { error: deleteError } = await client.from("units").delete().eq("id", unit.id).eq("user_id", userId);
    if (deleteError) setError("Unit could not be deleted.");
    else {
      setUnits((current) => current.filter((item) => item.id !== unit.id));
      setTopics((current) => current.map((topic) => topic.unit_id === unit.id ? { ...topic, unit_id: null } : topic));
      setNotice("Unit removed.");
    }
  }

  async function addTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSubject) return;
    const values = new FormData(event.currentTarget);
    const payload = {
      id: crypto.randomUUID(),
      user_id: userId,
      subject_id: selectedSubject.id,
      unit_id: String(values.get("unit_id") || "") || null,
      title: String(values.get("topic_title")).trim(),
      priority: String(values.get("priority")) as Priority,
      estimated_minutes: Number(values.get("estimated_minutes")),
    };
    if (!payload.title) return;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "topics", operation: "insert", row: payload });
      setTopics((current) => [...current, { ...payload, actual_minutes: 0, confidence: 0, revision_count: 0, notes: "", status: "not_started" } as Topic]);
      setShowTopicForm(false); setNotice("Topic saved offline; it will sync when you reconnect."); return;
    }
    const { data, error: insertError } = await client.from("topics").insert(payload).select("id,subject_id,unit_id,title,priority,status,estimated_minutes,actual_minutes,confidence,revision_count,notes").single();
    if (insertError) setError("Topic could not be saved.");
    else {
      setTopics((current) => [...current, data as Topic]);
      setShowTopicForm(false);
      setNotice("Topic added and synced.");
    }
  }

  async function updateTopic(topic: Topic, changes: Partial<Topic>) {
    if (!navigator.onLine) {
      queueMutation({ userId, table: "topics", operation: "update", filterColumn: "id", filterValue: topic.id, row: changes as Record<string, unknown> });
      setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, ...changes } : item));
      setNotice("Topic change queued for sync.");
      if (changes.status === "completed" && topic.status !== "completed") {
        const dueAt = new Date();
        queueMutation({ userId, table: "revision_records", operation: "insert", row: { id: crypto.randomUUID(), user_id: userId, topic_id: topic.id, due_at: dueAt.toISOString() } });
      }
      return;
    }
    const { error: updateError } = await client.from("topics").update(changes).eq("id", topic.id).eq("user_id", userId);
    if (updateError) setError("Topic update failed. Your previous value was kept.");
    else {
      setTopics((current) => current.map((item) => item.id === topic.id ? { ...item, ...changes } : item));
      setNotice("Topic change synced.");
      if (changes.status === "completed" && topic.status !== "completed") {
        const dueAt = new Date();
        const { error: revisionError } = await client.from("revision_records").insert({ user_id: userId, topic_id: topic.id, due_at: dueAt.toISOString() });
        if (revisionError) setNotice("Topic saved; initial revision reminder could not be created.");
      }
    }
  }

  async function deleteTopic(topic: Topic) {
    if (!window.confirm(`Delete the topic “${topic.title}” and its revision history?`)) return;
    if (!navigator.onLine) {
      queueMutation({ userId, table: "topics", operation: "delete", filterColumn: "id", filterValue: topic.id });
      setTopics((current) => current.filter((item) => item.id !== topic.id)); setNotice("Topic removal queued for sync."); return;
    }
    const { error: deleteError } = await client.from("topics").delete().eq("id", topic.id).eq("user_id", userId);
    if (deleteError) setError("Topic could not be deleted.");
    else {
      setTopics((current) => current.filter((item) => item.id !== topic.id));
      setNotice("Topic removed.");
    }
  }

  function exportTopics() {
    const rows = [["subject", "unit", "topic", "priority", "status", "estimated_minutes", "actual_minutes", "confidence", "notes"]];
    for (const topic of topics.filter((item) => item.subject_id === selectedSubjectId)) {
      const unitName = units.find((unit) => unit.id === topic.unit_id)?.title ?? "";
      rows.push([selectedSubject?.name ?? "", unitName, topic.title, topic.priority, topic.status, String(topic.estimated_minutes), String(topic.actual_minutes), String(topic.confidence), topic.notes]);
    }
    const csv = rows.map((row) => row.map((field) => `"${field.replaceAll('"', '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${selectedSubject?.paper_code || "subject"}-topics.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function importTopics(event: FormEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    if (!file || !selectedSubject) return;
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(Boolean);
    const rows = lines.slice(1).map((line) => line.split(",").map((field) => field.trim().replace(/^"|"$/g, "")));
    const payload = rows.filter((row) => row[2]).map((row) => ({
      user_id: userId,
      subject_id: selectedSubject.id,
      title: row[2],
      priority: (row[3] || "medium") as Priority,
      status: (row[4] || "not_started") as TopicStatus,
      estimated_minutes: Math.max(1, Number(row[5]) || 30),
      actual_minutes: Math.max(0, Number(row[6]) || 0),
      confidence: Math.min(100, Math.max(0, Number(row[7]) || 0)),
      notes: row[8] || "",
    }));
    if (!payload.length) setError("The CSV contains no topic rows. Use the exported template as a guide.");
    else {
      const { error: importError } = await client.from("topics").insert(payload);
      if (importError) setError("CSV import failed. Check topic priorities, statuses, and column order.");
      else {
        setNotice(`${payload.length} topics imported.`);
        await loadLibrary();
      }
    }
    event.currentTarget.value = "";
  }

  if (loading) return <div className="module-loading"><LoaderCircle className="spin" size={22} /> Loading subjects and topics</div>;

  return (
    <section className="module-content">
      <header className="module-header">
        <div><p className="eyebrow">YOUR SYLLABUS</p><h1>Subjects &amp; topics</h1><p className="module-subtitle">Build your own syllabus. No topic list is prefilled.</p></div>
        <button className="primary-button" onClick={() => setShowSubjectForm((open) => !open)}><Plus size={16} /> Add subject</button>
      </header>
      {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}
      {error && <div className="error-banner" role="alert">{error}<button onClick={() => setError("")} aria-label="Dismiss error">×</button></div>}

      {showSubjectForm && <form className="module-form" onSubmit={addSubject}>
        <h2>New subject</h2>
        <div className="module-form-grid"><label>Subject name<input name="name" maxLength={120} required /></label><label>Paper code<input name="paper_code" maxLength={30} /></label><label>Category<select name="exam_type"><option value="backlog">Backlog</option><option value="regular">Regular</option></select></label><label>Total marks<input name="total_marks" type="number" min="1" defaultValue="60" required /></label><label>Target marks<input name="target_marks" type="number" min="0" max="60" placeholder="Optional" /></label></div>
        <div className="module-form-actions"><button className="primary-button" disabled={busy} type="submit"><Save size={15} /> Save subject</button><button className="secondary-button" type="button" onClick={() => setShowSubjectForm(false)}>Cancel</button></div>
      </form>}

      {!subjects.length ? <div className="module-empty"><BookOpen size={24} /><strong>No subjects yet</strong><span>Add subjects and enter your actual syllabus as you receive it.</span></div> : <div className="library-layout">
        <aside className="subject-list" aria-label="Subjects">
          {subjects.map((subject) => {
            const count = topics.filter((topic) => topic.subject_id === subject.id).length;
            const done = topics.filter((topic) => topic.subject_id === subject.id && topic.status === "completed").length;
            return <button key={subject.id} className={subject.id === selectedSubjectId ? "subject-choice selected" : "subject-choice"} onClick={() => { setSelectedSubjectId(subject.id); setEditingSubject(false); }}>
              <span className={subject.exam_type === "backlog" ? "subject-badge backlog-badge" : "subject-badge regular-badge"}>{subject.exam_type === "backlog" ? "B" : "R"}</span>
              <span className="subject-choice-copy"><strong>{subject.name}</strong><small>{subject.paper_code || "No paper code"}</small></span>
              <span className="subject-choice-progress">{done}/{count}</span>
            </button>;
          })}
        </aside>

        {selectedSubject && <div className="subject-workspace">
          <div className="subject-workspace-head">
            <div><span className={selectedSubject.exam_type === "backlog" ? "category-label backlog-label" : "category-label regular-label"}>{selectedSubject.exam_type === "backlog" ? "BACKLOG" : "REGULAR"}</span><h2>{selectedSubject.name}</h2><p>{selectedSubject.paper_code || "No paper code"} · {selectedSubject.total_marks} marks{selectedSubject.exam?.[0]?.starts_at ? ` · ${new Date(selectedSubject.exam[0].starts_at).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}` : ""}</p></div>
            <div className="subject-actions"><button className="icon-button" onClick={() => setEditingSubject((open) => !open)} title="Edit subject" aria-label="Edit subject"><Pencil size={16} /></button><button className="icon-button danger-icon" onClick={() => void deleteSubject(selectedSubject)} title="Delete subject" aria-label="Delete subject"><Trash2 size={16} /></button></div>
          </div>

          {editingSubject && <form className="subject-edit-form" onSubmit={updateSubject}>
            <label>Name<input name="name" defaultValue={selectedSubject.name} required /></label><label>Paper code<input name="paper_code" defaultValue={selectedSubject.paper_code ?? ""} /></label><label>Category<select name="exam_type" defaultValue={selectedSubject.exam_type}><option value="backlog">Backlog</option><option value="regular">Regular</option></select></label><label>Total marks<input name="total_marks" type="number" min="1" defaultValue={selectedSubject.total_marks} required /></label><label>Target marks<input name="target_marks" type="number" min="0" max={selectedSubject.total_marks} defaultValue={selectedSubject.target_marks ?? ""} /></label><div className="module-form-actions"><button className="primary-button" type="submit"><Save size={15} /> Save</button><button className="secondary-button" type="button" onClick={() => setEditingSubject(false)}>Cancel</button></div>
          </form>}

          <div className="library-progress"><div><span>TOPIC PROGRESS</span><strong>{completedCount}/{topicCount}</strong></div><div className="progress-track"><span style={{ width: `${topicCount ? Math.round(completedCount / topicCount * 100) : 0}%` }} /></div></div>

          <section className="unit-section">
            <div className="module-section-heading"><div><h3>Units</h3><span>{subjectUnits.length} units</span></div><form className="inline-add" onSubmit={(event) => void addUnit(event)}><input name="unit_title" placeholder="e.g. Unit 1" aria-label="New unit name" required /><button className="small-icon-button" type="submit" aria-label="Add unit"><Plus size={16} /></button></form></div>
            <div className="unit-chips">{subjectUnits.map((unit) => <span className="unit-chip" key={unit.id}>{unit.title}<button onClick={() => void deleteUnit(unit)} aria-label={`Delete ${unit.title}`}><X size={12} /></button></span>)}{!subjectUnits.length && <span className="muted-small">Add units from your syllabus when ready.</span>}</div>
          </section>

          <section className="topics-section">
            <div className="module-section-heading"><div><h3>Topic checklist</h3><span>{visibleTopics.length} shown</span></div><div className="topic-toolbar"><label className="search-control"><span className="sr-only">Search topics</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search topics" /></label><button className="icon-button" onClick={exportTopics} disabled={!topicCount} title="Export topics CSV" aria-label="Export topics CSV"><Download size={16} /></button><label className="icon-button file-import" title="Import topics CSV" aria-label="Import topics CSV"><Upload size={16} /><input type="file" accept=".csv,text/csv" onChange={(event) => void importTopics(event)} /></label><button className="primary-button compact-button" onClick={() => setShowTopicForm((open) => !open)}><Plus size={15} /> Topic</button></div></div>
            <div className="topic-filters"><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">All statuses</option>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Priority<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="all">All priorities</option>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>

            {showTopicForm && <form className="topic-add-form" onSubmit={(event) => void addTopic(event)}><label>Topic name<input name="topic_title" placeholder="Enter a topic from your syllabus" required /></label><label>Unit<select name="unit_id" defaultValue=""><option value="">No unit</option>{subjectUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label><label>Priority<select name="priority" defaultValue="medium">{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Estimate (min)<input name="estimated_minutes" type="number" min="1" defaultValue="30" /></label><button className="primary-button" type="submit"><Plus size={15} /> Save topic</button></form>}

            <div className="topic-table-wrap"><table className="topic-table"><thead><tr><th>Topic</th><th>Unit</th><th>Priority</th><th>Status</th><th>Estimate</th><th>Confidence</th><th aria-label="Actions"></th></tr></thead><tbody>
              {visibleTopics.map((topic) => <tr key={topic.id}>
                <td><input className="topic-title-input" aria-label="Topic name" defaultValue={topic.title} onBlur={(event) => { if (event.target.value.trim() && event.target.value.trim() !== topic.title) void updateTopic(topic, { title: event.target.value.trim() }); }} /><textarea className="topic-notes-input" aria-label={`Notes for ${topic.title}`} placeholder="Add notes" defaultValue={topic.notes} onBlur={(event) => { if (event.target.value !== topic.notes) void updateTopic(topic, { notes: event.target.value }); }} /></td>
                <td><select aria-label={`Unit for ${topic.title}`} value={topic.unit_id ?? ""} onChange={(event) => void updateTopic(topic, { unit_id: event.target.value || null })}><option value="">—</option>{subjectUnits.map((unit) => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></td>
                <td><select aria-label={`Priority for ${topic.title}`} value={topic.priority} onChange={(event) => void updateTopic(topic, { priority: event.target.value as Priority })}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td><select aria-label={`Status for ${topic.title}`} value={topic.status} onChange={(event) => { const status = event.target.value as TopicStatus; void updateTopic(topic, { status, completed_at: status === "completed" ? new Date().toISOString() : null } as Partial<Topic>); }}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></td>
                <td><label className="number-cell"><input aria-label={`Estimated minutes for ${topic.title}`} type="number" min="1" defaultValue={topic.estimated_minutes} onBlur={(event) => { const estimated_minutes = Math.max(1, Number(event.target.value)); if (estimated_minutes !== topic.estimated_minutes) void updateTopic(topic, { estimated_minutes }); }} /> min</label></td>
                <td><label className="number-cell"><input aria-label={`Confidence for ${topic.title}`} type="number" min="0" max="100" defaultValue={topic.confidence} onBlur={(event) => { const confidence = Math.min(100, Math.max(0, Number(event.target.value))); if (confidence !== topic.confidence) void updateTopic(topic, { confidence }); }} />%</label></td>
                <td><button className="icon-button danger-icon" onClick={() => void deleteTopic(topic)} aria-label={`Delete ${topic.title}`}><Trash2 size={15} /></button></td>
              </tr>)}
              {!visibleTopics.length && <tr><td className="table-empty" colSpan={7}>{topicCount ? "No topics match these filters." : "No topics yet. Add them from your actual syllabus."}</td></tr>}
            </tbody></table></div>
          </section>
        </div>}
      </div>}
    </section>
  );
}