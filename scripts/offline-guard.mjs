#!/usr/bin/env node
import { scanBuiltAssets } from "./offline-url-scan.mjs";

const { violations } = scanBuiltAssets(process.argv[2]);
if (violations.length) {
  console.error("FEL / ERROR: Built frontend contains external network references:");
  for (const item of violations) console.error(`  ${item.file}: ${item.url}`);
  process.exit(1);
}
console.log("Offline asset guard: OK");
