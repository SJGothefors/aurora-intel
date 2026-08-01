#!/usr/bin/env node
import mgrs from "mgrs";

const source = "33VWE1234567890";
const [lon, lat] = mgrs.toPoint(source);
if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("MGRS conversion did not return finite coordinates");
const roundTrip = mgrs.forward([lon, lat], 5).replaceAll(" ", "").toUpperCase();
if (roundTrip !== source) throw new Error(`MGRS round-trip mismatch: ${source} -> ${lat},${lon} -> ${roundTrip}`);
console.log(`MGRS round-trip: OK (${source} -> ${lat.toFixed(5)}, ${lon.toFixed(5)})`);
