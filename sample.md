# <img src="assets/icons/logo.svg" width="34" height="34" valign="middle" alt=""> CorpusForge

Plug-and-play corpus pipeline combining **DR-DCI** (Direct Corpus Interaction + TurboQuant pull) for citation-backed LLM context.

**Pure Rust** — native [turbovec](https://github.com/RyanCodrai/turbovec) / TurboQuant, [fastembed](https://github.com/Anush008/fastembed-rs) embeddings, axum API. Built for scale.

Drop files in a corpus directory, run `corpusforge init`, then query with verifiable `[N]` citations.

**Ready-to-run curls:** [benchmarks/sample_curls.md](benchmarks/sample_curls.md) — copy-paste Azure + API examples.  
**Full reference:** [FEATURE.md](FEATURE.md) — CLI vs HTTP, all output formats, workflows.  
**Integrate into your app:** [integration.md](integration.md) — release binary only (no source vendoring), CLI vs API server, Docker, code samples.

## Quick start

```bash
# First build downloads ONNX Runtime via ort-sys (~150MB). Can take 10-30 min with no output.
# Use -v to see download progress:
cargo build --release --features local-embeddings -v

./target/release/corpusforge init ./corpus
./target/release/corpusforge query "your question"                    # TOON (default)
./target/release/corpusforge query "your question" --format json
./target/release/corpusforge serve --port 8080
```

### CLI alias & dependencies

- **Shorthand:** `cargo build --release` produces both `corpusforge` and `cpf` — same commands, either name works (`cpf query …`, `cpf serve …`). After `cargo install --path .`, both land in `~/.cargo/bin`.
- **Ripgrep (`rg`):** DCI lexical search needs `rg`. CorpusForge looks on PATH first, then auto-downloads a release binary into `.corpusforge/bin/rg` on first use (macOS/Linux). Override with `CORPUSFORGE_RG=/path/to/rg` or install system-wide: `brew install ripgrep`.

## Build options

| Command | When to use |
|---------|-------------|
| `cargo build --release --features local-embeddings` | Default — bundles ONNX Runtime (slow first build) |
| `cargo build --release --features dynamic-ort` | Faster build if ONNX is installed: `brew install onnxruntime` |
| `cargo build --release -v` | Verbose — shows ort-sys download progress |

### Stuck on `ort-sys`?

This is almost always **downloading** the ONNX Runtime binary, not compiling Rust. It can sit silent for a long time.

1. Rebuild with verbose output: `cargo build --release --features local-embeddings -v`
2. Watch `target/` grow: `du -sh target` (should increase by ~150MB+)
3. **Faster path:** install system ONNX and use dynamic linking:
   ```bash
   brew install onnxruntime
   cargo build --release --features dynamic-ort
   ```

## Architecture

- **Ingest** — MD, HTML, PDF, DOCX, CSV/TSV, Excel (xlsx/xls/xlsm/xlsb), TXT, JSON, code → grep-friendly workspace
- **TurboQuant index** — in-process `turbovec::IdMapIndex` semantic `pull(query, k)`
- **DCI toolkit** — sandboxed `rg`, `grep`, `find`, `sed`, `head`, `tail`, composable pipelines (`rg` auto-installed to `.corpusforge/bin/` if missing)
- **Export** — citation-backed context packs in **TOON** (default), JSON, LLM messages, or plain prompt

See [docs/PLAN.md](docs/PLAN.md) for the full design.

## Workspaces

CorpusForge supports **multiple named workspaces** — separate corpora, each with its own index, SQLite chunk store, and DCI grep workspace. Query one workspace, or combine several in a single retrieval with globally ranked `[N]` citations.

Citations label the source workspace: `flood/flood-guidance.md`, `legal/contract.pdf`, etc.

### Storage layout

| Path | Purpose |
|------|---------|
| `.corpusforge/workspaces.toml` | Registry of workspace names → corpus directories |
| `.corpusforge/workspaces/<name>/` | Per-workspace index, DB, and DCI workspace |
| `.corpusforge/workspaces/<name>/index.tvim` | TurboQuant vector index |
| `.corpusforge/workspaces/<name>/chunks.db` | Document + chunk metadata |
| `.corpusforge/workspaces/<name>/workspace/` | Normalized text files for DCI tools |

**Legacy:** if you indexed before workspaces existed, the flat `.corpusforge/` directory is still used as the `default` workspace until you re-init into `.corpusforge/workspaces/default/`.

### Register and manage workspaces

```bash
# Register a workspace and index it immediately
corpusforge workspace add flood --corpus ./corpus/flood --init

# Register without indexing (index later)
corpusforge workspace add legal --corpus ./corpus/legal
corpusforge workspace init legal

# Optional description
corpusforge workspace add hr --corpus ./corpus/hr --description "HR policies"

# List all workspaces (* = default)
corpusforge workspace list

# Show paths and index status
corpusforge workspace show flood

# Change which workspace is used when -w is omitted
corpusforge workspace set-default legal

# Remove from registry (add --keep-data to leave indexed files on disk)
corpusforge workspace remove hr
```

### Query one or many workspaces

```bash
# Single workspace (TOON is the default output format)
corpusforge query "flood zone requirements" -w flood
corpusforge query "flood zone requirements" -w flood --format json
corpusforge query "flood zone requirements" -w flood --format prompt

# Multiple workspaces — hits merged and ranked across all of them
corpusforge query "tenant obligations" -w flood -w legal --format toon

# Omit -w to query the default workspace
corpusforge query "your question"
```

### Init, watch, and bench per workspace

```bash
# Index (or re-index) a workspace
corpusforge init ./corpus/flood              # default workspace
corpusforge init -w flood ./corpus/flood     # named workspace
corpusforge workspace init flood             # re-index from registered corpus path

# Watch for file changes and auto re-index
corpusforge watch                            # default workspace
corpusforge watch -w legal                   # named workspace
corpusforge watch -w legal ./corpus/legal    # override corpus path while watching

# Recall benchmark against a specific workspace
corpusforge bench --fixture benchmarks/recall.json
corpusforge bench -w flood --fixture benchmarks/recall.json
```

### One document per workspace

To treat documents as independent query targets, give each its own folder and workspace:

```bash
corpusforge workspace add contract-a --corpus ./docs/contract-a --init
corpusforge workspace add contract-b --corpus ./docs/contract-b --init

# Query only the docs you need
corpusforge query "termination clause" -w contract-a --format prompt
corpusforge query "compare obligations" -w contract-a -w contract-b --format prompt
```

Workspace names must be alphanumeric, hyphen, or underscore (`flood-zone`, `legal_2024`).

### Supported document formats

| Type | Extensions |
|------|------------|
| Markdown | `.md`, `.markdown` |
| HTML | `.html`, `.htm` |
| PDF | `.pdf` (native + `pdftotext` fallback) |
| Word | `.docx` |
| Spreadsheet | `.xlsx`, `.xls`, `.xlsm`, `.xlsb` |
| CSV / TSV | `.csv`, `.tsv` |
| Plain text / code | `.txt`, `.json`, `.jsonl`, `.rs`, `.py`, `.ts`, `.js`, … |

List at runtime: `GET /v1/formats` — see [FEATURE.md → Other endpoints](FEATURE.md#h-other-endpoints).

### HTTP API

Production-oriented API with structured JSON errors, CORS, compression, request timeouts, optional API-key auth, and workspace management.

**Start the server:**

```bash
corpusforge serve --port 8080
corpusforge serve --host 127.0.0.1 --port 8080
```

**Config** (`config.toml` → `[api]`):

```toml
[api]
host = "0.0.0.0"
cors_origins = ["*"]
# api_key_env = "CORPUSFORGE_API_KEY"  # require X-API-Key header
request_timeout_sec = 120
max_body_bytes = 1048576
```

When `api_key_env` is set, all `/v1/*` routes require header `X-API-Key: <value from env>`.

**Health & readiness**

| Endpoint | Purpose |
|----------|---------|
| `GET /health` | Liveness — always `{"status":"ok"}` |
| `GET /ready` | Readiness — `200` if any workspace is indexed, else `503` |

**Formats**

```
GET /v1/formats
```

**Workspaces**

```
GET    /v1/workspaces
POST   /v1/workspaces          { "name": "python", "corpus": "./corpus/python", "init": true }
GET    /v1/workspaces/{name}
DELETE /v1/workspaces/{name}
POST   /v1/workspaces/{name}/index     # re-index from registered corpus
GET    /v1/workspaces/{name}/documents
```

**Retrieve** — citation-backed context pack

```http
POST /v1/retrieve
Content-Type: application/json

{
  "query": "how do for loops work in Python",
  "workspaces": ["python"],
  "top_k": 5,
  "max_tokens": 1200,
  "format": "toon"
}
```

**Response format** — set `"format"` in the JSON body (default: `"toon"`), or override with query param `?format=json`. **Important:** TOON is best for lookup/extraction; use `llm` for reasoning and narrative Q&A — see [FEATURE.md → TOON vs LLM](FEATURE.md#toon-vs-llm).

| `format` | Content-Type | Use |
|----------|--------------|-----|
| `toon` | `text/toon` | Default — lookup / extraction (“what does the doc say?”) |
| `json` | `application/json` | Full context pack (all fields) |
| `llm` | `application/json` | Reasoning / ratings / narrative Q&A (`system` + `user`) |
| `prompt` | `text/plain` | Flat citation + question text |

```bash
# TOON (default — omit format field)
curl -s http://localhost:8080/v1/retrieve \
  -H 'Content-Type: application/json' \
  -d '{"query":"your question","workspaces":["python"]}'

# Full JSON via body or query param
curl -s 'http://localhost:8080/v1/retrieve?format=json' \
  -H 'Content-Type: application/json' \
  -d '{"query":"your question","workspaces":["python"]}'
```

**Batch lookup** — parallel retrieval for a list of topics (e.g. from `Python Programming.pdf`):

```http
POST /v1/lookup
Content-Type: application/json

{
  "descriptions": ["For Loops", "While Loops", "Exceptions Handling"],
  "workspaces": ["python"],
  "search_prefix": "Python programming topic for {}",
  "instructions": "Optional domain-specific LLM task (omit for generic JSON array output).",
  "format": "llm",
  "top_k": 5,
  "max_tokens_per_item": 400
}
```

See `benchmarks/python-lookup-sample.json` for a full example. CLI: `corpusforge lookup --json benchmarks/python-lookup-sample.json -w python --format llm`.

JSON response fields (when `format` is `json`):

| Field | Use |
|-------|-----|
| `context_blocks` | Structured citations + chunk text |
| `llm_messages` | `{ "system", "user" }` — send directly to your LLM API |
| `prompt_ready` | Lean plain-text prompt (same content as `llm_messages.user`) |

Omit `workspaces` (or `[]`) to search the default workspace. Multiple names merge results. Tune `top_k` and `max_tokens` to control response size (defaults can be large).

**LLM-agnostic** — CorpusForge only retrieves and formats cited context. It does not require Azure, OpenAI, or any specific provider. You plug the output into **any** chat API:

| CorpusForge output | Your app sends it to |
|--------------------|----------------------|
| `format: llm` → `{system, user}` | Any chat API with system + user messages (OpenAI, Azure, Claude, Gemini, Ollama, …) |
| `format: toon` or `prompt` | Any model — wrap the text in that provider’s message format |
| `format: json` | Your app parses fields and builds the request |

Azure curls in [FEATURE.md](FEATURE.md) are **examples** of wiring retrieve → chat completions. The same `llm` payload works everywhere; only the endpoint, headers, and request JSON shape change per provider.

**Ask** (optional) — retrieve + call an OpenAI-compatible API in one step. Requires `[llm]` in `config.toml`. Most projects skip this and call their own LLM after `/v1/retrieve`.

```http
POST /v1/ask
Content-Type: application/json

{
  "query": "What are the key requirements?",
  "workspaces": ["python"],
  "model": "gpt-4o-mini",
  "top_k": 5,
  "max_tokens": 1200
}
```

**Error responses** (4xx/5xx):

```json
{ "error": { "code": "bad_request", "message": "query must not be empty" } }
```

**Example curls:** [benchmarks/sample_curls.md](benchmarks/sample_curls.md) (copy-paste) · [FEATURE.md](FEATURE.md) (full reference)

**Production checklist**

- Run `corpusforge watch -w <name>` alongside `serve` for live re-indexing
- Set `api_key_env` in production
- Use `GET /ready` for load-balancer health checks
- Gitignore `.corpusforge/` — indexes are local artifacts

### CLI reference

| Command | Description |
|---------|-------------|
| `init [CORPUS] [-w NAME]` | Ingest and index a corpus |
| `query QUERY [-w NAME]... [--format toon\|json\|llm\|prompt]` | Retrieve cited context (default: `toon`) |
| `serve [--host HOST] [--port 8080]` | Start production HTTP API |
| `watch [-w NAME] [CORPUS] [--debounce-ms 500]` | Auto re-index on file changes |
| `bench [--fixture PATH] [-w NAME]` | Run recall regression fixture |
| `workspace add NAME --corpus PATH [--init]` | Register a workspace |
| `workspace list` | List registered workspaces |
| `workspace show NAME` | Show workspace details |
| `workspace init NAME [CORPUS]` | Re-index a workspace |
| `workspace remove NAME [--keep-data]` | Remove a workspace |
| `workspace set-default NAME` | Set default workspace |

## Indexing & watch

CorpusForge has two indexing modes: **one-shot** (`init`) and **continuous** (`watch`).

| Command | When to use |
|---------|-------------|
| `init` | First-time index, or manual re-index after bulk changes |
| `watch` | Dev / active editing — keeps the index fresh while files change |

### How `watch` works

`corpusforge watch` is a **long-running process** you start yourself. It does not run in the background unless you keep it running (terminal, `tmux`, systemd, Docker sidecar, etc.).

```
You edit / add / delete files in corpus/
        ↓
OS file events (notify, recursive)
        ↓
Debounce 500ms (default; change with --debounce-ms)
        ↓
Full re-index: init_corpus() for that workspace
        ↓
Index + SQLite + DCI workspace rebuilt
```

| Aspect | Behavior today |
|--------|----------------|
| **Trigger** | Any create, modify, or delete under the corpus directory |
| **Debounce** | Waits 500ms after the last event before re-indexing (avoids 10 rebuilds while you save) |
| **Re-index type** | **Full rebuild** — not incremental per file yet (incremental index is on the roadmap) |
| **Workspace** | Scoped with `-w`: `corpusforge watch -w legal` watches that workspace's registered corpus path |
| **First run** | Run `init` (or `workspace add --init`) once before `watch` is useful |

### Typical dev workflow

```bash
# Once — register and index
corpusforge workspace add docs --corpus ./corpus --init

# Leave running while you edit files
corpusforge watch -w docs

# In another terminal — queries always hit the latest index
corpusforge query "Python variables and assignment" -w docs
```

### Watch + API together

```bash
corpusforge watch -w docs &          # background re-index
corpusforge serve --port 8080        # your app calls /v1/retrieve
```

Run one `watch` process per workspace (each watches a single corpus directory).

### Adding new files (e.g. a PDF)

```bash
# Drop Python Programming.pdf into corpus/python/, then:
corpusforge workspace init python
# — or, if watch is already running, just save the file and wait ~500ms
corpusforge query "Python functions overview" -w python
```

## Integrating into your project

CorpusForge is a **binary sidecar**, not a library you import. Consumer projects use the **prebuilt binary** from [GitHub Releases](https://github.com/moodysanalytics/CorpusForge/releases) (or a binary your maintainer provides) — not the source repo. Run `corpusforge serve` or shell out to the CLI; your app retrieves cited context and calls **your own LLM**.

**Full guide:** [integration.md](integration.md) — releases-only distribution, project layouts, CLI subprocess vs HTTP API, Docker, Python/TypeScript examples, deploy checklist.

## Roadmap

| Phase | Scope | Status |
|-------|--------|--------|
| **0 — Bootstrap** | Rust crate, config, CLI skeleton | Done |
| **1 — Ingest + index** | Auto-detect formats, chunk, embed, TurboQuant `IdMapIndex`, `init` | Done |
| **1b — Watch** | Debounced re-index on corpus file changes | Done |
| **1c — Workspaces** | Named corpora, multi-workspace query (`-w`) | Done |
| **2 — DR-DCI retrieve** | Semantic `pull`, DCI recipes (`rg`/`grep`/…), `[N]` citations | Done |
| **3 — HTTP API** | Workspaces CRUD, `/ready`, structured errors, CORS, auth, compression | Done |
| **3b — Benchmarks** | `bench` recall fixtures for regression checks | Done |
| **4 — Accuracy + scale** | Incremental per-file re-index (watch today does full rebuild), bit-width tuning, streaming, Anthropic | Planned |
| **5 — Optional sidecars** | Docling PDF pipeline, OpenAI embedding provider | Planned |

## Configuration

`config.toml` at the repo root controls shared settings (embedder, chunking, retrieve limits, API server). Corpus paths for workspaces live in `.corpusforge/workspaces.toml`.

| Section | Required | Purpose |
|---------|----------|---------|
| `[embedder]`, `[index]`, `[chunking]`, `[retrieve]` | Yes | Ingest and retrieval |
| `[api]` | No (defaults) | HTTP server host, CORS, auth |
| `[cleanup]` | No | Per-project line filters for PDF boilerplate |
| `[llm]` | No | Only if using `POST /v1/ask` — your app’s LLM keys stay in **your** project |

When using CorpusForge from another repo, copy `config.toml` there (or pass `-c /path/to/config.toml`). The alias/binary is global; config and `.corpusforge/` data are per project.

## License

MIT
