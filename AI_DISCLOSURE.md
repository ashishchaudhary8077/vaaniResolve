# AI-Assisted Development Disclosure

VaaniResolve was designed and implemented with substantial assistance from **Claude Code (Anthropic)** operating as the help engineer.

## What Claude did
- Audited the (empty) repository and produced the implementation plan.
- Designed and wrote the most TypeScript monorepo: shared protocol types, conversation state machine, commerce tool registry + synthetic data, agent (Anthropic tool-calling + a disclosed deterministic fallback), Rime streaming TTS client, audio/interrupt controllers, Express+WebSocket server, React+Vite+Tailwind web app, demo/evaluation scripts, tests, and the documentation set.
- Authored the stress test and the architecture with the assistance of author.

## What it is / isn't
- The **deterministic agent** is *not* an LLM — it is a disclosed rule interpreter used so the product remains functional without API keys; it triggers the same real tools. The dev panel states the active agent kind.
- No claim is made that any runtime behaviour is "AI-generated" in the sense of live model inference where none occurs.

## Live AI components
- **LLM agent**: Anthropic Claude via the Messages API with structured tool calling — active when `ANTHROPIC_API_KEY` is set.
- **TTS**: Rime streaming (primary) — active when `RIME_API_KEY` is set.
- **STT**: browser Web Speech API (client-side).

## Why disclosure is part of the product
- Fallback TTS is always visually disclosed ("⚠ Fallback TTS active") and logged with `RIME_UNAVAILABLE`.
- Provider/agent labels are shown in the developer panel on every session.

Author: Ashish (product concept + brief).