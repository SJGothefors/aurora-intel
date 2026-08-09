# Map library options

[Documentation home](../INDEX.md) · [Technical documentation](INDEX.md) · [Technical overview](TECHNICAL.md) · [User documentation](../user/INDEX.md)

The visual result depends mostly on the bundled geographic data and style, not only the library. Every option below can remain offline only when tiles, fonts, sprites, styles and data are packaged locally; official online demo sources must never ship in Aurora.

| Option | Approximate appearance | Offline/security impact | Recommendation |
|---|---|---|---|
| **Leaflet** | Crisp flat operational overview using GeoJSON fills/lines and HTML labels | Smaller renderer, but limited label/layer behavior for the desired road and town detail | Replaced in `0.1.0-alpha` |
| **MapLibre GL JS (current)** | Smooth vector layers, road hierarchy and zoom-dependent town labels | Uses WebGL; Aurora supplies a blank local style and bundled GeoJSON, with no remote sources | Selected; keep all styles and geographic data local and checksum-pinned |
| **OpenLayers** | GIS-oriented layered map with strong projections, vector/raster/OGC support and precise controls | Powerful but larger API/maintenance surface; still needs bundled offline data | Choose if staff workflows later require advanced GIS formats/projections |

Upstream visual example galleries are connected-development references only and must never become runtime data sources.

Decision: use pinned MapLibre GL JS with Aurora's bundled `nordic-baltic.geojson`. Layer order is fixed as ground, water, roads and borders. Larger cities remain visible at overview zoom; smaller towns appear when zooming in. A future detailed dataset must be acquired, licensed, simplified, checksum-pinned and tested before inclusion—MapLibre must never silently fall back to online tiles.
