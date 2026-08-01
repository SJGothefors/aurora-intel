#!/usr/bin/env node
import { scanBuiltAssets } from '../scripts/offline-url-scan.mjs';

try {
  const { root, violations } = scanBuiltAssets(process.argv[2]);
  if (violations.length) {
    console.error('Offline guard failed. External or encoded network references were found:');
    console.error(violations.map(({ file, url }) => `${file}: ${url}`).join('\n'));
    process.exit(1);
  }
  console.log(`Offline guard OK: ${root} contains no external URL references.`);
} catch (error) {
  console.error(`Offline guard could not scan built assets: ${error.message}`);
  process.exit(2);
}
