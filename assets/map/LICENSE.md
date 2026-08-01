# Natural Earth map provenance and license

`nordic-baltic.geojson` is derived from **Natural Earth vector v5.1.2, 1:10m**, downloaded from the project's tagged public repository. Natural Earth states that all versions of Natural Earth raster and vector map data are in the public domain. No permission is required to use or modify the data; attribution here is retained for provenance.

Source files:

| Layer | Tagged source | Downloaded SHA-256 |
|---|---|---|
| Countries | `geojson/ne_10m_admin_0_countries.geojson` | `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255` |
| Coastline | `geojson/ne_10m_coastline.geojson` | `6f75ae0e0de157b14946e2255eb1f5486d9a13819032e26d4610852d296788f6` |
| National land borders | `geojson/ne_10m_admin_0_boundary_lines_land.geojson` | `74d9c16229c095fde65943a9919e337682f044bcebccb120764f38edf3b70f4a` |
| Lakes | `geojson/ne_10m_lakes.geojson` | `2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9` |
| Populated places | `geojson/ne_10m_populated_places.geojson` | `9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b` |

All five tagged URLs share this prefix:

```text
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/
```

The reproducible standard-library script `scripts/prepare_map.py` clips geometry to 4°E–33°E / 53°N–71.5°N, applies a 0.004-degree display simplification, rounds coordinates to five decimals, keeps named lakes of Natural Earth scalerank 0–5, and keeps populated places with `POP_MAX >= 50000` plus the explicitly labelled strategic regional places Visby, Luleå, Mariehamn, Kiruna, Boden, and Kaliningrad. It maps the sources into one FeatureCollection whose `properties.layer` is `land`, `coastline`, `border`, `lake`, or `city`; Sweden land has `focus: true`. The checked-in result contains 417 features and has SHA-256 `1bdc5992073786de56fbfe37fdf3513f1d738b970dfd0a5ca1f0866adde19dfd`.

Reproduction (online maintainer workflow, not target build): download the five files above, rename them to `countries.geojson`, `coastline.geojson`, `borders.geojson`, `lakes.geojson`, and `places.geojson` in one temporary directory, then run:

```text
python3 scripts/prepare_map.py <temporary-source-directory> assets/map/nordic-baltic.geojson
```

The release target does not need Python. The generated local file includes Sweden, neighbouring countries, Gotland, Öland, Åland, Bornholm, the Baltic states, Kaliningrad/Gulf of Finland context, coastline, national borders, major lakes, and city labels. It is a display basemap, not a navigation, targeting, survey, or legal-boundary product. Natural Earth boundary treatment carries no position by Aurora about administrative status.

Natural Earth public-domain terms: <https://www.naturalearthdata.com/about/terms-of-use/>. Repository/release provenance: <https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2>.
