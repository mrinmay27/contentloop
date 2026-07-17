import React, { useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { PipelineBar } from '../components/dashboard/PipelineBar';
import { TopicCard } from '../components/dashboard/TopicCard';
import { ConfirmModal } from '../components/modals/ConfirmModal';
import { AddTopicDrawer } from '../components/pipeline/AddTopicDrawer';
import { ScheduleBatchModal } from '../components/pipeline/ScheduleBatchModal';
import { api } from '../lib/api';
import type { Topic, Stats, ThemePage } from '../lib/types';

type Props = {
  topics: Topic[];
  stats: Stats;
  busy: string | null;
  page: ThemePage;
  onOpenEditor: (t: Topic) => void;
  onRunJob: (j: string) => void;
};

export const PipelineView: React.FC<Props> = ({ topics, stats, busy, page, onOpenEditor, onRunJob }) => {
  const [local, setLocal]               = useState<Topic[]>(topics);
  const [selectedIds, setSelectedIds]   = useState<Set<string>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<Topic | null>(null);
  const [showAddDrawer,    setShowAddDrawer]    = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  // Track which topics have been approved via the preview panel so the
  // bulk action bar can offer "Schedule Selected" for them immediately.
  const [approvedIds, setApprovedIds] = useState<Set<string>>(new Set());
  React.useEffect(() => { setLocal(topics); }, [topics]);

  const handleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleTopicCreated = (topic: Topic) => {
    setShowAddDrawer(false);
    setLocal(prev => [topic, ...prev]);
    onOpenEditor(topic);
  };

  const handleApproved = (topicId: string) => {
    setApprovedIds(prev => new Set([...prev, topicId]));
  };

  const requestDiscard = (id: string) => {
    const topic = local.find(t => t.id === id);
    if (topic) setPendingDelete(topic);
  };

  const confirmDiscard = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    setPendingDelete(null);
    setLocal(prev => prev.filter(t => t.id !== id));
    try { await api.rejectContent(id); } catch {}
  };

  const discardSelected = async () => {
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    setLocal(prev => prev.filter(t => !ids.includes(t.id)));
    await Promise.allSettled(ids.map(id => api.rejectContent(id)));
  };

  const selectionCount = selectedIds.size;
  const selectedTopics = local.filter(t => selectedIds.has(t.id));

  // A topic is ready to schedule if it's approved (either from API or just approved in preview)
  const scheduleReadyTopics = selectedTopics.filter(t =>
    t.status === 'approved' || approvedIds.has(t.id)
  );
  const canSchedule = scheduleReadyTopics.length > 0;

  const nextStep: { job: string; label: string } | 'editor' | null = (() => {
    if (selectedTopics.some(t => t.state === 'IDEA'))   return { job: 'score',    label: 'Score Topics' };
    if (selectedTopics.some(t => t.state === 'SCORED')) return { job: 'generate', label: 'Generate Content' };
    if (selectedTopics.some(t => t.state === 'CONTENT_READY' || t.state === 'QA_PASSED')) return 'editor';
    return null;
  })();

  return (
    <>
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="topbar">
        <span className="topbar-title">Content Pipeline</span>
        <div className="topbar-right">
          <button className="btn btn-surface btn-sm" onClick={() => setShowAddDrawer(true)}>
            <Icon name="plus" size={11}/> Add Topic
          </button>
          <button className="btn btn-primary btn-sm" disabled={!!busy}
            onClick={() => onRunJob('ingest')}>
            <Icon name="refresh" size={11}/> Run All Steps
          </button>
        </div>
      </div>

      {/* Bulk action bar */}
      {selectionCount > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '8px 20px',
          background: 'color-mix(in srgb, var(--accent) 10%, var(--bg-surface))',
          borderBottom: '1px solid var(--accent)',
          fontSize: 12, flexWrap: 'wrap',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--accent)', flex: 1, minWidth: 120 }}>
            {selectionCount} topic{selectionCount > 1 ? 's' : ''} selected
            {scheduleReadyTopics.length > 0 && selectionCount > scheduleReadyTopics.length && (
              <span style={{ fontWeight: 400, color: 'var(--text-muted)', marginLeft: 6 }}>
                ({scheduleReadyTopics.length} approved)
              </span>
            )}
          </span>

          {/* Schedule Selected — only when approved topics are in selection */}
          {canSchedule && (
            <button className="btn btn-primary btn-sm"
              onClick={() => setShowScheduleModal(true)}>
              📅 Schedule {scheduleReadyTopics.length > 1 ? `${scheduleReadyTopics.length} Posts` : 'Post'}
            </button>
          )}

          {/* Run Next Step */}
          {nextStep && nextStep !== 'editor' && (
            <button className="btn btn-surface btn-sm" disabled={!!busy}
              title="Runs this pipeline step for all eligible topics"
              onClick={() => { setSelectedIds(new Set()); onRunJob((nextStep as any).job); }}>
              ▶ {(nextStep as any).label}
            </button>
          )}

          {/* Open Editor — single selection */}
          {selectionCount === 1 && (
            <button className="btn btn-surface btn-sm"
              onClick={() => {
                const topic = local.find(t => selectedIds.has(t.id));
                if (topic) { setSelectedIds(new Set()); onOpenEditor(topic); }
              }}>
              <Icon name="edit" size={11}/> Open Editor
            </button>
          )}

          <button className="btn btn-danger btn-sm" onClick={discardSelected}>
            <Icon name="trash" size={11}/> Discard{selectionCount > 1 ? ' All' : ''}
          </button>
          <button className="btn btn-surface btn-sm" style={{ padding: '3px 8px' }}
            onClick={() => setSelectedIds(new Set())}>
            ✕ Clear
          </button>
        </div>
      )}

      {/* Stage strip pinned; only the topic list below scrolls. */}
      <div className="view-area" style={{ flex: 'none', overflowY: 'visible', paddingBottom: 0 }}>
        <PipelineBar activeStep="generate" setActiveStep={() => {}}
          counts={{ ingest: stats.topics, score: stats.selected_topics,
            generate: stats.qa_ready, review: stats.approved, schedule: stats.scheduled }}/>
      </div>
      <div className="view-area" style={{ paddingTop: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }} className="stagger">
          {local.map(topic => (
            <TopicCard key={topic.id} topic={topic} pageId={page.id}
              selected={selectedIds.has(topic.id)} onSelect={handleSelect}
              onEdit={onOpenEditor} onDiscard={requestDiscard}
              onApproved={handleApproved}/>
          ))}
          {local.length === 0 && (
            <div className="empty-state">
              <div style={{ fontSize: 28, opacity: 0.3 }}>◉</div>
              <div style={{ fontWeight: 600 }}>No topics yet</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Run Ingest to pull trending topics
              </div>
            </div>
          )}
        </div>
      </div>
    </div>

    {pendingDelete && (
      <ConfirmModal
        title="Discard Topic?"
        message={`"${pendingDelete.title}" will be removed from the queue and marked as rejected. This cannot be undone.`}
        confirmLabel="Yes, Discard"
        onConfirm={confirmDiscard}
        onCancel={() => setPendingDelete(null)}
      />
    )}

    {showAddDrawer && (
      <AddTopicDrawer
        onCreated={handleTopicCreated}
        onClose={() => setShowAddDrawer(false)}
      />
    )}

    {showScheduleModal && (
      <ScheduleBatchModal
        topics={scheduleReadyTopics}
        page={page}
        onScheduled={() => { setShowScheduleModal(false); setSelectedIds(new Set()); }}
        onClose={() => setShowScheduleModal(false)}
      />
    )}
    </>
  );
};
