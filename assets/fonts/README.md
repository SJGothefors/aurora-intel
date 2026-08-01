# Bundled offline fonts

These font files are part of the release payload; the application must never fetch fonts at runtime.

| File | Family / face | SHA-256 |
|---|---|---|
| `SairaCondensed-SemiBold.woff2` | Saira Condensed 600, Latin | `6cc20b70e1ec820999536bf962732d49bf5c28eae259df5706584841dcc21df4` |
| `IBMPlexSans-Regular.woff2` | IBM Plex Sans variable Latin, used at 400 | `056e4e2459f57a0033c8c9c844ff19d6e42ac8602027803d4345823bcc939818` |
| `IBMPlexSans-Medium.woff2` | Same IBM Plex Sans variable Latin binary, used for medium/semibold UI text | `056e4e2459f57a0033c8c9c844ff19d6e42ac8602027803d4345823bcc939818` |
| `IBMPlexMono-Regular.woff2` | IBM Plex Mono 400, Latin | `c36f509c0a8f9f85f29cb44bc8701d8a9e0b14c499e77a884f789ead7093a7ac` |

The binaries were retrieved from the Google Fonts static service and are redistributed under SIL Open Font License 1.1. Exact license texts for each family are included beside the binaries. The selected Latin subsets contain Swedish `å`, `ä`, and `ö`. If a broader glyph repertoire is needed, replace each binary with a locally bundled OFL build and update the release checksum manifest.
