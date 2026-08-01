#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openDatabase, databaseStatus } from './db.mjs';
import { runtimePaths, loadAppConfig } from './paths.mjs';
import { seedVocabulary } from './vocabulary.mjs';
import { parseDTG } from './dtg.mjs';
import { mgrsToWgs84, wgs84ToMgrs } from './geo.mjs';
import { exportCasesCsv, importDataset, parseImport, refreshCsvMirror, writeAtomic, writeWorkbook } from './transfer.mjs';
import { createBackup } from './backup.mjs';
import { LlamaClient } from './ai/llm.mjs';
import { AppError, assert } from './errors.mjs';

export function parseArgs(argv) {
  const result = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) { result._.push(token); continue; }
    const equals = token.indexOf('=');
    if (equals > 0) { result[token.slice(2, equals)] = token.slice(equals + 1); continue; }
    const key = token.slice(2);
    if (argv[index + 1] && !argv[index + 1].startsWith('--')) result[key] = argv[++index];
    else result[key] = true;
  }
  return result;
}

function context(args) {
  const paths = runtimePaths({ root: args.root, dataDir: args['data-dir'] });
  const config = loadAppConfig(paths, {
    ...(args['llm-port'] ? { llmPort: Number(args['llm-port']) } : {}),
  });
  return { paths, config };
}

export async function runSelfTest(args = {}) {
  const { paths, config } = context(args);
  const db = openDatabase(paths);
  try {
    const dtg = parseDTG('010632B AUG 26');
    assert(dtg?.isoUtc === '2026-08-01T04:32:00.000Z', 'SELF_TEST_DTG', 'The DTG self-test failed.');
    const point = mgrsToWgs84('33VWE 12345 67890');
    const roundTrip = wgs84ToMgrs(point.lat, point.lon);
    assert(roundTrip.mgrs.replaceAll(' ', '').startsWith('33VWE'), 'SELF_TEST_MGRS', 'The MGRS self-test failed.');
    const result = { ok: true, database: databaseStatus(db), dtg, mgrs: point, llm: null };
    if (!args['skip-llm']) {
      const llm = new LlamaClient({ port: config.llmPort, model: config.modelPath ? path.basename(config.modelPath) : undefined, logsDir: paths.logsDir, timeoutMs: 60_000 });
      const status = await llm.status();
      if (!status.ok && !args['allow-llm-down']) throw new AppError('SELF_TEST_LLM', 'The local model self-test could not connect.', { status: 503 });
      if (status.ok) {
        const echo = await llm.chatJson({
          schemaName: 'aurora_self_test',
          schema: { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean', const: true } } },
          messages: [{ role: 'system', content: 'Return the requested JSON exactly.' }, { role: 'user', content: '{"ok":true}' }],
          temperature: 0, seed: 1,
        });
        assert(echo?.ok === true, 'SELF_TEST_LLM', 'The local model grammar self-test failed.');
      }
      result.llm = status;
    }
    return result;
  } finally {
    db.close();
  }
}

export async function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const command = args._[0] ?? 'help';
  const { paths } = context(args);
  if (command === 'self-test') return runSelfTest(args);
  if (command === 'help') return {
    usage: 'server/cli.mjs migrate|seed|self-test|export|import|backup',
    options: ['--root', '--data-dir', '--format', '--output', '--input', '--mode', '--llm-port'],
  };
  const db = openDatabase(paths);
  try {
    if (command === 'migrate') return databaseStatus(db);
    if (command === 'seed') { seedVocabulary(db); return { ok: true }; }
    if (command === 'export') {
      const format = String(args.format || path.extname(String(args.output ?? '')).slice(1) || 'xlsx').toLowerCase();
      assert(['xlsx', 'csv'].includes(format), 'INVALID_EXPORT_FORMAT', 'The export format must be xlsx or csv.');
      assert(args.output, 'OUTPUT_REQUIRED', 'An output path is required.');
      const output = path.resolve(paths.root, String(args.output));
      if (format === 'xlsx') await writeWorkbook(db, output);
      else writeAtomic(output, exportCasesCsv(db, { delimiter: args.delimiter === 'comma' ? ',' : ';' }));
      return { ok: true, output, format };
    }
    if (command === 'import') {
      assert(args.input, 'INPUT_REQUIRED', 'An input path is required.');
      const input = path.resolve(paths.root, String(args.input));
      const dataset = await parseImport(fs.readFileSync(input), input);
      const result = importDataset(db, dataset, { mode: args.mode ?? 'merge' });
      refreshCsvMirror(db, paths);
      return { ok: true, input, ...result };
    }
    if (command === 'backup') return { ok: true, output: await createBackup(db, paths) };
    throw new AppError('UNKNOWN_COMMAND', 'The CLI command is unknown.', { details: { command } });
  } finally {
    db.close();
  }
}

async function main() {
  try {
    const result = await runCli();
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code ?? 'CLI_FAILED', message: error.message } })}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await main();
