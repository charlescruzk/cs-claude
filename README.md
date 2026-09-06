# cs-browser — a Counter-Strike 1.6–style shooter in the browser

A from-scratch, single-page browser FPS inspired by Counter-Strike 1.6. Original code and
original placeholder assets only (primitive geometry, procedural textures). No Valve assets.

This repo is also an **experiment**: the P0 build is meant to be implemented by a local
`qwen3.8:27b-mlx` model running inside the Claude Code CLI harness via Ollama. The docs in
this folder are written to give that model everything it needs to work autonomously.

## Where things are

| File | Purpose |
|------|---------|
| `PROMPT.md` | The kickoff prompt to paste into the local-model Claude Code session |
| `CLAUDE.md` | Standing rules the model must follow while working in this repo |
| `ROADMAP.md` | Big-picture plan: P0 → P1 → P2 → P3 |
| `docs/P0_SPEC.md` | Exact P0 task list with acceptance criteria, in execution order |
| `docs/ARCHITECTURE.md` | Module layout, data flow, coordinate conventions |
| `docs/PROGRESS.md` | Checklist the model updates as it finishes tasks |
| `index.html` | Entry page (importmap for Three.js, loads `src/main.js`) |
| `src/` | Game code, ES modules, no build step |
| `scripts/check.mjs` | Syntax-checks every JS file; the model runs this after each task |

## Tech choices (deliberately boring)

- **Three.js** via CDN importmap, pinned to `0.170.0`. No bundler, no npm install.
- **Vanilla ES modules.** One concern per file, files kept under ~300 lines.
- **Static server only.** `python3 -m http.server` is all you need.
- **No networking in P0.** Single player vs. bots. Multiplayer is P2.

## Quick start (human)

```bash
cd ~/cs-claude
npm run serve          # http://localhost:8080
npm run check          # syntax-check all JS
```

Open http://localhost:8080, click the canvas to lock the pointer.

## Running the local-model experiment

The harness is Claude Code pointed at Ollama's Anthropic-compatible endpoint. Ollama
provides a one-liner for it:

```bash
cd ~/cs-claude
ollama launch claude --model qwen3.8:27b-mlx
```

Equivalent manual launch, if you want to see the wiring:

```bash
cd ~/cs-claude
ANTHROPIC_BASE_URL=http://127.0.0.1:11434 \
ANTHROPIC_AUTH_TOKEN=ollama \
ANTHROPIC_API_KEY= \
ANTHROPIC_DEFAULT_OPUS_MODEL=qwen3.8:27b-mlx \
ANTHROPIC_DEFAULT_SONNET_MODEL=qwen3.8:27b-mlx \
ANTHROPIC_DEFAULT_HAIKU_MODEL=qwen3.8:27b-mlx \
claude --model qwen3.8:27b-mlx
```

Then paste the contents of `PROMPT.md` as the first message. Recommended before you start:

```bash
git init && git add -A && git commit -m "P0 scaffold"
```

That gives you a clean baseline so `git diff` shows exactly what the model produced.

## Evaluating the run

- `docs/PROGRESS.md` shows which P0 tasks the model claims are done.
- `npm run check` must pass at every checkpoint.
- Open the game and walk through the acceptance criteria in `docs/P0_SPEC.md`.
- Note where the model stalled, looped, or hallucinated APIs. That is the data this
  experiment is for.
