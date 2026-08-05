# Natural Earth map provenance and license

`nordic-baltic.geojson` is derived from **Natural Earth vector v5.1.2, 1:10m**, downloaded from the project's tagged public repository. Natural Earth states that all versions of Natural Earth raster and vector map data are in the public domain. No permission is required to use or modify the data; attribution here is retained for provenance.

Source files:

| Layer | Tagged source | Downloaded SHA-256 |
|---|---|---|
| Countries | `geojson/ne_10m_admin_0_countries.geojson` | `239eec57ac17f100a11e2536cffc56752c318b50ae765b0918ff7aab4ce8f255` |
| Coastline | `geojson/ne_10m_coastline.geojson` | `6f75ae0e0de157b14946e2255eb1f5486d9a13819032e26d4610852d296788f6` |
| National land borders | `geojson/ne_10m_admin_0_boundary_lines_land.geojson` | `74d9c16229c095fde65943a9919e337682f044bcebccb120764f38edf3b70f4a` |
| Lakes | `geojson/ne_10m_lakes.geojson` | `2d036f53dedec578001c5c30c2959ee7d4eebc1306900fa4367c49929ec8f2d9` |
| Major rivers | `geojson/ne_10m_rivers_lake_centerlines.geojson` | `bb854a900ecbd3b408df46d5e16e3e0f974ba55993f9d8b5c26e855273c0905a` |
| Major roads | `geojson/ne_10m_roads.geojson` | `66a0c7b438e92fd124822cc5921cfa11042f48c294ade5e0f03f2c6640fd0248` |
| Populated places | `geojson/ne_10m_populated_places.geojson` | `9b8e3de09048ef00dfc70357dbb9fa324493f214b5e0ae4daf1aa79a8d10116b` |

All seven tagged URLs share this prefix:

```text
https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/
```

The reproducible standard-library script `scripts/prepare_map.py` clips geometry to 4°E–33°E / 53°N–71.5°N, applies a 0.004-degree display simplification, and retains selected major lakes, rivers, roads, and populated places. Swedish settlements down to about 10,000 inhabitants are retained so the application can reveal them progressively at closer zoom levels. It also adds four schematic Gotland road corridors and four settlement labels because the Natural Earth road layer contains no island roads. These application-maintained reference lines are deliberately approximate and must not be used for navigation. The script maps everything into one FeatureCollection whose `properties.layer` identifies each layer; Sweden land has `focus: true`. The checked-in result contains 816 features and has SHA-256 `c075eec94cf160cb06a437cde26fdb423800b191ce9b86b7222a21cb1d7f0ab4`.

Reproduction (online maintainer workflow, not target build): download the seven files above, rename them to `countries.geojson`, `coastline.geojson`, `borders.geojson`, `lakes.geojson`, `rivers.geojson`, `roads.geojson`, and `places.geojson` in one temporary directory, then run:

```text
python3 scripts/prepare_map.py <temporary-source-directory> assets/map/nordic-baltic.geojson
```

The release target does not need Python. The generated local file includes Sweden, neighbouring countries, Gotland, Öland, Åland, Bornholm, the Baltic states, Kaliningrad/Gulf of Finland context, coastline, national borders, major roads, major lakes and rivers, and city labels. It is a display basemap, not a navigation, targeting, survey, or legal-boundary product. Natural Earth boundary treatment carries no position by Aurora about administrative status.

Natural Earth public-domain terms: <https://www.naturalearthdata.com/about/terms-of-use/>. Repository/release provenance: <https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2>.
