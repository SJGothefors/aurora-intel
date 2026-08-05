import { AppError, assert } from './errors.mjs';

export const INPUT_LIMITS = Object.freeze({
  case: Object.freeze({
    created_by: 256,
    source_report_id: 256,
    dtg_raw: 256,
    place_raw: 2 * 1024,
    place_name: 512,
    mgrs: 64,
    styrka_raw: 512,
    slag: 512,
    sysselsattning: 32 * 1024,
    symbol: 2 * 1024,
    sagesman: 2 * 1024,
    kallrapport_raw: 256 * 1024,
    bedomning: 64 * 1024,
    ai_json: 512 * 1024,
  }),
  note_text: 64 * 1024,
  question: 8 * 1024,
  question_reason: 32 * 1024,
  question_collection: 32 * 1024,
  vocabulary_name: 256,
  vocabulary_definition: 32 * 1024,
  sidc: 64,
  setting_value: 64 * 1024,
  settings_patch: 128 * 1024,
});

export function byteLength(value) {
  return Buffer.byteLength(String(value), 'utf8');
}

export function boundedText(value, field, maxBytes, options = {}) {
  const { required = false, emptyAsNull = !required, trim = true } = options;
  if (value === null || value === undefined) {
    assert(!required, 'REQUIRED_FIELD', `${field} is required.`, { details: { field } });
    return null;
  }
  const string = String(value);
  assert(byteLength(string) <= maxBytes, 'FIELD_TOO_LARGE', `${field} exceeds the size limit.`, {
    status: 413, details: { field, max_bytes: maxBytes },
  });
  const normalized = trim ? string.trim() : string;
  assert(!required || normalized.length > 0, 'REQUIRED_FIELD', `${field} is required.`, { details: { field } });
  return emptyAsNull && normalized === '' ? null : normalized;
}

export function boundedStringArray(values, field, options = {}) {
  const { maxItems = 256, maxItemBytes = 256 } = options;
  assert(Array.isArray(values), 'INVALID_ARRAY', `${field} must be an array.`, { details: { field } });
  assert(values.length <= maxItems, 'TOO_MANY_ITEMS', `${field} contains too many items.`, {
    status: 413, details: { field, max_items: maxItems },
  });
  return [...new Set(values
    .map((item, index) => boundedText(item, `${field}[${index}]`, maxItemBytes))
    .filter((item) => item !== null))];
}

/** Validate a value as bounded, plain JSON before it is persisted. */
export function encodeBoundedJson(value, field, options = {}) {
  const {
    maxBytes = INPUT_LIMITS.setting_value,
    maxDepth = 32,
    maxNodes = 20_000,
    maxContainerItems = 4_096,
    maxKeyBytes = 256,
  } = options;
  const stack = [{ value, depth: 0 }];
  const seen = new WeakSet();
  let nodes = 0;

  while (stack.length) {
    const current = stack.pop();
    nodes += 1;
    assert(nodes <= maxNodes, 'JSON_TOO_COMPLEX', `${field} contains too many JSON values.`, {
      status: 413, details: { field, max_nodes: maxNodes },
    });
    assert(current.depth <= maxDepth, 'JSON_TOO_DEEP', `${field} is nested too deeply.`, {
      status: 413, details: { field, max_depth: maxDepth },
    });
    const item = current.value;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') continue;
    if (typeof item === 'number') {
      assert(Number.isFinite(item), 'INVALID_JSON_VALUE', `${field} contains a non-finite number.`, { details: { field } });
      continue;
    }
    assert(typeof item === 'object', 'INVALID_JSON_VALUE', `${field} contains a value that cannot be stored as JSON.`, { details: { field } });
    assert(!seen.has(item), 'INVALID_JSON_VALUE', `${field} contains a circular or repeated object reference.`, { details: { field } });
    seen.add(item);
    if (Array.isArray(item)) {
      assert(item.length <= maxContainerItems, 'JSON_TOO_COMPLEX', `${field} contains an oversized array.`, {
        status: 413, details: { field, max_items: maxContainerItems },
      });
      for (let index = item.length - 1; index >= 0; index -= 1) stack.push({ value: item[index], depth: current.depth + 1 });
      continue;
    }
    const prototype = Object.getPrototypeOf(item);
    assert(prototype === Object.prototype || prototype === null, 'INVALID_JSON_VALUE', `${field} must contain only plain JSON objects.`, { details: { field } });
    const entries = Object.entries(item);
    assert(entries.length <= maxContainerItems, 'JSON_TOO_COMPLEX', `${field} contains an oversized object.`, {
      status: 413, details: { field, max_items: maxContainerItems },
    });
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const [key, child] = entries[index];
      assert(byteLength(key) <= maxKeyBytes, 'FIELD_TOO_LARGE', `${field} contains an oversized object key.`, {
        status: 413, details: { field, max_key_bytes: maxKeyBytes },
      });
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }

  let encoded;
  try { encoded = JSON.stringify(value); }
  catch (error) { throw new AppError('INVALID_JSON_VALUE', `${field} cannot be encoded as JSON.`, { cause: error }); }
  assert(typeof encoded === 'string', 'INVALID_JSON_VALUE', `${field} cannot be encoded as JSON.`, { details: { field } });
  assert(Buffer.byteLength(encoded) <= maxBytes, 'JSON_TOO_LARGE', `${field} exceeds the JSON size limit.`, {
    status: 413, details: { field, max_bytes: maxBytes },
  });
  return encoded;
}
