-- Sprint D2: desktop mode schedules by elapsed time (not wall-clock cron),
-- so it needs each job's last-run timestamp to survive app restarts.
CREATE TABLE IF NOT EXISTS job_runs (
  job         TEXT PRIMARY KEY,
  last_run_at TIMESTAMPTZ NOT NULL,
  last_status TEXT NOT NULL CHECK (last_status IN ('ok','failed')),
  last_error  TEXT
);
