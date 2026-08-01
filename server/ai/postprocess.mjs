import { AppError, assert } from '../errors.mjs';
import { normalizePosition } from '../geo.mjs';
import { parseDTG } from '../dtg.mjs';
import { parseArray } from '../cases.mjs';

function object(value, field) {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'INVALID_AI_OUTPUT', `${field} must be an object.`);
  return value;
}

function nullableText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}

function parseOutput(value) {
  if (typeof value !== 'string') return object(value, 'output');
  try { return object(JSON.parse(value), 'output'); }
  catch (error) { throw new AppError('INVALID_AI_JSON', 'The local model returned invalid JSON.', { cause: error }); }
}

function integerOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function postprocessExtraction(value, context = {}) {
  const output = parseOutput(value);
  assert(Array.isArray(output.reports), 'INVALID_AI_OUTPUT', 'reports must be an array.');
  const allowed = new Map((context.activeVocabulary ?? []).map((name) => [name.toLocaleUpperCase('sv-SE'), name]));
  const fallback = allowed.get('ÖVRIGT/OKÄNT');
  const reports = output.reports.slice(0, 20).map((rawReport) => {
    const report = object(rawReport, 'report');
    const stunden = object(report.stunden ?? {}, 'stunden');
    const stallet = object(report.stallet ?? {}, 'stallet');
    const styrkan = object(report.styrkan ?? {}, 'styrkan');
    const fieldsUncertain = new Set(parseArray(report.fields_uncertain));

    const dtgRaw = nullableText(stunden.raw);
    const parsed = parseDTG(dtgRaw, {
      referenceDate: context.referenceDate,
      localOffsetMinutes: context.localOffsetMinutes,
    });
    let isoUtc = parsed?.isoUtc ?? null;
    if (!isoUtc && stunden.iso_utc) {
      const date = new Date(stunden.iso_utc);
      if (!Number.isNaN(date.valueOf())) isoUtc = date.toISOString();
      fieldsUncertain.add('stunden');
    }
    if (!isoUtc && dtgRaw) fieldsUncertain.add('stunden');

    let position = normalizePosition({ mgrs: stallet.mgrs, lat: stallet.lat, lon: stallet.lon }, { strict: false });
    const invalidMgrs = Boolean(position.error);
    if (invalidMgrs && stallet.lat !== null && stallet.lat !== undefined && stallet.lon !== null && stallet.lon !== undefined) {
      position = normalizePosition({ lat: stallet.lat, lon: stallet.lon }, { strict: false });
    }
    if (invalidMgrs || position.error || position.position_missing) {
      if (nullableText(stallet.raw) || nullableText(stallet.place_name) || stallet.mgrs || stallet.lat || stallet.lon) fieldsUncertain.add('stallet');
    }
    delete position.error;

    const suppliedVocabulary = parseArray(report.begrepp);
    const begrepp = [];
    let invalidVocabulary = false;
    for (const item of suppliedVocabulary) {
      const canonical = allowed.get(item.toLocaleUpperCase('sv-SE'));
      if (!canonical) invalidVocabulary = true;
      else if (!begrepp.includes(canonical)) begrepp.push(canonical);
    }
    if (invalidVocabulary) fieldsUncertain.add('begrepp');
    if (!begrepp.length && fallback) begrepp.push(fallback);

    let countMin = integerOrNull(styrkan.count_min);
    let countMax = integerOrNull(styrkan.count_max);
    if (countMin !== null && countMax !== null && countMin > countMax) {
      [countMin, countMax] = [countMax, countMin];
      fieldsUncertain.add('styrkan');
    }

    return {
      stunden: {
        raw: dtgRaw,
        iso_utc: isoUtc,
        uncertain: Boolean(stunden.uncertain || parsed?.uncertain || fieldsUncertain.has('stunden')),
      },
      stallet: {
        raw: nullableText(stallet.raw),
        mgrs: position.mgrs,
        lat: position.lat,
        lon: position.lon,
        place_name: nullableText(stallet.place_name),
      },
      styrkan: { raw: nullableText(styrkan.raw), count_min: countMin, count_max: countMax },
      slaget: nullableText(report.slaget),
      sysselsattningen: nullableText(report.sysselsattningen),
      symbolen: nullableText(report.symbolen),
      sagesmannen: nullableText(report.sagesmannen),
      begrepp,
      position_missing: position.position_missing,
      fields_uncertain: [...fieldsUncertain],
      summary_sv: String(report.summary_sv ?? '').trim(),
    };
  });
  return { reports, reason: reports.length ? null : nullableText(output.reason) };
}

export function extractionReportToCase(report, { sourceText, aiJson, createdBy = '' } = {}) {
  return {
    created_by: createdBy,
    dtg_raw: report.stunden.raw,
    time_utc: report.stunden.iso_utc,
    time_uncertain: report.stunden.uncertain,
    place_raw: report.stallet.raw,
    place_name: report.stallet.place_name,
    mgrs: report.stallet.mgrs,
    lat: report.stallet.lat,
    lon: report.stallet.lon,
    position_missing: report.position_missing,
    styrka_raw: report.styrkan.raw,
    count_min: report.styrkan.count_min,
    count_max: report.styrkan.count_max,
    slag: report.slaget,
    sysselsattning: report.sysselsattningen,
    symbol: report.symbolen,
    sagesman: report.sagesmannen,
    begrepp: report.begrepp,
    kallrapport_raw: sourceText ?? null,
    ai_json: aiJson ?? report,
    fields_uncertain: report.fields_uncertain,
  };
}

export function sanitizeQuestions(value, validCaseIds) {
  const output = parseOutput(value);
  assert(Array.isArray(output.proposals), 'INVALID_AI_OUTPUT', 'proposals must be an array.');
  const valid = new Set([...validCaseIds].map(Number));
  return {
    proposals: output.proposals.slice(0, 5).map((proposal) => ({
      question: String(proposal.question ?? '').trim(),
      motivering: String(proposal.motivering ?? '').trim(),
      prioritet: ['Hög', 'Medel', 'Låg'].includes(proposal.prioritet) ? proposal.prioritet : 'Medel',
      linked_case_ids: [...new Set((proposal.linked_case_ids ?? []).map(Number).filter((id) => valid.has(id)))],
      forslag_inhamtning: String(proposal.forslag_inhamtning ?? '').trim(),
    })).filter((proposal) => proposal.question && proposal.linked_case_ids.length),
  };
}

export function sanitizeQa(value, validCaseIds) {
  const output = parseOutput(value);
  const valid = new Set([...validCaseIds].map(Number));
  const patternType = ['cluster', 'route', 'trend'].includes(output.pattern?.type) ? output.pattern.type : null;
  return {
    answer: String(output.answer ?? '').trim(),
    cited_case_ids: [...new Set((output.cited_case_ids ?? []).map(Number).filter((id) => valid.has(id)))],
    pattern: { type: patternType, description: patternType ? nullableText(output.pattern?.description) : null },
  };
}

export function sanitizeAssessment(value, likelihoodScale) {
  const output = parseOutput(value);
  const scale = likelihoodScale.map((item) => String(item).trim());
  const supplied = String(output.sannolikhet ?? '').trim();
  const canonical = scale.find((item) => item.toLocaleLowerCase('sv-SE') === supplied.toLocaleLowerCase('sv-SE'));
  assert(canonical, 'INVALID_LIKELIHOOD', 'The model used a likelihood value outside the configured scale.', {
    details: { supplied, allowed: scale },
  });
  return {
    fakta: String(output.fakta ?? '').trim(),
    bedomning: String(output.bedomning ?? '').trim(),
    sannolikhet: canonical,
    motivering: String(output.motivering ?? '').trim(),
    rekommendation: String(output.rekommendation ?? '').trim(),
  };
}
