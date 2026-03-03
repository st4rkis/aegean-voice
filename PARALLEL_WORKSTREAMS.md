# Parallel Workstreams (Safe Mode)

This project now has two isolated tracks:

1. `st4rkis/aegean-voice` (current active project)
   - Local path: `/Users/akis/Desktop/Aegean Voice`
   - Remote deploy target: `ubuntu@18.199.49.37:/home/ubuntu/aegean-voice-gateway`
   - PM2 app: `aegean-voice-gateway`

2. `st4rkis/aegean-voice-onde` (frozen Onde line)
   - Local path: `/Users/akis/Desktop/Aegean Voice Onde`
   - Keep this as the Onde-compatible baseline.

## Rules to avoid conflicts

- Never run deploy commands from the wrong folder.
- Always verify folder before work:
  - `pwd`
  - `git remote -v`
- Use feature branches per task, then PR/merge.
- Keep `.env` and `scripts/deploy.env` local only (not committed).

## Recommended branch naming

- `feature/nq-backend-*` for NQ migration tasks
- `feature/voice-quality-*` for conversational quality
- `feature/dashboard-*` for dashboard/analytics
- `fix/prod-*` for urgent production fixes

## Deployment guardrails

- Production deploy command (from current active folder only):
  - `cd "/Users/akis/Desktop/Aegean Voice"`
  - `AUTO_YES=1 npm run deploy:remote`
- Health check:
  - `npm run health:remote`

## Snapshot tag

- Baseline tag saved in both repos:
  - `snapshot-pre-nq-split-20260303`
