import { AppError } from '../errors.mjs';

function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'array') return Array.isArray(value);
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'integer') return Number.isInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  if (type === 'string') return typeof value === 'string';
  if (type === 'boolean') return typeof value === 'boolean';
  return true;
}

function equal(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function violation(path, reason) {
  throw new AppError('LLM_SCHEMA_VIOLATION', 'The local model response did not match the required JSON schema.', {
    status: 502,
    details: { path, reason },
  });
}

function validate(value, schema, path) {
  if (!schema || typeof schema !== 'object') return;
  const types = schema.type === undefined ? [] : (Array.isArray(schema.type) ? schema.type : [schema.type]);
  if (types.length && !types.some((type) => typeMatches(value, type))) violation(path, `expected ${types.join('|')}`);
  if (schema.const !== undefined && !equal(value, schema.const)) violation(path, 'const');
  if (schema.enum && !schema.enum.some((item) => equal(value, item))) violation(path, 'enum');
  if (typeof value === 'number' && schema.minimum !== undefined && value < schema.minimum) violation(path, 'minimum');
  if (typeof value === 'string' && schema.maxLength !== undefined && value.length > schema.maxLength) violation(path, 'maxLength');

  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) violation(path, 'minItems');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) violation(path, 'maxItems');
    if (schema.uniqueItems && new Set(value.map((item) => JSON.stringify(item))).size !== value.length) violation(path, 'uniqueItems');
    if (schema.items) value.forEach((item, index) => validate(item, schema.items, `${path}[${index}]`));
  }

  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) violation(`${path}.${required}`, 'required');
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties ?? {}));
      const unknown = Object.keys(value).find((key) => !allowed.has(key));
      if (unknown) violation(`${path}.${unknown}`, 'additionalProperties');
    }
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (Object.prototype.hasOwnProperty.call(value, key)) validate(value[key], childSchema, `${path}.${key}`);
    }
  }
}

export function validateJsonSchema(value, schema) {
  validate(value, schema, '$');
  return value;
}
