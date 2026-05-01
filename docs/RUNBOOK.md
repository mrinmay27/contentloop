# Runbook

## Daily Operator Flow

1. Open the dashboard at `http://localhost:5173`.
2. Run `Ingest`.
3. Run `Score`.
4. Run `Generate`.
5. Review every item in `Approval Queue`.
6. Approve only content that is specific, useful, and brand-safe.
7. Click `Schedule Approved`.
8. Check `Scheduled Posts`.

The worker also registers repeatable jobs for daily ingestion, scoring, generation, scheduling checks, dry-run posting, and analysis.

## Quality Rules

Reject or regenerate when:

- hook is vague or too long
- content uses generic phrases like "game changer"
- no CTA exists
- carousel is not exactly 8 slides
- topic feels repetitive against recent posts

## Going Live

Before disabling dry-run mode:

- review Instagram and YouTube API policy requirements
- add credential storage outside source control
- implement media upload/rendering for the specific brand template
- add rate-limit monitoring
- test on one low-risk page for 48 hours

Set:

```bash
POSTING_DRY_RUN=false
```

Only after platform credentials and posting adapters are complete.
