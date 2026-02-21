# Aegean Voice Collaboration Guide

## 1) Branching rules
- Never commit directly to `main`.
- Create one branch per task:
  - `codex/<your-name>-<short-task>`
  - Example: `codex/akis-dashboard-filters`

## 2) Daily workflow
1. Pull latest `main`
2. Create/update your task branch
3. Make small commits with clear messages
4. Push branch
5. Open Pull Request into `main`
6. Teammate reviews and merges

## 3) Conflict avoidance
- Do not both edit the same file at the same time.
- Split tasks by file/module where possible.
- Pull before starting and before pushing.

## 4) Secrets policy (critical)
- Never commit `.env`, keys, tokens, PEM files.
- Keep local secrets in `.env`.
- Keep shared variable names in `.env.example` only.

## 5) Codex coordination
- One Codex thread per task.
- Add task status in `TASKS.md` before/after working.
- Include affected files in your PR description.

## 6) Commit message style
- `feat: ...` new feature
- `fix: ...` bug fix
- `chore: ...` maintenance
- `docs: ...` documentation
