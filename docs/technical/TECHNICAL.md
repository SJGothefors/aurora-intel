# Technical overview

[Documentation home](../INDEX.md) · [Technical documentation](INDEX.md) · [Security](SECURITY.md) · [Local model](MODEL.md) · [User documentation](../user/INDEX.md)

Aurora is a React/Vite frontend served by a Node.js loopback HTTP server. SQLite stores cases, vocabulary, questions, notes, settings, local AI jobs and manual weather. MapLibre renders only bundled GeoJSON through a local style; no runtime tile server, geocoder, glyph service or map API is contacted. llama.cpp is optional and runs as a separate authenticated loopback process.

State-changing HTTP requests require both the local session and the Aurora request header. Content Security Policy restricts connections to self. Database migrations are applied in order and transfers validate field limits and controlled vocabulary. Builds pin all direct dependencies and test for external URLs, licenses, schema validation, local request boundaries and process shutdown.

Weather retention is executed during reads/writes: entries older than two days are deleted. Forecast writes are limited to the local history/five-day window and three points per UTC day. Consolidated AI analysis is scheduled after case writes when at least three cases exist; queue payloads are removed after completion.

## Project folders

| Folder | Responsibility |
|---|---|
| `web/src/features/cases` | Intake, ledger, case editor and positions |
| `web/src/features/map` | Offline map and manual weather |
| `web/src/features/analysis` | Assessment, questions, Q&A and AI queue |
| `web/src/features/settings` | Settings, vocabulary and transfer |
| `web/src/components` | Reusable common and navigation components only |
| `server/ai` | Prompt selection, schemas, model client and AI jobs |
| `server/migrations` | Ordered database migrations |
| `scripts` | Development, release, start/stop and packaging automation |
| `docs/user`, `docs/technical` | Role-separated documentation |
