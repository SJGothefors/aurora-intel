#!/usr/bin/env node
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAuroraApp } from './app.mjs';
import { parseArgs, runCli, runSelfTest } from './cli.mjs';
import { ensureDataDirectories, runtimePaths } from './paths.mjs';
import { AppError } from './errors.mjs';
import { appendBoundedLog } from './logs.mjs';

function logger(paths) {
  ensureDataDirectories(paths);
  const write = (level, event, details = {}) => {
    try {
      appendBoundedLog(paths.logsDir, 'server.log',
        `${JSON.stringify({ ts: new Date().toISOString(), level, event, ...details })}\n`);
    }
    catch { /* Local logging cannot prevent startup. */ }
  };
  return { info: (event, details) => write('info', event, details), error: (event, details) => write('error', event, details) };
}

export async function runServer(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.host && !['127.0.0.1', 'localhost'].includes(String(args.host))) {
    throw new AppError('LOOPBACK_REQUIRED', 'Aurora Intel can only bind to the loopback interface.');
  }
  const shared = [];
  if (args.root) shared.push('--root', String(args.root));
  if (args['data-dir']) shared.push('--data-dir', String(args['data-dir']));
  if (args['llm-port']) shared.push('--llm-port', String(args['llm-port']));
  if (args['migrate-only']) return runCli(['migrate', ...shared]);
  if (args['self-test']) return runSelfTest({ ...args, _: [] });
  if (args.export) {
    const format = path.extname(String(args.export)).slice(1) || args.format || 'xlsx';
    return runCli(['export', '--output', String(args.export), '--format', format, ...shared]);
  }
  if (args.import) return runCli(['import', '--input', String(args.import), '--mode', String(args.mode ?? 'replace'), ...shared]);
  if (args['backup-now']) return runCli(['backup', ...shared]);

  const paths = runtimePaths({ root: args.root, dataDir: args['data-dir'] });
  const log = logger(paths);
  const app = createAuroraApp({
    paths,
    config: {
      ...(args.port ?? process.env.AURORA_PORT ? { appPort: Number(args.port ?? process.env.AURORA_PORT) } : {}),
      ...(args['llm-port'] ?? process.env.AURORA_LLM_PORT ? { llmPort: Number(args['llm-port'] ?? process.env.AURORA_LLM_PORT) } : {}),
    },
    logger: log,
  });
  const address = await app.start({ port: args.port ?? process.env.AURORA_PORT });
  log.info('server_started', address);
  process.stdout.write(`${JSON.stringify({ ok: true, ...address })}\n`);
  let closing = false;
  const close = async (signal) => {
    if (closing) return;
    closing = true;
    log.info('server_stopping', { signal });
    try { await app.close(); process.exitCode = 0; }
    catch (error) { log.error('server_stop_failed', { code: error.code }); process.exitCode = 1; }
  };
  process.once('SIGINT', () => close('SIGINT'));
  process.once('SIGTERM', () => close('SIGTERM'));
  return { ...address, app };
}

async function main() {
  try {
    const result = await runServer();
    if (!result?.app && result) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code ?? 'START_FAILED', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
