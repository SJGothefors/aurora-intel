#!/usr/bin/env python3
"""Clip Natural Earth 1:10m GeoJSON into Aurora's offline map contract.

This maintainer-only script uses only Python's standard library and is never run
by offline build/start. Inputs are the seven Natural Earth v5.1.2 GeoJSON files
listed in assets/map/LICENSE.md.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

BBOX = (4.0, 53.0, 33.0, 71.5)
TOLERANCE = 0.004

# Natural Earth's regional layer has no Gotland roads. These deliberately
# schematic corridors and place labels provide orientation, not navigation.
GOTLAND_PLACES = {
    "Slite": (18.803, 57.704),
    "Hemse": (18.374, 57.237),
    "Klintehamn": (18.204, 57.386),
    "Fårösund": (19.055, 57.863),
}
GOTLAND_ROADS = {
    "Väg 140": [(18.295, 57.635), (18.204, 57.386), (18.277, 57.031)],
    "Väg 142": [(18.295, 57.635), (18.456, 57.506), (18.374, 57.237), (18.277, 57.031)],
    "Väg 147": [(18.295, 57.635), (18.523, 57.650), (18.803, 57.704)],
    "Väg 148": [(18.295, 57.635), (18.665, 57.745), (18.792, 57.787), (19.055, 57.863)],
}


def inside(point, edge):
    x, y = point
    axis, boundary, keep_greater = edge
    value = x if axis == 0 else y
    return value >= boundary if keep_greater else value <= boundary


def intersection(a, b, edge):
    axis, boundary, _ = edge
    delta = b[axis] - a[axis]
    if delta == 0:
        return [boundary if axis == 0 else a[0], boundary if axis == 1 else a[1]]
    amount = (boundary - a[axis]) / delta
    return [
        a[0] + amount * (b[0] - a[0]),
        a[1] + amount * (b[1] - a[1]),
    ]


def clip_ring(coordinates):
    points = [list(point[:2]) for point in coordinates]
    if points and points[0] == points[-1]:
        points.pop()
    edges = [(0, BBOX[0], True), (0, BBOX[2], False), (1, BBOX[1], True), (1, BBOX[3], False)]
    for edge in edges:
        if not points:
            break
        output = []
        previous = points[-1]
        for current in points:
            if inside(current, edge):
                if not inside(previous, edge):
                    output.append(intersection(previous, current, edge))
                output.append(current)
            elif inside(previous, edge):
                output.append(intersection(previous, current, edge))
            previous = current
        points = output
    if len(points) < 3:
        return []
    points.append(points[0])
    return points


def clip_segment(a, b):
    x0, y0 = a[:2]
    x1, y1 = b[:2]
    dx, dy = x1 - x0, y1 - y0
    p = (-dx, dx, -dy, dy)
    q = (x0 - BBOX[0], BBOX[2] - x0, y0 - BBOX[1], BBOX[3] - y0)
    lower, upper = 0.0, 1.0
    for pi, qi in zip(p, q):
        if pi == 0:
            if qi < 0:
                return None
            continue
        ratio = qi / pi
        if pi < 0:
            lower = max(lower, ratio)
        else:
            upper = min(upper, ratio)
        if lower > upper:
            return None
    return [[x0 + lower * dx, y0 + lower * dy], [x0 + upper * dx, y0 + upper * dy]]


def clip_line(coordinates):
    fragments = []
    current = []
    for first, second in zip(coordinates, coordinates[1:]):
        segment = clip_segment(first, second)
        if segment is None:
            if len(current) >= 2:
                fragments.append(current)
            current = []
            continue
        if not current:
            current = segment
        elif almost_equal(current[-1], segment[0]):
            current.append(segment[1])
        else:
            if len(current) >= 2:
                fragments.append(current)
            current = segment
    if len(current) >= 2:
        fragments.append(current)
    return fragments


def almost_equal(a, b):
    return abs(a[0] - b[0]) < 1e-9 and abs(a[1] - b[1]) < 1e-9


def point_segment_distance(point, start, end):
    dx, dy = end[0] - start[0], end[1] - start[1]
    if dx == 0 and dy == 0:
        return math.hypot(point[0] - start[0], point[1] - start[1])
    ratio = max(0.0, min(1.0, ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)))
    nearest = (start[0] + ratio * dx, start[1] + ratio * dy)
    return math.hypot(point[0] - nearest[0], point[1] - nearest[1])


def simplify(points, tolerance=TOLERANCE):
    if len(points) <= 2:
        return points
    max_distance, max_index = 0.0, 0
    for index in range(1, len(points) - 1):
        distance = point_segment_distance(points[index], points[0], points[-1])
        if distance > max_distance:
            max_distance, max_index = distance, index
    if max_distance <= tolerance:
        return [points[0], points[-1]]
    return simplify(points[: max_index + 1], tolerance)[:-1] + simplify(points[max_index:], tolerance)


def tidy_line(points, closed=False):
    if closed:
        body = points[:-1] if points and almost_equal(points[0], points[-1]) else points
        if len(body) < 3:
            return []
        result = simplify(body)
        if len(result) < 3:
            result = body[:3]
        result.append(result[0])
    else:
        result = simplify(points)
        if len(result) < 2:
            return []
    return [[round(point[0], 5), round(point[1], 5)] for point in result]


def clip_geometry(geometry):
    if not geometry:
        return None
    kind, coordinates = geometry.get("type"), geometry.get("coordinates")
    if kind == "Point":
        x, y = coordinates[:2]
        return {"type": "Point", "coordinates": [round(x, 5), round(y, 5)]} if BBOX[0] <= x <= BBOX[2] and BBOX[1] <= y <= BBOX[3] else None
    if kind in ("LineString", "MultiLineString"):
        source = [coordinates] if kind == "LineString" else coordinates
        lines = [tidy_line(fragment) for line in source for fragment in clip_line(line)]
        lines = [line for line in lines if line]
        if not lines:
            return None
        return {"type": "LineString", "coordinates": lines[0]} if len(lines) == 1 else {"type": "MultiLineString", "coordinates": lines}
    if kind in ("Polygon", "MultiPolygon"):
        source = [coordinates] if kind == "Polygon" else coordinates
        polygons = []
        for polygon in source:
            rings = []
            for ring in polygon:
                clipped = clip_ring(ring)
                if clipped:
                    clipped = tidy_line(clipped, closed=True)
                    if clipped:
                        rings.append(clipped)
            if rings:
                polygons.append(rings)
        if not polygons:
            return None
        return {"type": "Polygon", "coordinates": polygons[0]} if len(polygons) == 1 else {"type": "MultiPolygon", "coordinates": polygons}
    return None


def load(directory, name):
    with (directory / f"{name}.geojson").open(encoding="utf-8") as handle:
        return json.load(handle)["features"]


def feature(geometry, **properties):
    return {"type": "Feature", "properties": properties, "geometry": geometry}


def build(source_dir):
    output = []
    swedish_names = {
        "Sweden": "Sverige", "Norway": "Norge", "Denmark": "Danmark", "Finland": "Finland",
        "Estonia": "Estland", "Latvia": "Lettland", "Lithuania": "Litauen", "Poland": "Polen",
        "Germany": "Tyskland", "Russia": "Ryssland", "Belarus": "Belarus",
    }
    for item in load(source_dir, "countries"):
        geometry = clip_geometry(item.get("geometry"))
        if not geometry:
            continue
        props = item.get("properties", {})
        name = props.get("ADMIN") or props.get("NAME") or ""
        output.append(feature(geometry, layer="land", name=name, name_sv=swedish_names.get(name, name), iso=props.get("ADM0_A3"), focus=props.get("ADM0_A3") == "SWE"))

    for item in load(source_dir, "lakes"):
        props = item.get("properties", {})
        name = props.get("name") or props.get("name_en") or ""
        rank = props.get("scalerank")
        if not name or int(99 if rank is None else rank) > 5:
            continue
        geometry = clip_geometry(item.get("geometry"))
        if geometry:
            output.append(feature(geometry, layer="lake", name=name, scalerank=rank))

    for item in load(source_dir, "rivers"):
        props = item.get("properties", {})
        rank = props.get("scalerank")
        if int(99 if rank is None else rank) > 6:
            continue
        geometry = clip_geometry(item.get("geometry"))
        if geometry:
            output.append(feature(geometry, layer="river", name=props.get("name") or "", scalerank=rank))

    for item in load(source_dir, "roads"):
        props = item.get("properties", {})
        rank = props.get("scalerank")
        if int(99 if rank is None else rank) > 5:
            continue
        geometry = clip_geometry(item.get("geometry"))
        if geometry:
            output.append(feature(geometry, layer="road", name=props.get("name") or props.get("namealt") or "", road_type=props.get("type") or "", scalerank=rank))

    for name, coordinates in GOTLAND_ROADS.items():
        output.append(feature({"type": "LineString", "coordinates": coordinates}, layer="road", name=name, road_type="major", scalerank=5, source="aurora_reference"))

    for item in load(source_dir, "borders"):
        geometry = clip_geometry(item.get("geometry"))
        if not geometry:
            continue
        props = item.get("properties", {})
        output.append(feature(geometry, layer="border", left=props.get("ADM0_A3_L"), right=props.get("ADM0_A3_R"), disputed=props.get("FEATURECLA") != "International boundary (verify)"))

    for item in load(source_dir, "coastline"):
        geometry = clip_geometry(item.get("geometry"))
        if geometry:
            output.append(feature(geometry, layer="coastline"))

    strategic = {"Visby", "Slite", "Hemse", "Klintehamn", "Luleå", "Mariehamn", "Kiruna", "Boden", "Kaliningrad"}
    for item in load(source_dir, "places"):
        props = item.get("properties", {})
        name = props.get("NAME") or props.get("NAMEASCII") or ""
        country = props.get("ADM0NAME") or props.get("SOV0NAME") or ""
        population = int(props.get("POP_MAX") or props.get("POP_MIN") or 0)
        minimum_population = 10_000 if country == "Sweden" else 50_000
        if population < minimum_population and name not in strategic:
            continue
        geometry = clip_geometry(item.get("geometry"))
        if geometry:
            output.append(feature(geometry, layer="city", name=name, name_sv=name, country=country, population=population, capital=bool(props.get("ADM0CAP")), scalerank=props.get("SCALERANK"), strategic_label=name in strategic))

    for name, coordinates in GOTLAND_PLACES.items():
        output.append(feature({"type": "Point", "coordinates": coordinates}, layer="city", name=name, name_sv=name, population=0, capital=False, strategic_label=True, source="aurora_reference"))

    order = {"land": 0, "lake": 1, "river": 2, "road": 3, "border": 4, "coastline": 5, "city": 6}
    output.sort(key=lambda item: (order[item["properties"]["layer"]], item["properties"].get("name", "")))
    return {
        "type": "FeatureCollection",
        "name": "aurora-nordic-baltic-reference-map",
        "bbox": list(BBOX),
        "aurora": {
            "source": "Natural Earth 1:10m with schematic Gotland reference overlay",
            "version": "5.1.2",
            "clip": "4E–33E, 53N–71.5N",
            "simplification_degrees": TOLERANCE,
        },
        "features": output,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source_dir", type=Path, help="Directory containing countries/coastline/borders/lakes/rivers/roads/places.geojson")
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    result = build(args.source_dir)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="\n") as handle:
        json.dump(result, handle, ensure_ascii=False, separators=(",", ":"))
        handle.write("\n")
    counts = {}
    for item in result["features"]:
        layer = item["properties"]["layer"]
        counts[layer] = counts.get(layer, 0) + 1
    print(json.dumps({"features": len(result["features"]), "layers": counts, "output": str(args.output)}))


if __name__ == "__main__":
    main()
