# Start and stop

[Documentation home](../INDEX.md) · [User documentation](INDEX.md) · [Operator guide](USER_GUIDE.md) · [Technical documentation](../technical/INDEX.md)

## Development computer

| Job | Command | Result |
|---|---|---|
| Run without AI | `npm run dev` | Local backend and frontend; manual functions work |
| Run with local AI | `npm run dev:ai` | Downloads approved pinned artifacts on the first connected run, then starts model, backend and frontend |
| Validate changes | `npm run check` | Build, tests, offline URL scan and license gate |
| Run built app | `npm run build` then `npm start` | Production-style local app |
| Stop | `Ctrl+C` in the running terminal | Stops every child process started by that command |

`npm run dev:ai` takes no model or server paths. The first connected run retrieves only URLs pinned with SHA-256 in `config/versions.lock`; later starts reuse verified local files. `npm run dev` and `npm start` never download a model.

### If someone receives the source code

For a connected Mac or Windows development computer, install Node.js 24.18.1 first, open a terminal in the Aurora folder, and run:

```sh
npm ci --ignore-scripts
npm run dev:ai
```

`npm run build` is not needed before `npm run dev:ai`. The first AI start downloads and verifies roughly 4.5 GB of model and local-engine files, so it needs internet access, sufficient disk space and time. Later starts reuse those files. Stop with `Ctrl+C`.

This source-code route still assumes the person can install Node, open the correct folder in a terminal and recognise an error message. For a non-technical operator, distribute a prepared offline release instead: after it has been created on the trusted build computer, the target user only double-clicks `build.command` then `start.command` on macOS, or `build.bat` then `start.bat` on Windows. That target does not need Node, npm, internet access or a cloud account.

## Air-gapped workflow

| Phase | macOS | Windows |
|---|---|---|
| 1. Create/export on trusted connected computer | `./scripts/prepare_release.mjs` through the documented trusted release procedure | Same trusted release procedure; produce the Windows-targeted release |
| 2. Transfer and verify | Verify outer SHA-256/signature through the approved separate channel | Verify outer SHA-256/signature through the approved separate channel |
| 3. Build / package-up offline | Double-click `build.command` | Double-click `build.bat` |
| 4. Start offline | Double-click `start.command` | Double-click `start.bat` |
| 5. Stop offline | Double-click `stop.command` or use the start window | Double-click `stop.bat` or use the start window |

The target does not need npm, internet access or a cloud account. See [Offline packaging](../technical/OFFLINE_PACKAGING.md) for signing, checksums, media format, exact lifecycle and teardown.
