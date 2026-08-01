#!/usr/bin/env node
const url = process.argv[2];
const timeoutMs = Number.parseInt(process.argv[3] ?? "60000", 10);
if (!url || !url.startsWith("http://127.0.0.1:")) {
  console.error("FEL / ERROR: Health URL must use 127.0.0.1.");
  process.exit(2);
}

const deadline = Date.now() + timeoutMs;
let lastError = "no response";
while (Date.now() < deadline) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
    if (response.ok) process.exit(0);
    lastError = `HTTP ${response.status}`;
  } catch (error) {
    lastError = error.message;
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
}
console.error(`FEL / ERROR: Timed out waiting for ${url}: ${lastError}`);
process.exit(1);
