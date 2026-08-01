#!/usr/bin/env node
import net from "node:net";

function isFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => resolve(false));
    server.listen({ host: "127.0.0.1", port, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

const start = Number.parseInt(process.argv[2] ?? "", 10);
const avoid = new Set(process.argv.slice(3).map(Number));
if (!Number.isInteger(start) || start < 1 || start > 65535) {
  console.error("FEL / ERROR: Invalid starting port.");
  process.exit(2);
}

for (let port = start; port <= 65535; port += 1) {
  if (!avoid.has(port) && await isFree(port)) {
    process.stdout.write(`${port}\n`);
    process.exit(0);
  }
}
console.error("FEL / ERROR: No free loopback port is available.");
process.exit(1);
