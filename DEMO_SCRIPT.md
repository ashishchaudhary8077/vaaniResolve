# DEMO_SCRIPT.md — 4–5 minute judged demo

## Kit
- Chrome/Edge, mic on, `npm run dev`, open `http://localhost:5173`.
- **RIME_API_KEY set** in `.env` for real Rime audio. No key? A disclosed fallback tone keeps the pipeline audible and identical interruption behaviour — say so honestly.
- Keep the **Developer panel open** (desktop) so latency/interrupt/stale numbers are visible live.

## 0:00–0:30 — Problem
> “Support bots make you wait. The AI calls a slow order API, speaks, and you can’t correct it until it finishes. You repeat context, you hear answers about the wrong order.”

Tap the mic (or enable Continuous listening). Video/audio cues on.

## 0:30–1:15 — Normal voice tracking
Speak: **“Where are my headphones?”**
- Watch `LISTENING → PROCESSING → TOOL_RUNNING → SPEAKING → RESOLVED`.
- Rime answers (order VR-48291, Sony, out for delivery today) and a card appears.
- Follow-up: **“When will it arrive?”** — context continuity (no product repeated).

## 1:15–1:50 — Voice action + confirmation
Speak: **“I want to return my headphones.”**
- Agent proposes; `WAITING_CONFIRMATION` UI + Rime asks “Shall I go ahead?”
- Answer: **“Yes, go ahead.”** → `EXECUTING_ACTION` → return scheduled + refund ETA.
- Then: **“Actually don’t cancel anything.”** — pending action cleared (changed-mind rule).

## 1:50–3:00 — MAIN STRESS TEST (the USP)
Speak: **“Where is my laptop?”**
- `TOOL_RUNNING` — the lookup is deliberately slow (`STRESS_LAPTOP_MS≈4000`).
- After ~1s, interrupt: **“Wait, I mean my blue headphones.”**
- Watch: Rime stops immediately (`USER_INTERRUPT`), generation bumps (Dev panel), laptop tool later returns and the log shows **`STALE_RESULT_DISCARDED`** — never spoken.
- Only the **headphones** answer is spoken; the laptop answer never is.

## 3:00–3:45 — Architecture
Overlay the repo/architecture.svg:
voice → ConversationManager → Agent → Tool Router → Speech Formatter → Rime → audio → user. Interruption path: stop Rime + flush queue → generation++ → validate → stale? discard.

## 3:45–4:30 — Voice shopping (added for the SIH demo)
Speak: **“Find a laptop under ₹70,000.”**
- Product cards slide in (name, INR price, rating, description, **_View details_** button) and Rime reads the shortlist aloud.
- Then: **“Show me headphones under ₹3,000.”** → boAt Rockerz 550 (₹1,749) matches; the price cap is enforced on screen and in speech.
- Tap **View details** on a card — it asks the AI about that exact product (context carries over).

## 4:30–5:00 — Customer care handoff (added)
Tap the **headset button (bottom-right)**.
- A **Customer Care Summary** panel slides in from the right, generated LIVE from this conversation (main problem, summary, details, actions, order/shopping context, status, recommended next step).
- Tap **Connect to Customer Care** → *Connecting* → *Summary transferred* → *In-app call connected* with a live timer. The summary is POSTed to `/api/care/handoff`.
- Open a second tab at **`#/care`** (Representative Desk) — the rep already sees the same summary; no need for the customer to repeat.

## 5:00–5:30 — Evidence
Point at the developer panel + `evaluation/results/*.json`:
- TTFA (T5−T0), tool latency, interrupt count, stale results discarded.
- `npm run test:stress` output (invariant assertions).
- `npm run demo -- all` PASS/FAIL lines.

## 4:30–5:00 — USP
> “VaaniResolve doesn’t just let you talk to support. It lets you **change your mind while the AI is working** — and prevents obsolete information from becoming the answer.”

---

## Alternative: hands-off automated pitch
Run `npm run demo -- all` (CLI evidence, prints real timings + PASS/FAIL) while the UI demo chips play the same script through the live session. Judges see the same numbers the product measured.

## Back-up utterances
- “What’s my refund status?” (refund flow)
- “Tell me about the MacBook Pro” (product info)
- “Where is order VR-77108?” (delayed order)
- “Cancel my laptop order” → “No, don’t.” (confirmation cancel)