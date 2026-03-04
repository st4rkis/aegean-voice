# Provider Setup (Deepgram + ElevenLabs + NQ)

This file lists exactly what to create and where each key goes for the V3 migration.

## 1) Deepgram (STT)

1. Create account: https://console.deepgram.com/
2. Create a new API key with speech-to-text access.
3. Save key in `.env`:
   - `DEEPGRAM_API_KEY=...`
   - `DEEPGRAM_MODEL=nova-2`
4. Recommended Deepgram settings for call center:
   - Model: `nova-2`
   - Language: auto-detect or lock to expected caller language when known
   - Smart formatting: enabled
   - Punctuation: enabled
   - Endpointing: enabled (fast turn detection)
   - Profanity filtering: disabled for operations logs (handle in policy layer)

## 2) ElevenLabs (TTS)

1. Create account: https://elevenlabs.io/
2. Create API key.
3. Create/select a production voice and copy `voice_id`.
4. Save in `.env`:
   - `ELEVENLABS_API_KEY=...`
   - `ELEVENLABS_VOICE_ID=...`
   - `ELEVENLABS_MODEL_ID=eleven_turbo_v2_5`
5. Recommended TTS settings:
   - Stability: medium
   - Similarity boost: medium-high
   - Speaking style: neutral professional
   - Output sample rate: 16k or 24k PCM depending on bridge path

## 3) NQ Backend (when `BACKEND_MODE=nq`)

Store these in `.env`:

- `NQ_BASE_URL=https://<your-nq-api-host>`
- `NQ_SERVICE_TOKEN=<service token with orders/dispatch scopes>`
- `NQ_CALL_NUMBER_ID=<bound call channel number_id>`
- `NQ_COMPANY_ID=<tenant/company id>` (optional if resolvable from number_id)
- `NQ_COMPANY_CODE=<tenant code>` (optional)
- `NQ_TRANSCRIPT_ENABLED=true`
- Optional for quote endpoint:
  - `NQ_PUBLIC_CLIENT_ID=...`
  - `NQ_PUBLIC_CLIENT_SECRET=...`

## 4) Runtime Mode

- Keep current stable mode:
  - `BACKEND_MODE=onde`
- Switch to NQ:
  - `BACKEND_MODE=nq`

## 5) Health Check

After deploy:

`curl -s http://localhost:3000/health`

Verify:

- `integrations.backendMode`
- `integrations.nqConfigured`
- `integrations.nqTranscriptEnabled`
- `integrations.nqCallNumberIdConfigured` (if using call-channel order endpoint)
