import { Check, Clock, Play, RefreshCcw, Send, X, Calendar, Eye, Zap } from "lucide-react";
import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

type Stats = Record<string, number>;
type Topic = {
  id: string;
  title: string;
  keywords: string[];
  sources: string[];
  score: number | null;
  decision: string | null;
  state: string;
};
type ContentItem = {
  id: string;
  type: "reel" | "carousel";
  status: string;
  payload: any;
  qa_result: any;
  topic_title: string;
  page_name: string;
  platform: string;
  handle: string;
};
type Post = {
  id: string;
  state: string;
  scheduled_at: string;
  platform: string;
  page_name: string;
  topic_title: string;
  dry_run: boolean;
  type: string;
};

const api = {
  async get<T>(path: string): Promise<T> {
    const response = await fetch(`/api${path}`);
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  },
  async post<T>(path: string): Promise<T> {
    const response = await fetch(`/api${path}`, { method: "POST" });
    if (!response.ok) throw new Error(await response.text());
    return response.json();
  }
};

function App() {
  const [stats, setStats] = useState<Stats>({});
  const [topics, setTopics] = useState<Topic[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [posts, setPosts] = useState<Post[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"review" | "approved" | "scheduled">("review");

  async function refresh() {
    setError(null);
    const [nextStats, nextTopics, nextContent, nextPosts] = await Promise.all([
      api.get<Stats>("/stats"),
      api.get<Topic[]>("/topics"),
      api.get<ContentItem[]>("/content"),
      api.get<Post[]>("/posts")
    ]);
    setStats(nextStats);
    setTopics(nextTopics);
    setContent(nextContent);
    setPosts(nextPosts);
  }

  async function runJob(job: string) {
    setBusy(job);
    setError(null);
    try {
      await api.post(`/jobs/${job}`);
      showSuccess(`${job.charAt(0).toUpperCase() + job.slice(1)} job queued!`);
      // Poll a few times to catch completion
      setTimeout(refresh, 1000);
      setTimeout(refresh, 3000);
      setTimeout(refresh, 6000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Job failed");
    } finally {
      setBusy(null);
    }
  }

  async function approve(id: string) {
    setBusy(id);
    try {
      await api.post(`/content/${id}/approve`);
      showSuccess("Content approved! Click 'Schedule Approved' to assign a time slot.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approve failed");
    } finally {
      setBusy(null);
    }
  }

  async function reject(id: string) {
    setBusy(id);
    try {
      await api.post(`/content/${id}/reject`);
      showSuccess("Content rejected.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reject failed");
    } finally {
      setBusy(null);
    }
  }

  async function scheduleApproved() {
    setBusy("schedule");
    try {
      const result = await api.post<{ scheduled: any[] }>("/schedule/approved");
      const count = result.scheduled?.length ?? 0;
      if (count > 0) {
        showSuccess(`${count} post(s) scheduled! Check the Scheduled tab.`);
        setActiveTab("scheduled");
      } else {
        showSuccess("No approved items to schedule. Approve content first.");
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Schedule failed");
    } finally {
      setBusy(null);
    }
  }

  function showSuccess(msg: string) {
    setSuccessMsg(msg);
    setTimeout(() => setSuccessMsg(null), 4000);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err instanceof Error ? err.message : "Failed to load dashboard"));
  }, []);

  const qaReady = useMemo(() => content.filter((item) => item.status === "qa_passed"), [content]);
  const approved = useMemo(() => content.filter((item) => item.status === "approved"), [content]);
  const scheduled = useMemo(() => posts.filter((p) => p.state === "SCHEDULED"), [posts]);
  const posted = useMemo(() => posts.filter((p) => p.state === "POSTED" || p.state === "ANALYZED"), [posts]);

  return (
    <main>
      <header className="topbar">
        <div>
          <p className="eyebrow">Semi-automated MVP</p>
          <h1>Theme Page Content Engine</h1>
        </div>
        <div className="actions">
          <button onClick={() => refresh()} title="Refresh dashboard">
            <RefreshCcw size={18} /> Refresh
          </button>
          <a href="/queues" className="link-button" target="_blank">
            <Clock size={18} /> Queues
          </a>
        </div>
      </header>

      {error && <div className="error">{error}</div>}
      {successMsg && <div className="success">{successMsg}</div>}

      <section className="metrics">
        {[
          ["Topics", stats.topics ?? 0, "📥"],
          ["Selected", stats.selected_topics ?? 0, "🎯"],
          ["QA Ready", stats.qa_ready ?? 0, "✅"],
          ["Approved", stats.approved ?? 0, "👍"],
          ["Scheduled", stats.scheduled ?? 0, "📅"],
          ["Posted", stats.posted ?? 0, "🚀"]
        ].map(([label, value, icon]) => (
          <div className="metric" key={label as string}>
            <span>
              {icon} {label}
            </span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="pipeline">
        <div className="pipeline-steps">
          <button onClick={() => runJob("ingest")} disabled={!!busy} className="step-btn">
            <Play size={18} /> Ingest
          </button>
          <span className="arrow">→</span>
          <button onClick={() => runJob("score")} disabled={!!busy} className="step-btn">
            <Play size={18} /> Score
          </button>
          <span className="arrow">→</span>
          <button onClick={() => runJob("generate")} disabled={!!busy} className="step-btn">
            <Zap size={18} /> Generate
          </button>
          <span className="arrow">→</span>
          <span className="step-label">Review ↓</span>
          <span className="arrow">→</span>
          <button onClick={scheduleApproved} disabled={!!busy} className="step-btn schedule-btn">
            <Send size={18} /> Schedule Approved
          </button>
        </div>
      </section>

      <div className="grid">
        {/* Left Column — Tabbed content area */}
        <section>
          <div className="tabs">
            <button
              className={`tab ${activeTab === "review" ? "active" : ""}`}
              onClick={() => setActiveTab("review")}
            >
              <Eye size={16} /> Review ({qaReady.length})
            </button>
            <button
              className={`tab ${activeTab === "approved" ? "active" : ""}`}
              onClick={() => setActiveTab("approved")}
            >
              <Check size={16} /> Approved ({approved.length})
            </button>
            <button
              className={`tab ${activeTab === "scheduled" ? "active" : ""}`}
              onClick={() => setActiveTab("scheduled")}
            >
              <Calendar size={16} /> Scheduled ({scheduled.length + posted.length})
            </button>
          </div>

          {/* REVIEW TAB */}
          {activeTab === "review" && (
            <div className="list">
              {qaReady.map((item) => (
                <article className="content-row" key={item.id}>
                  <div className="row-head">
                    <div>
                      <strong>{item.topic_title}</strong>
                      <p>
                        {item.page_name} · {item.platform} · {item.type}
                      </p>
                    </div>
                    <span className="status">{item.status}</span>
                  </div>
                  <Preview item={item} />
                  <QualityChecks result={item.qa_result} />
                  <div className="row-actions">
                    <button onClick={() => approve(item.id)} disabled={busy === item.id} className="approve-btn">
                      <Check size={17} /> Approve
                    </button>
                    <button className="danger" onClick={() => reject(item.id)} disabled={busy === item.id}>
                      <X size={17} /> Reject
                    </button>
                  </div>
                </article>
              ))}
              {qaReady.length === 0 && (
                <div className="empty-state">
                  <p>No QA-passed content waiting for review.</p>
                  <p className="hint">Run Generate to create content from selected topics.</p>
                </div>
              )}
            </div>
          )}

          {/* APPROVED TAB */}
          {activeTab === "approved" && (
            <div className="list">
              {approved.length > 0 && (
                <div className="tab-action-bar">
                  <p>
                    <strong>{approved.length}</strong> approved item(s) ready to schedule.
                  </p>
                  <button onClick={scheduleApproved} disabled={!!busy} className="schedule-btn">
                    <Send size={16} /> Schedule All →
                  </button>
                </div>
              )}
              {approved.map((item) => (
                <article className="content-row approved-row" key={item.id}>
                  <div className="row-head">
                    <div>
                      <strong>{item.topic_title}</strong>
                      <p>
                        {item.page_name} · {item.platform} · {item.type}
                      </p>
                    </div>
                    <span className="status approved-status">✅ approved</span>
                  </div>
                  <Preview item={item} />
                </article>
              ))}
              {approved.length === 0 && (
                <div className="empty-state">
                  <p>No approved content yet.</p>
                  <p className="hint">Go to Review tab and approve content items first.</p>
                </div>
              )}
            </div>
          )}

          {/* SCHEDULED TAB */}
          {activeTab === "scheduled" && (
            <div className="list">
              {scheduled.length === 0 && posted.length === 0 && (
                <div className="empty-state">
                  <p>No scheduled or posted content yet.</p>
                  <p className="hint">Approve content, then click "Schedule Approved" to assign time slots.</p>
                </div>
              )}
              {scheduled.length > 0 && (
                <>
                  <h3 className="list-heading">📅 Scheduled</h3>
                  {scheduled.map((post) => (
                    <article className="content-row scheduled-row" key={post.id}>
                      <div className="row-head">
                        <div>
                          <strong>{post.topic_title}</strong>
                          <p>
                            {post.page_name} · {post.platform} · {post.type}
                          </p>
                        </div>
                        <div className="post-meta">
                          <span className="status scheduled-status">📅 {post.state}</span>
                          {post.dry_run && <span className="badge dry-run">DRY RUN</span>}
                        </div>
                      </div>
                      <div className="schedule-info">
                        <Calendar size={14} />
                        <span>
                          {post.scheduled_at
                            ? new Date(post.scheduled_at).toLocaleString()
                            : "Pending time slot"}
                        </span>
                      </div>
                    </article>
                  ))}
                </>
              )}
              {posted.length > 0 && (
                <>
                  <h3 className="list-heading">🚀 Posted</h3>
                  {posted.map((post) => (
                    <article className="content-row posted-row" key={post.id}>
                      <div className="row-head">
                        <div>
                          <strong>{post.topic_title}</strong>
                          <p>
                            {post.page_name} · {post.platform}
                          </p>
                        </div>
                        <span className="status posted-status">✅ {post.state}</span>
                      </div>
                    </article>
                  ))}
                </>
              )}
            </div>
          )}
        </section>

        {/* Right Column — Recent Topics */}
        <section>
          <div className="section-heading">
            <h2>Recent Topics</h2>
            <span>{topics.length}</span>
          </div>
          <div className="list compact">
            {topics.slice(0, 15).map((topic) => (
              <article className="topic-row" key={topic.id}>
                <strong>{topic.title}</strong>
                <p>{topic.keywords.slice(0, 5).join(", ")}</p>
                <div className="topic-meta">
                  <span>{topic.state}</span>
                  <span>{topic.decision ?? "unscored"}</span>
                  <span>{topic.score ? topic.score.toFixed(2) : "n/a"}</span>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function Preview({ item }: { item: ContentItem }) {
  if (item.type === "carousel") {
    const slides = item.payload.carousel ?? [];
    return (
      <div className="slides">
        {slides.map((slide: any) => (
          <div className="slide" key={slide.slide}>
            <span>{slide.slide}</span>
            <strong>{slide.title}</strong>
            <p>{slide.body}</p>
          </div>
        ))}
      </div>
    );
  }
  const reel = item.payload.reel;
  return (
    <div className="script">
      <strong>{reel.hook}</strong>
      <p>{reel.script}</p>
      <em>{reel.cta}</em>
    </div>
  );
}

function QualityChecks({ result }: { result: any }) {
  return (
    <div className="checks">
      {(result?.checks ?? []).map((check: any) => (
        <span className={check.passed ? "pass" : "fail"} key={check.name}>
          {check.name}
        </span>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
