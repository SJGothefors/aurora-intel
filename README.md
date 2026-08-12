# Aurora Intel

Aurora Intel is an offline-first intelligence ledger for reviewing and structuring Swedish 7S observation reports. The application, map, data store, and optional local language model all run on `127.0.0.1`; no cloud service is used at runtime.

Start at the [documentation home](docs/INDEX.md). Swedish and English quick guides are at [docs/user/README.sv.md](docs/user/README.sv.md) and [docs/user/README.en.md](docs/user/README.en.md).

## Choose the right run mode

Use Node.js `24.18.1` and install the locked dependencies once:

```sh
npm ci --ignore-scripts
```

| Job | Command | What it starts |
|---|---|---|
| Normal development, no model | `npm run dev` | Backend plus live frontend at `http://127.0.0.1:5173`. AI actions show unavailable. |
| Development with local AI | `npm run dev:ai` | On the first connected run, downloads and verifies the pinned model/current-platform llama package; then starts AI, backend, and frontend. |
| Test the built frontend, no model | `npm run build` then `npm start` | Production-style frontend and backend at `http://127.0.0.1:8474`. |
| Validate source changes | `npm run check` | Build, backend tests, offline-network scan, and license checks. |
| Prepare/install an air-gapped release | See [offline packaging](docs/technical/OFFLINE_PACKAGING.md) | Pinned portable Node, llama.cpp, model, checksums, build/start/stop/teardown lifecycle. Output is written to `applicationExportFolder/`. |

Press `Ctrl+C` in either development mode to stop every process started by that command. `dev:ai` needs no path arguments. On a connected development computer it automatically downloads about 4.5 GB of files pinned in `config/versions.lock`, resumes interrupted downloads, verifies SHA-256 before extraction/execution, and reuses the verified files on later runs. It never performs this download during normal `dev`, production `start`, or on the offline target. Model files are native parser inputs: use only the pinned or separately approved, checksum-verified GGUF files.

The offline release commands are intentionally separate from npm development. On a disconnected target, use `build.command`/`build.bat`, then `start.command`/`start.bat`; do not run npm or download dependencies there.

The running application also contains bilingual **Help and documentation** in the top bar, separated into operator and technical/admin guidance.
