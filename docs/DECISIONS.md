# Decisions

One decision per line; dates use ISO format.

| Date | Decision and rationale |
|---|---|
| 2026-08-01 | Pin portable Node 24.18.1 LTS rather than Node 20 because the backend uses stable built-in `node:sqlite`, avoiding fragile native addons on every target platform. The patch pin includes the July 29, 2026 security fixes, including CVE-2026-58041 in `node:sqlite`. |
| 2026-08-01 | Use `node:sqlite` plus pure-JS application dependencies; the offline target therefore needs no compiler, Python, `node-gyp`, or ABI-specific npm rebuild. |
| 2026-08-01 | Pin llama.cpp `b8933` for all platforms rather than a moving latest release so one reviewed OpenAI-compatible behavior and exact upstream digests ship together. |
| 2026-08-01 | Use the CPU x64 llama.cpp build on Windows for the widest Windows 10/11 x64 compatibility; macOS builds use Metal layers when available. |
| 2026-08-01 | Pin Bartowski's Q4_K_M GGUF conversion at immutable Hugging Face revision `61fd4167fff3ab01ee1cfe0da183fa27a944db48`; it is derived from Apache-2.0 Mistral 7B Instruct v0.3 and has a published file SHA-256. |
| 2026-08-01 | Keep downloaded archives under `runtime/payload`, `llm/payload`, and `llm/models` in the release, while unpacking install state only under `.runtime`; teardown can then preserve everything needed for an offline rebuild. |
| 2026-08-01 | Make the release folder canonical and the ZIP a transport copy; this avoids depending on ZIP support for day-to-day rebuilds and makes USB inspection straightforward. |
| 2026-08-01 | Normalize Unix modes in the ZIP central directory after packaging so `.command`/`.sh` launchers remain executable on macOS even when the release ZIP was produced on Windows. |
| 2026-08-01 | Emit a transport-level SHA-256 for the ZIP outside it and retain a per-file checksum manifest inside it, separating USB transfer verification from target build verification. |
| 2026-08-01 | Generate `checksums.txt` over every immutable release file and verify the set in both directions before unpacking; mutable paths (`data`, `exports`, `.runtime`, `node_modules`, `.cache`, `config/app.local.json`) are excluded, while unlisted immutable files are rejected. |
| 2026-08-01 | Fail closed unless the selected GGUF is both checksum-manifested and a pinned `kind=model` destination; an operator must pass `--allow-unverified-model` on every exceptional launch, accept a loud warning, and supply the organizational OS sandbox that portable Aurora cannot provide. |
| 2026-08-01 | Populate npm's content-addressed cache from every HTTPS `resolved` URL in `package-lock.json`, then prove an `npm ci --offline` before packaging, covering platform-specific optional packages without target-side network. |
| 2026-08-01 | Run production dependency installation with `--ignore-scripts` on the offline target because runtime dependencies are pure JS/built-in; the online release check remains responsible for build-time scripts. |
| 2026-08-01 | Bind both processes to literal `127.0.0.1`; no configuration key or CLI flag can widen the address, and port conflicts roll upward on loopback only. |
| 2026-08-01 | Supervise app and llama processes from one bundled Node process, with capped exponential llama restart backoff; the manual application remains available while the model loads or restarts. |
| 2026-08-01 | Treat a successful grammar-constrained completion and an MGRS round trip as mandatory build self-tests; missing model/binary is a precise packaging error, never reported as a successful non-AI build. |
| 2026-08-01 | Abort teardown before any deletion if either final XLSX or CSV export fails or is empty; `--no-export` is the only unguarded opt-out and total export deletion requires typing `RADERA AURORA`. |
| 2026-08-01 | Use Swedish as default UI/AI output language while retaining the Swedish system persona verbatim in both language modes so domain rules do not drift between translations. |
| 2026-08-01 | Store hot-editable knowledge as Swedish Markdown with small YAML metadata blocks; selection uses metadata/content keywords and always includes intelligence-method basics within an approximate 1,500-token budget. |
| 2026-08-01 | Keep threat-context content at detection and assessment level, explicitly test alternative explanations, and prohibit nationality, ethnicity, religion, or political view as stand-alone indicators. |
| 2026-08-01 | Bundle an actual clipped Natural Earth v5.1.2 1:10m public-domain extract with recorded source digests and a reproducible standard-library processor; 0.004-degree simplification keeps the no-tile canvas map practical while preserving required regional detail. |
| 2026-08-01 | Bundle Latin WOFF2 subsets for the requested OFL families; IBM Plex Sans uses one variable WOFF2 binary under the Regular and Medium filenames so both stable asset paths render their requested weights. |
| 2026-08-01 | Use UTC ISO text in storage/export rather than spreadsheet date serials, preventing locale and daylight-saving reinterpretation during round trips. |
| 2026-08-01 | Use UTF-8 BOM and semicolon as the default CSV dialect for Swedish Excel, with quoted compact JSON arrays in cells. |
| 2026-08-01 | Treat the checked-in repository as source, not as a release: no placeholder runtime, llama binary, model, checksum manifest, or claim of pull-the-plug readiness is committed; only `prepare_release` can produce that claim after real verification. |
| 2026-08-01 | Never reuse mutable `.runtime` during build: delete it after stopping owned processes, test a fresh extraction from checksum-protected archives under a unique staging directory, and atomically install only the successful candidate so failure is closed rather than rolling back to unverified executables. |
| 2026-08-01 | Authenticate llama inference with an in-memory, per-run 256-bit key passed only through child environments; health remains local/public for readiness, while the key never enters state, logs, or process arguments. |
| 2026-08-01 | Treat PID/state files as untrusted hints: reuse only an owned supervisor command and open only a canonical pathless `http://127.0.0.1:<port>` URL. |
| 2026-08-01 | Decode common JavaScript, percent, HTML, concatenation, and static base64/char-code URL hiding before the offline scan; allow only loopback plus five exact inert W3 DOM namespace identifiers needed by SVG/XML APIs. |
| 2026-08-01 | Separate the inner per-file build manifest from the outer streaming ZIP digest, and optionally sign that final digest with a user-supplied Ed25519 key; adjacent hashes are corruption checks, while organizational authenticity requires an out-of-band trust anchor. |
| 2026-08-01 | Require large-file media and ZIP64-capable tooling because the 4,372,812,000-byte model already exceeds FAT32's maximum individual file size. |
| 2026-08-01 | Ship the complete Apache-2.0 text and exact conversion provenance beside the standalone Mistral GGUF, and fail release preparation when embedded Node/llama archive licenses are missing. |
| 2026-08-01 | Reject linked mutable directories and make PID/state/log writes link-safe so preseeded symlinks, junctions, or hard links cannot redirect build/runtime writes outside the release data tree. |
| 2026-08-01 | Emit a CycloneDX 1.5 SBOM from the exact npm v3 lock and pinned binary/model manifest without network; treat it as inventory, while dated vulnerability advisory review remains an online release activity. |
| 2026-08-01 | Authenticate the local browser with a separate per-run 256-bit token exchanged through a transient private HTML bootstrap for an HttpOnly SameSite cookie, keeping secrets out of printed/launcher/state URLs. |
| 2026-08-01 | Forward a small platform environment allowlist to children, rotate supervisor-owned logs at 10 MiB/five files, and open a llama retry circuit after five exits in two minutes to bound environment injection, disk growth, and crash-loop resource use. |
