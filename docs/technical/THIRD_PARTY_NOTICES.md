# Third-party notices

[Documentation home](../INDEX.md) · [Technical documentation](INDEX.md) · [Security](SECURITY.md) · [User documentation](../user/INDEX.md)

Aurora Intel redistributes or builds with the components below. Exact npm versions are locked in `package-lock.json`; exact binary/model revisions and SHA-256 values are in `config/versions.lock`. This notice is a practical inventory, not a substitute for the license texts shipped by each project. Preserve upstream `LICENSE`/`NOTICE` files in portable archives and npm packages when redistributing a release.

| Component | Purpose | License family | Upstream |
|---|---|---|---|
| Node.js 24.18.1 | Portable JavaScript runtime and built-in SQLite | MIT and bundled third-party notices | Node.js project |
| llama.cpp b8933 | Local GGUF inference / OpenAI-compatible server | MIT | ggml-org/llama.cpp |
| Mistral-7B-Instruct-v0.3 | Default open-weights model underlying the pinned Q4_K_M GGUF | Apache-2.0 | Mistral AI; GGUF conversion by bartowski |
| React / React DOM | User interface | MIT | Meta Open Source |
| TanStack React Table / React Virtual | Ledger table and virtualization | MIT | TanStack |
| MapLibre GL JS 6.2.0 | Offline vector map renderer | BSD-3-Clause | MapLibre contributors |
| MapLibre geometry/style dependencies | Local vector processing and collision/layout algorithms | ISC | MapLibre, Mapbox and independent contributors |
| mgrs | Offline MGRS⇄WGS84 conversion | MIT | proj4js contributors |
| i18next / react-i18next | Swedish/English localization | MIT | i18next contributors |
| SheetJS Community Edition 0.20.3 | XLSX import/export, vendored as `vendor/xlsx-0.20.3.tgz` | Apache-2.0 | SheetJS LLC / contributors |
| Vite and React plugin | Online release build tooling only | MIT | Vite contributors |
| TypeScript | Build tooling only | Apache-2.0 | Microsoft |
| IBM Plex Sans / IBM Plex Mono | Bundled offline UI fonts | SIL Open Font License 1.1 | IBM; binaries distributed by Google Fonts |
| Saira Condensed | Bundled offline display font | SIL Open Font License 1.1 | Saira project authors; binary distributed by Google Fonts |
| Natural Earth vector v5.1.2, 1:10m | Countries, coastline, borders, major roads, rivers, lakes, and populated places for the clipped offline map | Public domain | Natural Earth contributors; see `assets/map/LICENSE.md` |

The standalone default-model payload is accompanied by the full applicable text at `assets/model/Mistral-7B-Instruct-v0.3-LICENSE.txt` and the exact conversion provenance/digest at `assets/model/README.md`. The portable Node and llama.cpp archives are rejected during preparation if their own embedded license inventory is absent.

The bundled font license texts are:

- `assets/fonts/OFL-IBMPlexSans.txt`
- `assets/fonts/OFL-IBMPlexMono.txt`
- `assets/fonts/OFL-SairaCondensed.txt`

The generated map records the tagged source URLs, source-file digests, clip, and simplification in `assets/map/LICENSE.md` and embeds source/version metadata in its FeatureCollection.

## Release compliance gate

`npm run test:licenses` evaluates production dependencies against the permitted redistribution families (MIT, BSD, Apache-2.0, OFL, public domain/CC0) and fails closed on missing/unrecognized/disallowed metadata. `prepare_release` runs that gate through `npm run check`, verifies the vendored SheetJS digest through the release checksum manifest, and preserves package license files in the offline npm store. Review model terms and every upstream binary archive again whenever a pin changes.

No license in this inventory grants trademark rights or removes obligations imposed by applicable law or organizational policy.
