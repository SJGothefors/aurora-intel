# Offline packaging and air-gap release procedure

[Documentation home](../INDEX.md) · [Technical documentation](INDEX.md) · [Security](SECURITY.md) · [User documentation](../user/INDEX.md)

Aurora has two deliberately separate stages:

1. `prepare_release` runs once on an internet-connected, trusted build computer. It downloads every pinned binary/model, creates a complete npm cache, builds/tests the frontend, scans licenses and network references, and emits a self-contained release folder plus ZIP.
2. `build` and `start` run on the disconnected target. They use only files inside that release. They never download, compile, run Python, call `node-gyp`, or depend on a preinstalled Node runtime.

The source checkout is **not** an offline release. In particular, this repository does not contain a fake `llama-server`, portable Node archive, or multi-gigabyte model. A missing payload must produce a bilingual error, not degraded "success".

## Three-step release table

| Step | macOS | Windows |
|---|---|---|
| **1. Create/export on the trusted connected computer** | Run `./scripts/prepare_release.sh` | Run `powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare_release.ps1` |
| **2. Copy, unpack and build/package up on the offline computer** | Copy the release ZIP locally, unpack it, then double-click `build.command` | Copy the release ZIP locally, choose **Extract All**, then double-click `build.bat` |
| **3. Start on the offline computer** | Double-click `start.command` | Double-click `start.bat` |

Wait for `OK` after step 2 before starting. The trusted connected computer creates the complete signed/checksummed package; the offline computer never downloads missing parts.

## Pinned payload

`config/versions.lock` is a pipe-delimited, reviewable lock manifest (`id|platform|kind|filename|url|sha256|destination`). Current release inputs are:

| Component | Pin | Platforms / note |
|---|---|---|
| Node.js | 24.18.1 LTS | macOS arm64, macOS x64, Windows x64 portable archives; required for stable built-in `node:sqlite`; includes the July 29, 2026 security fixes. |
| llama.cpp | b8933 | macOS arm64/x64 and Windows CPU x64 archives from the upstream GitHub release. |
| Default model | Mistral-7B-Instruct-v0.3 Q4_K_M | Immutable GGUF revision, Apache-2.0 source model, SHA-256 `1270d22c…e562b6`, 4,372,812,000 bytes. |
| npm packages | exact `package-lock.json` | Every resolved tarball is placed into npm's content-addressed offline cache. |
| SheetJS CE | vendored `vendor/xlsx-0.20.3.tgz` when referenced by the lockfile | Version 0.20.3, Apache-2.0, SHA-256 `8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8`. |

The default GGUF alone is about 4.37 GB. It cannot live in an ordinary Git source ZIP. It is fetched and checksum-verified by `prepare_release`; an alternative distribution may attach the exact file through GitHub Releases or LFS, but the file **must** be present at `llm/models/mistral-7b-instruct-v0.3.Q4_K_M.gguf` in the folder copied to USB. A GitHub "Download source ZIP" is never sufficient.

## Prepare on a trusted online computer

Requirements on the online builder: macOS 13+ (arm64/x64) or Windows 10/11 x64, internet access, enough free disk for the 4.37 GB model, three Node archives, three llama archives, npm cache, staging folder, and ZIP (allow roughly 15–20 GB), plus `curl`/`tar` on macOS or PowerShell/BITS/`tar.exe` on Windows. A preinstalled Node, compiler, or Python is not required; the script first unpacks its pinned portable Node for build tooling.

The model is 4,372,812,000 bytes, already larger than FAT32's single-file limit, and the finished ZIP is larger still. The USB volume must therefore **not** be FAT32. For routine Mac/Windows interchange use an organization-approved exFAT volume (or another approved large-file filesystem readable by both endpoints), and use a ZIP64-capable archiver/extractor. Modern platform tools should be acceptance-tested with the actual package; do not assume a legacy appliance or archive utility supports ZIP64.

macOS:

```sh
./scripts/prepare_release.sh
```

Optional organization-controlled detached signing (the private key is read, never copied into the release):

```sh
./scripts/prepare_release.sh --signing-key /secure/path/aurora-release-ed25519-private.pem
```

Windows PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\prepare_release.ps1
```

PowerShell accepts the same optional `--signing-key C:\secure\...pem`. An encrypted PEM may receive its passphrase through the temporary builder environment variable `AURORA_SIGNING_KEY_PASSPHRASE`; do not place a passphrase in command history.

The script:

1. copies only release-relevant source/config/docs/assets and excludes working data;
2. downloads each lock entry over HTTPS into `.cache/release-artifacts` (a resumable/reusable online build cache);
3. computes SHA-256, verifies that Node/llama binary archives retain an embedded license file, and stops on any missing, placeholder, or mismatched digest;
4. creates `offline/npm-cache` from every HTTPS package-lock resolution;
5. runs `npm ci --offline` in staging to prove the cache is complete;
6. runs `npm run check` when available (build, automated tests, offline URL guard, production-license guard), otherwise the explicit build/offline/license fallbacks;
7. removes staging `node_modules`, since the target reconstructs production modules from the offline store;
8. writes `docs/release/aurora-intel.cdx.json`, a CycloneDX 1.5 inventory derived offline from the exact package lock plus every pinned Node/llama/model lock entry, including hashes, platform, destination, and actual staged size;
9. writes `checksums.txt` covering every immutable release file (including the SBOM) and rejects symlinks/hard links;
10. emits `release/aurora-intel-v<version>-offline/`, the equivalent `.zip`, and an outer `release/checksums.txt` containing the final transport ZIP's streaming SHA-256;
11. when a user-supplied Ed25519 key was requested, re-hashes the unchanged ZIP and emits `.zip.sig.json` plus the derived `.zip.pub.pem` without ever copying the private key.

The ZIP central directory is normalized after creation: directories use mode `0755`, ordinary files `0644`, and Unix launchers/scripts `0755`. This preserves double-clickable macOS `.command` files even when the release was prepared on Windows and later extracted on a Mac.

There are deliberately two checksum levels: the outer `release/checksums.txt` verifies the ZIP during transfer, while the inner release-folder `checksums.txt` is the per-file manifest that offline `build` verifies before changing installed state.

The ZIP is never modified after its outer digest is computed. A checksum shipped beside the package detects accidental corruption but **does not authenticate origin**: an adversary who replaces the ZIP can replace that text file too. Military/controlled distribution therefore requires an organization-owned trust anchor, release process, and detached signature whose public-key fingerprint is confirmed through an independent approved channel. Aurora can create an optional Ed25519-over-SHA256 sidecar with a user-supplied key, but supplies no private key and claims no organizational approval or certification. The emitted public key is convenient input, not trust by itself; compare its SHA-256 fingerprint out of band before verification.

On the trusted release workstation, using an organization-approved verifier or a separately reviewed copy of Aurora's verifier (not code taken from the still-untrusted ZIP), detached verification is:

```text
node scripts/release-signature.mjs verify <archive.zip> <archive.zip.sig.json> <trusted-public-key.pem>
```

The command streams the archive SHA-256, checks the signed digest and archive name, checks the public-key fingerprint in the record, and verifies Ed25519. In a controlled deployment, use the organization's approved signing/verification tooling when policy requires it.

Existing outputs are moved to timestamped `.previous.*` names rather than silently destroyed. Cached artifacts with a wrong hash are quarantined as `.invalid.<timestamp>` and re-downloaded.

The SBOM is an inventory, not a vulnerability verdict. On a connected, controlled review workstation, maintainers should run the pinned npm client's `npm audit` against `package-lock.json`, record the date/advisory result with the release record, and triage findings before approval. `npm audit` is deliberately not run on or promised by the disconnected target because its advisory service requires current network data. A clean audit at one date does not prove absence of future vulnerabilities.

## Release layout

```text
aurora-intel-vX.Y.Z-offline/
  build.command / build.sh / build.bat
  start.command / start.sh / start.bat
  stop.command / stop.sh / stop.bat
  teardown.command / teardown.sh / teardown.bat
  checksums.txt
  runtime/payload/
    node-macos-arm64.tar.gz
    node-macos-x64.tar.gz
    node-windows-x64.zip
  llm/payload/
    llama-macos-arm64.tar.gz
    llama-macos-x64.tar.gz
    llama-windows-x64.zip
  llm/models/
    mistral-7b-instruct-v0.3.Q4_K_M.gguf
  offline/npm-cache/
  server/
  web/dist/
  docs/release/aurora-intel.cdx.json
  assets/  config/  docs/  knowledge/  scripts/  vendor/
```

`runtime/payload`, `llm/payload`, `llm/models`, `offline/npm-cache`, and `web/dist` are immutable rebuild payload. `.runtime`, `node_modules`, `data`, `.cache`, and `config/app.local.json` are target-created state. `exports` contains snapshots that survive normal teardown. Build validates the immutable set exactly; an additional file under an immutable path is a packaging error even if every listed checksum still matches.

## USB transfer and offline target

On the online computer, copy the ZIP (or the complete release folder) to the USB device. Eject safely. On the target, disable networking before testing and copy the release to a normal writable local folder; do not run directly inside the ZIP or from read-only media.

Before extraction, verify the outer SHA-256 against an out-of-band release record and, when supplied, verify the detached signature against the independently trusted public key. Treat a package plus checksum/public key obtained through the same untrusted channel as unauthenticated.

macOS target:

1. Unzip the package.
2. Double-click `build.command`. If Gatekeeper asks, use Finder's normal Open confirmation for this trusted internally produced package; do not disable platform security globally.
3. Wait for `OK`. The first grammar self-test loads a 7B model and can take several minutes.
4. Double-click `start.command`; the browser opens the printed `http://127.0.0.1:<port>` address.

Windows target:

1. Extract All; do not open scripts inside Explorer's compressed-folder view.
2. Double-click `build.bat` and wait for `OK`.
3. Double-click `start.bat`; the browser opens the printed loopback address.

No administrator permission is expected. Endpoint-control policy may still require the organization to approve the signed/internal package; handle that through the normal security process rather than bypassing it.

## What offline `build` proves

Before modifying installed state, build validates every line of `checksums.txt`, rejects absolute/parent/duplicate paths, missing or linked files, and unexpected immutable files, and recomputes SHA-256. It requires all pinned lock destinations and critical launch/config entries. It then selects exactly one platform archive and:

- rejects linked/reparse mutable data/log/export paths before opening them, stops any owned prior processes, refuses runtime links/stale staging state, and removes the mutable prior `.runtime` without executing it;
- unpacks Node and llama.cpp from verified archives to a unique `.runtime.build.*` candidate;
- runs bundled npm with `ci --offline --omit=dev --ignore-scripts`;
- creates `data/mirror`, `data/backups`, `data/logs`, and `exports`;
- applies SQLite migrations and seeds the BAS vocabulary idempotently;
- optionally imports the newest full snapshot with `--restore-latest`;
- verifies MGRS↔WGS84 round-trip using the installed `mgrs` package;
- ignores target `app.local.json` for build, requires the verified default GGUF to be manifest-listed, and starts it on a free loopback port;
- waits for llama health and requires one strict JSON-schema/grammar completion;
- invokes the backend self-test, writes the candidate `install.json`, and atomically renames the successful candidate to `.runtime`.

Failure is explicit and removes the candidate; no partial canonical runtime remains for `start` to execute. Common diagnostics name the missing archive/model/cache, checksum path, or local log. There is no flag in the normal release flow that turns a failed LLM test into a passing build.

## Runtime network boundary

Both listeners receive literal `--host 127.0.0.1`; `bindAddress` is immutable. `start --port 9090 --llm-port 9091` changes ports only. If a requested port is busy, the helper probes `127.0.0.1` and chooses the next free port and prints only the clean address. No wildcard bind is accepted. Each supervisor/build run generates a new 256-bit llama API key in memory and passes it only through child-process environments; it is absent from command lines, state, and logs. Runtime also generates a separate 256-bit application token. A private transient local HTML file passes that token to the browser, which exchanges it for an HttpOnly, SameSite=Strict cookie and immediately redirects to clean `/`; the bootstrap file is removed shortly after launch and neither token is printed.

The built frontend guard scans `.html`, `.js`, `.css`, maps, SVG, JSON, text, and XML. It first decodes common JS/percent/HTML escapes, string concatenation, and static base64/character-code construction, then fails external HTTP(S), WebSocket, and protocol-relative targets. Exact W3 namespace identifiers used by DOM/SVG APIs are the only inert non-loopback exception and longer W3 paths still fail. The backend sets CSP `default-src 'self'`; fonts and map vectors are local. Production code must not contain telemetry, update checks, CDNs, remote tiles, model download paths, or analytics. URLs in `versions.lock` are consumed only by the online preparation script and are not invoked at runtime. See [Security](SECURITY.md) for the threat model.

Recommended pull-the-plug acceptance:

1. Prepare a release online and record the ZIP SHA-256 separately in the release record.
2. Move it to a clean supported target and physically disable Wi-Fi/Ethernet.
3. Run `build`, then `start`; verify intake extraction, status, map, manual edit, export, stop, teardown, offline rebuild, and `build --restore-latest`.
4. Run a local listener check (`netstat`/Resource Monitor) and confirm only `127.0.0.1:<appPort>` and `127.0.0.1:<llmPort>`.
5. Preserve the build logs and exact `checksums.txt` with the test record; logs contain status/error metadata, not full reports at info level.

This document describes the procedure; it does not claim that clean-machine acceptance passed until those platform tests have actually been executed and recorded.

## Start, stop, supervision, and ports

`start` launches a local supervisor that starts both processes, stores PID/state files in `data/logs`, and restarts llama-server with capped exponential backoff if it exits. Five exits within two minutes open a circuit breaker and stop automatic retry until an operator runs stop/start after correcting the model/runtime; `data/logs/llama-status.json` and `supervisor.log` state this explicitly. The app remains available for manual work while LLM status is down/loading. Re-running `start` while its owned supervisor is alive regenerates only a transient authenticated browser bootstrap and reopens the clean URL. Stale PID values are checked against the command path before a signal is sent. Mutable directory and log targets are validated as real local paths before use; preseeded symlink/junction/hard-link log targets are rejected or safely replaced without following them. Supervisor-owned app, llama, and supervisor logs rotate at 10 MiB with five files retained.

`stop` terminates the owned supervisor and children, removes PID files, and leaves installed state/data untouched. Logs are append-only local files unless the user clears them.

## Model replacement

After a successful build, an operator may place another instruct-tuned GGUF in `llm/models/`, then select it in Settings. The filename must end in `.gguf`, be a real non-link file, and resolve inside that directory. Normal `start` refuses it because it is not both release-manifested and a `kind=model` destination. The exceptional command `start --allow-unverified-model` must be supplied on every launch and prints a loud warning. llama.cpp treats GGUF as native-parser input; verify provenance and use the organization's approved OS sandbox/VM or equivalent containment. Aurora's portable cross-platform scripts do not create that OS sandbox. A later exact rebuild rejects the extra immutable file; move it outside the release first. For controlled deployment, add an immutable URL/SHA entry to `versions.lock`, prepare a new release, and repeat the model-agnostic A1/A3/A4/A5 grammar tests. Never assume a replacement model follows JSON instructions without enforcement.

## Teardown and recovery

Normal `teardown` stops processes, writes non-empty final XLSX and CSV snapshots, and only then removes `data`, `.runtime`, target `node_modules`, target caches, and `config/app.local.json`. It preserves source, `web/dist`, runtime/llama archives, models, the offline npm store, and `exports`. If export fails, deletion does not start.

- `teardown --no-export` explicitly skips the final snapshot.
- `teardown --purge-exports` additionally removes snapshots only after the operator types `RADERA AURORA` exactly.
- `build --restore-latest` reconstructs fresh state and imports the latest full workbook.

## Updating a release

Never edit only a URL or only a checksum. Review upstream release/license, change version+URL+digest as one commit, regenerate `package-lock.json` with the pinned Node/npm, run the full check, prepare a new versioned folder, and repeat clean macOS arm64, macOS x64, and Windows x64 offline acceptance. Keep old release records until retention policy permits disposal.

Allowed redistribution licenses are MIT, BSD, Apache-2.0, OFL, and public domain/CC0. `npm run test:licenses` is the production dependency gate. Font OFL texts live in `assets/fonts`; map provenance is in `assets/map/LICENSE.md`; model and llama/Node licenses/notices must remain in their upstream archives and release notice inventory.
