import React from 'react';

type StageKey = 'ingest' | 'score' | 'generate' | 'review' | 'schedule';

type StageConfig = {
  key:     StageKey;
  label:   string;
  job:     string | null;   // null = human action (Review)
  tooltip: string;
};

const STAGES: StageConfig[] = [
  { key:'ingest',   label:'Ingest',   job:'ingest',   tooltip:'Fetch new trends from Reddit, RSS, HN & Google News' },
  { key:'score',    label:'Score',    job:'score',    tooltip:'Score & filter topics by niche relevance' },
  { key:'generate', label:'Generate', job:'generate', tooltip:'Generate carousel + reel content for selected topics' },
  { key:'review',   label:'Review',   job:null,       tooltip:'Human review — approve or reject generated content' },
  { key:'schedule', label:'Schedule', job:'schedule', tooltip:'Auto-schedule approved content into posting slots' },
];

/** Detect which stage is the current bottleneck based on counts */
function detectBottleneck(counts: Partial<Record<string, number>>): StageKey {
  const { ingest = 0, score = 0, generate = 0, review = 0 } = counts;
  if (ingest === 0)    return 'ingest';   // Nothing ingested yet
  if (score === 0)     return 'score';    // Topics exist but none scored/selected
  if (generate === 0)  return 'generate'; // Selected topics but no content generated
  if (review === 0)    return 'review';   // Content generated, awaiting approval
  return 'schedule';                      // Content approved, ready to schedule
}

type Props = {
  activeStep:    string;
  setActiveStep: (k: string) => void;
  counts?:       Partial<Record<string, number>>;
  busy?:         string | null;
  onRunJob?:     (job: string) => void;
};

export const PipelineBar: React.FC<Props> = ({
  activeStep, setActiveStep, counts = {}, busy = null, onRunJob,
}) => {
  const bottleneck = detectBottleneck(counts);

  const statusLabel = (key: StageKey): string => {
    if (busy === key) return 'Running…';
    if (key === 'review') return 'Awaiting';
    if (key === 'schedule' && (counts['review'] ?? 0) > 0) return 'Ready';
    return 'Idle';
  };

  const handleClick = (stage: StageConfig) => {
    setActiveStep(stage.key);
    if (stage.job && onRunJob && !busy) {
      onRunJob(stage.job);
    }
  };

  return (
    <div className="pipeline-bar">
      {STAGES.map((stage, i) => {
        const isActive    = activeStep === stage.key;
        const isBottleneck = stage.key === bottleneck;
        const isRunning   = busy === stage.key;
        const isHuman     = stage.job === null;
        const count       = counts[stage.key] ?? 0;
        const status      = statusLabel(stage.key);

        return (
          <div
            key={stage.key}
            title={stage.tooltip}
            id={`pipeline-stage-${stage.key}`}
            className={`pipeline-step ${isActive ? 'active' : ''}`}
            onClick={() => handleClick(stage)}
            style={{
              cursor:  isHuman ? 'default' : 'pointer',
              position: 'relative',
              outline: isBottleneck && !isActive
                ? '1.5px solid var(--accent)'
                : undefined,
              outlineOffset: '-1px',
            }}
          >
            {/* Bottleneck pulse ring */}
            {isBottleneck && !isActive && (
              <span style={{
                position: 'absolute', inset: -2, borderRadius: 'inherit',
                boxShadow: '0 0 0 2px var(--accent)',
                animation: 'pulse 2s ease-in-out infinite',
                pointerEvents: 'none',
              }}/>
            )}

            {/* Stage label row */}
            <div className="pipeline-step-name" style={{ display:'flex', alignItems:'center', gap:5 }}>
              {stage.label}
              {isBottleneck && (
                <span style={{
                  fontSize: 8, padding: '1px 5px', borderRadius: 8,
                  background: 'var(--accent)', color: '#000',
                  fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
                }}>
                  ▶ Next
                </span>
              )}
            </div>

            {/* Count */}
            <div className="pipeline-step-count">
              {isRunning ? (
                <span style={{
                  display:'inline-block', width:16, height:16,
                  border:'2px solid var(--border)', borderTopColor:'var(--green)',
                  borderRadius:'50%', animation:'spin 0.6s linear infinite',
                  verticalAlign:'middle',
                }}/>
              ) : (
                count.toLocaleString()
              )}
            </div>

            {/* Status */}
            <div className="pipeline-step-status" style={{
              color: isRunning   ? 'var(--green)'
                   : isBottleneck ? 'var(--accent)'
                   : status === 'Ready' ? 'var(--green)'
                   : 'var(--text-secondary)',
              display: 'flex', alignItems: 'center', gap: 4,
            }}>
              {isRunning && (
                <span style={{ width:5, height:5, borderRadius:'50%',
                  background:'var(--green)', animation:'pulse 1.5s infinite',
                  display:'inline-block' }}/>
              )}
              {isRunning ? 'Running…' : status}
            </div>

            {/* Click-to-run hint for automatable stages */}
            {!isHuman && !isRunning && (
              <div style={{
                position:'absolute', bottom:4, right:6,
                fontSize:8, color:'var(--text-muted)', opacity: isBottleneck ? 0.9 : 0.4,
                fontFamily:'var(--mono)',
              }}>
                {isBottleneck ? '↑ click to run' : 'click'}
              </div>
            )}

            {/* Arrow connector */}
            {i < STAGES.length - 1 && (
              <div style={{
                position:'absolute', right:-9, top:'50%', transform:'translateY(-50%)',
                zIndex:2, color:'var(--text-muted)', fontSize:10, pointerEvents:'none',
              }}>›</div>
            )}
          </div>
        );
      })}
    </div>
  );
};
