# Voice AI Taxi V3 - End-to-End Implementation Plan

Date: 2026-03-04
Owner: Codex + Aegean team
Reference: V3 Final Consensus Architecture

## 1) Objective
Implement V3 consensus architecture end to end with an accuracy-first, cost-controlled, deterministic call flow that supports:
- Booking now / booking later
- Price checks
- Cancellations
- Human handoff
- WhatsApp/SMS post-call messaging
- NQ backend integration as primary
- Onde backend kept as separate maintained line

Primary success condition: wrong-location prevention and reliable dispatch payloads.

## 2) Current-State Assessment (What failed and why)

### Confirmed failure modes in current build
1. `token_budget_exceeded` ends calls mid-flow.
2. Realtime LLM controls too much flow logic, causing question jumping and unstable turn behavior.
3. STT transcript quality is inconsistent for noisy/accented speech.
4. Transcript storage is local (`call-audit.json`) but not wired to NQ Communications Calls storage.
5. Cost spikes due to full realtime model loop and repeated response truncation cycles.

### Root causes
- Architecture mismatch: implementation is effectively end-to-end realtime LLM voice loop (the V3 document rejects this as primary design).
- Monolithic runtime (`server.js`) couples telephony, NLU, dialogue, resolver, pricing, and dispatch; hard to enforce deterministic policies.
- No calibrated confidence policy by language/region.
- No dedicated adapter boundary for NQ vs Onde dispatch and transcript sinks.

## 3) What we will keep vs replace

### Keep (reuse)
- `data/poi-db.json` (curated POI base) and service area list
- `data/service-types.json` (Onde service mapping)
- Deploy scripts (`scripts/deploy_remote.sh`, `scripts/health_remote.sh`)
- Dashboard framework (`/dashboard/calls`, `/api/dashboard/calls`) as interim QA console
- Existing WhatsApp sender component (move behind adapter)

### Replace / refactor
- Replace realtime LLM-owned dialogue with deterministic FSM orchestrator
- Replace single-path OpenAI realtime STT/TTS loop with provider adapters:
  - STT: streaming provider (Deepgram-like interface)
  - TTS: low-latency provider with cached prompts
  - LLM: selective NLU/repair only
- Replace hardcoded booking logic with backend adapters (NQ primary, Onde optional)
- Replace local-only transcript persistence with pluggable sinks (NQ Communications + local fallback)

## 4) Safe delivery model (no disruption)

## Branch/repo strategy
1. Active repo (NQ track): `st4rkis/aegean-voice`
   - Create integration branch: `feature/v3-fsm-nq`
2. Onde frozen line: `st4rkis/aegean-voice-onde`
   - Keep as stable Onde baseline
   - Cherry-pick only safe shared improvements (non-NQ-specific)

## Runtime isolation
- Keep current production PM2 app running until V3 shadow mode is ready.
- New V3 runtime runs in parallel on separate process/app name and webhook path.
- Cutover only after Go/No-Go gate.

## 5) Target implementation architecture (concrete modules)

Create modular structure under `src/`:

- `src/core/fsm/`
  - deterministic state machine (S0..S9 + dispatch/handoff/end)
  - barge-in and retry counters
- `src/core/session/`
  - call session state, timers, budgets, escalation score
- `src/core/contracts/`
  - canonical slot schema, resolver schema, dispatch payload schema
- `src/adapters/telephony/vonage/`
  - inbound answer/event/ws media bridge
- `src/adapters/stt/`
  - streaming STT adapter + confidence normalization
- `src/adapters/tts/`
  - provider adapter + prompt cache + speed factor
- `src/adapters/nlu/`
  - Tier-1 repair/extraction client
  - Tier-2 escalation summarizer
- `src/services/location-resolver/`
  - L1 gazetteer + alias/phonetic/fuzzy
  - L2 geo-bounded external resolver
  - L3 LLM candidate selection only
  - L4 spelling mode
  - L5 async pin-drop trigger
- `src/services/pricing/`
  - deterministic fare estimate engine
- `src/adapters/dispatch/`
  - `nq.ts` (primary)
  - `onde.ts` (compatibility line)
- `src/adapters/transcripts/`
  - `nq-communications.ts` (primary sink)
  - `local-audit.ts` (fallback)
- `src/observability/`
  - metrics + traces + structured event logs
- `src/api/`
  - health, dashboard, review endpoints

## 6) Execution phases and gates

## Phase 0 - Production safety freeze (Day 0-1)
Deliverables:
- Snapshot tag + backup verification
- Remove secret leaks from logs and env dump paths
- Cap current production risk:
  - temporary cost and call duration alerting
  - fail-safe handoff instead of silent drops

Exit gate:
- Current service stable enough for controlled testing while rewrite proceeds.

## Phase 1 - Core refactor scaffold (Day 1-3)
Deliverables:
- Introduce `src/` modular runtime while preserving existing endpoints.
- Move existing call state and resolver/pricing logic from monolith into modules.
- Add configuration profiles:
  - `BACKEND_MODE=nq|onde`
  - `VOICE_STACK_MODE=legacy|v3`

Exit gate:
- App boots in both legacy and v3 mode behind feature flag.

## Phase 2 - Deterministic FSM (Day 3-6)
Deliverables:
- Implement exact V3 states (ring, returning-safe check, greet, pickup, dropoff, when, pax, contact, confirm, dispatch, cancel, fare-est, handoff).
- Enforce one-question-at-a-time policy and multi-slot extraction.
- Implement retry limits and hangup policy from V3.

Exit gate:
- Deterministic simulation tests pass across 50+ scripted call paths.

## Phase 3 - STT/TTS + selective LLM routing (Day 5-8)
Deliverables:
- Streaming STT adapter with confidence bands.
- TTS adapter with prompt cache and speed control.
- LLM only for:
  - low-confidence slot repair
  - candidate ranking from supplied options
  - pre-handoff summary
- Remove LLM authority over call transitions.

Exit gate:
- p95 turn latency and token usage hit pilot targets in staging.

## Phase 4 - Location resolver V3 pipeline (Day 6-9)
Deliverables:
- Gazetteer-primary resolver with island bound hard constraints.
- Places fallback (geo-bounded), explicit confirm mandatory.
- Spelling/NATO fallback and async pin-drop flow.
- Weekly gap report generation for operations curation.

Exit gate:
- Resolver regression tests pass; no cross-island false match in test suite.

## Phase 5 - Backend adapters (NQ primary, Onde secondary) (Day 8-11)
Deliverables:
- Implement `dispatch/nq.ts` with strict datetime and idempotency.
- Implement transcript sink to NQ Communications Calls.
- Keep Onde adapter compatibility in separate repo line.

Exit gate:
- Real booking and cancellation visible in NQ dashboard with matching payload and transcripts.

## Phase 6 - Observability + dashboard + QA (Day 10-12)
Deliverables:
- Structured traces and metrics (completion, wrong-location proxy, handoff, cost, latency, resolver layer distribution).
- Dashboard detail view: raw transcript vs normalized slots + confidence + layer.
- Review workflow for failed/handoff calls.

Exit gate:
- QA can diagnose any failed call in under 2 minutes from logs/dashboard.

## Phase 7 - Shadow and supervised rollout (Day 12+)
Deliverables:
- Shadow mode against live calls with human dispatch comparison.
- Calibration pass #1 for confidence thresholds.
- Controlled traffic ramp and go/no-go gates.

Exit gate:
- Meets V3 go/no-go thresholds before full cutover.

## 7) Testing strategy (must-pass)

1. Unit tests:
- FSM transitions
- confidence band decisions
- escalation score model
- resolver layer selection

2. Integration tests:
- telephony -> STT -> FSM -> resolver -> pricing -> dispatch -> transcript sink
- idempotent dispatch retries

3. Red-team matrix automation:
- heavy accents
- noisy background
- code-switching
- intoxicated speech patterns
- ambiguous POIs
- self-corrections

4. Live UAT scripts:
- 20 scripted calls per priority island
- price-check-only and booking-later flows
- cancellation with callback verification

## 8) Data & contract changes

Required new persistent tables/collections (NQ side)
- `voice_calls`
- `voice_call_turns`
- `voice_call_slots`
- `voice_dispatch_attempts`
- `voice_review_labels`

Each call stores:
- raw transcript timeline
- interpreted slot values and confidence
- resolver layer and selected candidate
- dispatch payload + response
- cost and latency breakdown

## 9) Operational controls

- Feature flags:
  - `VOICE_STACK_MODE`
  - `ENABLE_LLM_REPAIR`
  - `ENABLE_PIN_DROP`
  - `ENABLE_AUTO_DISPATCH`
- Circuit breakers:
  - external resolver timeout fallback
  - dispatch adapter failover to human handoff
- Cost guards:
  - soft and hard call cost caps per V3

## 10) Security and compliance actions

- Move secrets to managed secret store (no plaintext env in logs).
- Stop printing config that could expose credentials.
- Add PII redaction for logs and dashboard exports.
- Enforce basic auth / SSO for dashboard and API access.
- Retention policy for transcripts and audio.

## 11) Milestone outputs for you (what you will see)

At each phase completion, I will provide:
1. Deployed endpoint + health
2. Test evidence (logs + sample call IDs)
3. Diff summary
4. Go/No-Go recommendation

## 12) Immediate next execution sequence

1. Create and push branch `feature/v3-fsm-nq`
2. Scaffold `src/` modules and feature flags while preserving current service
3. Implement deterministic FSM + resolver pipeline first
4. Integrate NQ dispatch + Communications transcript sink
5. Run supervised live test with you watching NQ dashboard

