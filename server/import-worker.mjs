import { parentPort, workerData } from 'node:worker_threads';
import { parseCsv, parseWorkbookInProcess } from './transfer.mjs';

try {
  const buffer = Buffer.from(workerData.buffer);
  const dataset = workerData.kind === 'xlsx'
    ? parseWorkbookInProcess(buffer)
    : workerData.kind === 'csv'
      ? { cases: parseCsv(buffer) }
      : null;
  if (!dataset) throw Object.assign(new Error('Unsupported isolated import type.'), { code: 'UNSUPPORTED_IMPORT' });
  parentPort.postMessage({ ok: true, dataset });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: error?.code ?? 'INVALID_IMPORT',
      message: error?.message ?? 'The import could not be parsed.',
      status: error?.status ?? 400,
      details: error?.details,
    },
  });
}
