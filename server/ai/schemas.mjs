const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableInteger = { type: ['integer', 'null'], minimum: 0 };

export const EXTRACTION_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['reports', 'reason'],
  properties: {
    reports: {
      type: 'array',
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['stunden', 'stallet', 'styrkan', 'slaget', 'sysselsattningen', 'symbolen', 'sagesmannen', 'begrepp', 'position_missing', 'fields_uncertain', 'summary_sv'],
        properties: {
          stunden: {
            type: 'object', additionalProperties: false,
            required: ['raw', 'iso_utc', 'uncertain'],
            properties: { raw: nullableString, iso_utc: nullableString, uncertain: { type: 'boolean' } },
          },
          stallet: {
            type: 'object', additionalProperties: false,
            required: ['raw', 'mgrs', 'lat', 'lon', 'place_name'],
            properties: { raw: nullableString, mgrs: nullableString, lat: nullableNumber, lon: nullableNumber, place_name: nullableString },
          },
          styrkan: {
            type: 'object', additionalProperties: false,
            required: ['raw', 'count_min', 'count_max'],
            properties: { raw: nullableString, count_min: nullableInteger, count_max: nullableInteger },
          },
          slaget: nullableString,
          sysselsattningen: nullableString,
          symbolen: nullableString,
          sagesmannen: nullableString,
          begrepp: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          position_missing: { type: 'boolean' },
          fields_uncertain: { type: 'array', items: { type: 'string' }, uniqueItems: true },
          summary_sv: { type: 'string' },
        },
      },
    },
    reason: nullableString,
  },
});

export const QUESTIONS_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['proposals'],
  properties: {
    proposals: {
      type: 'array', maxItems: 5,
      items: {
        type: 'object', additionalProperties: false,
        required: ['question', 'motivering', 'prioritet', 'linked_case_ids', 'forslag_inhamtning'],
        properties: {
          question: { type: 'string' }, motivering: { type: 'string' },
          prioritet: { type: 'string', enum: ['Hög', 'Medel', 'Låg'] },
          linked_case_ids: { type: 'array', items: { type: 'integer' }, uniqueItems: true },
          forslag_inhamtning: { type: 'string' },
        },
      },
    },
  },
});

export const QA_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['answer', 'cited_case_ids', 'pattern'],
  properties: {
    answer: { type: 'string' },
    cited_case_ids: { type: 'array', items: { type: 'integer' }, uniqueItems: true },
    pattern: {
      type: 'object', additionalProperties: false, required: ['type', 'description'],
      properties: {
        type: { type: ['string', 'null'], enum: ['cluster', 'route', 'trend', null] },
        description: nullableString,
      },
    },
  },
});

export const ASSESSMENT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false,
  required: ['fakta', 'bedomning', 'sannolikhet', 'motivering', 'rekommendation'],
  properties: {
    fakta: { type: 'string' }, bedomning: { type: 'string' }, sannolikhet: { type: 'string' },
    motivering: { type: 'string' }, rekommendation: { type: 'string' },
  },
});

export const SCHEMAS = Object.freeze({
  extraction: EXTRACTION_SCHEMA,
  questions: QUESTIONS_SCHEMA,
  qa: QA_SCHEMA,
  assessment: ASSESSMENT_SCHEMA,
});
