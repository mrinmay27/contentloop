import React, { useState } from 'react';
import { Icon } from '../components/ui/Icon';
import { PipelineBar } from '../components/dashboard/PipelineBar';
import { TopicCard } from '../components/dashboard/TopicCard';
import { ConfirmModal } from '../components/modals/ConfirmModal';
import { api } from '../lib/api';
import type { Topic, Stats } from '../lib/types';

type Props = { topics: Topic[]; stats: Stats; busy: string|null; onOpenEditor:(t:Topic)=>void; onRunJob:(j:string)=>void; };

export const PipelineView: React.FC<Props> = ({ topics, stats, busy, onOpenEditor, onRunJob }) => {
  const [local, setLocal]               = useState<Topic[]>(topics);
  const [pendingDelete, setPendingDelete] = useState<Topic | null>(null);
  React.useEffect(() => { setLocal(topics); }, [topics]);

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

  return (
    <>
    <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
      <div className="topbar">
        <span className="topbar-title">Content Pipeline</span>
        <div className="topbar-right">
          <button className="btn btn-primary btn-sm" disabled={!!busy}
            onClick={() => onRunJob('ingest')}>
            <Icon name="refresh" size={11}/> Run All Steps
          </button>
        </div>
      </div>
      <div className="view-area">
        <div style={{ marginBottom:20 }}>
          <PipelineBar activeStep="generate" setActiveStep={() => {}}
            counts={{ ingest:stats.topics, score:stats.selected_topics,
              generate:stats.qa_ready, review:stats.approved, schedule:stats.scheduled }}/>
        </div>
        <div style={{ display:'flex', flexDirection:'column', gap:8 }} className="stagger">
          {local.map(topic => (
            <TopicCard key={topic.id} topic={topic} onEdit={onOpenEditor} onDiscard={requestDiscard}/>
          ))}
          {local.length === 0 && (
            <div className="empty-state">
              <div style={{ fontSize:28, opacity:0.3 }}>◉</div>
              <div style={{ fontWeight:600 }}>No topics yet</div>
              <div style={{ fontSize:12, color:'var(--text-muted)' }}>Run Ingest to pull trending topics</div>
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
    </>
  );
};
