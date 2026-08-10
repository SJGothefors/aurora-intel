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

function findMgrsInText(value) {
  const text = nullableText(value);
  if (!text) return null;
  const spaced = text.match(/\b\d{1,2}\s*[C-HJ-NP-X]\s*[A-HJ-NP-Z]{2}\s+(\d{1,5})\s+(\d{1,5})\b/iu);
  if (spaced && spaced[1].length === spaced[2].length) return spaced[0];
  return text.match(/\b\d{1,2}[C-HJ-NP-X][A-HJ-NP-Z]{2}\d{2,10}\b/iu)?.[0] ?? null;
}

function localityFromPlaceName(value) {
  const placeName = nullableText(value);
  if (!placeName) return null;
  return placeName.match(/^(.+?)\s+(?:centrum|stadskärna|citykärna)$/iu)?.[1]?.trim() || placeName;
}

function splitLabeledPlace(value) {
  const text = nullableText(value);
  if (!text) return { raw: null, mgrs: null, placeName: null };
  const mgrs = findMgrsInText(text);
  if (!mgrs) return { raw: text, mgrs: null, placeName: text };
  const remainder = text.replace(mgrs, '').replace(/^[\s,;:().-]+|[\s,;:().-]+$/gu, '').trim();
  if (!remainder) return { raw: text, mgrs, placeName: null };
  return { raw: localityFromPlaceName(remainder), mgrs, placeName: remainder };
}

function inferVocabulary(allowed, values) {
  const text = Object.values(values).map((value) => String(value ?? '')).join(' ').toLocaleLowerCase('sv-SE');
  const inferred = [];
  const add = (name) => {
    const term = allowed.get(name);
    if (term && !inferred.includes(term)) inferred.push(term);
  };

  if (/(?:stridsvagn|stridsfordon|pansarfordon|t-?\s?90|bmp-?\d*|btr-?\d*|\bifv\b|\bapc\b)/u.test(text)) add('STRIDSFORDON');
  else if (/(?:militär(?:t|a)?\s+fordon|terrängbil|bandvagn)/u.test(text)) add('FORDON MIL');
  else if (/(?:diplomatbil|diplomatfordon|civil(?:t|a)?\s+(?:fordon|personbil)|personbil|sedan|pickup|skåpbil)/u.test(text)) add('FORDON CIVILT AVVIKANDE');

  if (/(?:drönare|drone|quadcopter|multikopter|\buas\b|obemannad\s+luftfarkost)/u.test(text)) add('UAS/DRÖNARE');
  else if (/(?:helikopter|rotorcraft)/u.test(text)) add('HELIKOPTER');
  else if (/(?:flygplan|luftfarkost|aircraft)/u.test(text)) add('LUFTFARKOST');

  if (/(?:örlogsfartyg|krigsfartyg|fregatt|korvett|jagare|ubåt|militär(?:t|a)?\s+fartyg)/u.test(text)) add('FARTYG ÖRLOG');
  else if (/(?:lastfartyg|tankfartyg|färja|civilt?\s+fartyg|handelsfartyg)/u.test(text)) add('FARTYG CIVILT AVVIKANDE');

  if (/(?:beväpnad(?:e)?\s+person|uniformerad(?:e)?|soldat(?:er)?|trupp|militär\s+personal)/u.test(text)) add('PERSONAL/TRUPP');
  if (/(?:rekognos|spaning|fotograferar|fotograferade|kartlägger|observerar\s+(?:grind|skyddsobjekt|anläggning)|frågar\s+om\s+vaktschema)/u.test(text)) add('SPANING/REKOGNOSERING');
  if (/(?:gnss|gps).{0,24}(?:stör|jam|spoof)|(?:stör|jam|spoof).{0,24}(?:gnss|gps)/u.test(text)) add('SIGNALSTÖRNING/GNSS');
  if (/(?:kritisk\s+infrastruktur|fiberkabel|kabelskåp|transformatorstation|vattenverk|kraftverk)/u.test(text)) add('KRITISK INFRASTRUKTUR');
  if (/(?:gränskränkning|obehörig\s+gränspassage|kränkte\s+gräns)/u.test(text)) add('GRÄNSKRÄNKNING');
  if (/(?:sabotage|skadegörelse|vandaliser|uppbrutet|sönderslaget|avsiktligt\s+skad)/u.test(text)) add('SABOTAGE/SKADEGÖRELSE');
  if (/(?:underrättelseverksamhet|värvningsförsök|elicitering|inhämtar\s+skyddsvärd\s+information)/u.test(text)) add('UNDERRÄTTELSEVERKSAMHET');
  if (/(?:logistik|transportkolonn|konvoj|lossar\s+materiel|lastar\s+materiel|tankbil)/u.test(text)) add('LOGISTIK/TRANSPORT');
  if (/(?:övning|utbildning|övar|tränar)/u.test(text)) add('ÖVNING/UTBILDNING');
  if (/(?:\bcbrn\b|kemisk|biologisk|radiologisk|radioaktiv|nukleär)/u.test(text)) add('CBRN');
  return inferred;
}

const LABELS = [
  ['stunden', /\bstund(?:en)?\b/giu],
  ['stallet', /\bst(?:ä|a)lle(?:t)?\b/giu],
  ['styrkan', /\bstyrka(?:n)?\b/giu],
  ['slaget', /\bslag(?:et)?\b/giu],
  ['sysselsattningen', /\bsyssels(?:ä|a)ttning(?:en)?\b/giu],
  ['symbolen', /\bsymbol(?:en)?\b/giu],
  ['sagesmannen', /\bs(?:ä|a)gesman(?:nen)?\b/giu],
];

function labeled7S(text) {
  const matches = LABELS.flatMap(([field, expression]) => [...text.matchAll(expression)].map((match) => ({ field, index: match.index, end: match.index + match[0].length })))
    .sort((left, right) => left.index - right.index);
  if (matches.length < 2) return null;
  const values = {};
  for (let index = 0; index < matches.length; index += 1) {
    const current = matches[index];
    const end = matches[index + 1]?.index ?? text.length;
    const value = text.slice(current.end, end).replace(/^[\s,:;.-]+|[\s,;.-]+$/gu, '').trim();
    if (value) values[current.field] = value;
  }
  const prefix = text.slice(0, matches[0].index).trim();
  const sourceReportId = prefix.match(/^(\d{4,12})(?:\s*[.:;-])?$/u)?.[1] ?? null;
  return { ...values, source_report_id: sourceReportId };
}

export function extractCompleteLabeled7S(sourceText, context = {}) {
  const labeled = labeled7S(String(sourceText ?? ''));
  const required = ['stunden', 'stallet', 'styrkan', 'slaget', 'sysselsattningen', 'symbolen', 'sagesmannen'];
  if (!labeled || !required.every((field) => labeled[field])) return null;
  const place = splitLabeledPlace(labeled.stallet);
  const count = labeled.styrkan.match(/\b(\d+)\b/u)?.[1];
  return postprocessExtraction({
    reports: [{
      source_report_id: labeled.source_report_id,
      stunden: { raw: labeled.stunden, iso_utc: null, uncertain: false },
      stallet: { raw: place.raw, mgrs: place.mgrs, lat: null, lon: null, place_name: place.placeName },
      styrkan: { raw: labeled.styrkan, count_min: count ? Number(count) : null, count_max: count ? Number(count) : null },
      slaget: labeled.slaget,
      sysselsattningen: labeled.sysselsattningen,
      symbolen: labeled.symbolen,
      sagesmannen: labeled.sagesmannen,
      begrepp: [],
      position_missing: !place.mgrs,
      fields_uncertain: [],
      summary_sv: `${labeled.slaget}: ${labeled.sysselsattningen}`,
    }],
    reason: null,
  }, { ...context, sourceText });
}

export function postprocessExtraction(value, context = {}) {
  const output = parseOutput(value);
  assert(Array.isArray(output.reports), 'INVALID_AI_OUTPUT', 'reports must be an array.');
  const allowed = new Map((context.activeVocabulary ?? []).map((name) => [name.toLocaleUpperCase('sv-SE'), name]));
  const fallback = allowed.get('ÖVRIGT/OKÄNT');
  const labeled = output.reports.length === 1 ? labeled7S(String(context.sourceText ?? '')) : null;
  const reports = output.reports.slice(0, 20).map((rawReport) => {
    const report = object(rawReport, 'report');
    const stunden = object(report.stunden ?? {}, 'stunden');
    const stallet = object(report.stallet ?? {}, 'stallet');
    const styrkan = object(report.styrkan ?? {}, 'styrkan');
    const fieldsUncertain = new Set(parseArray(report.fields_uncertain));
    if (labeled) {
      for (const field of ['stunden', 'stallet', 'styrkan', 'slaget', 'sysselsattningen', 'symbolen', 'sagesmannen']) {
        if (labeled[field]) fieldsUncertain.delete(field);
      }
    }

    const dtgRaw = nullableText(labeled?.stunden ?? stunden.raw);
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

    const labeledPlace = nullableText(labeled?.stallet);
    const labeledLocation = labeledPlace ? splitLabeledPlace(labeledPlace) : null;
    const labeledMgrs = labeledLocation?.mgrs ?? null;
    let position = normalizePosition({ mgrs: labeledMgrs ?? stallet.mgrs, lat: stallet.lat, lon: stallet.lon }, { strict: false });
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
    const explicitType = `${labeled?.slaget ?? ''} ${labeled?.styrkan ?? ''}`.toLocaleLowerCase('sv-SE');
    const combatVehicle = allowed.get('STRIDSFORDON');
    if (combatVehicle && /(stridsvagn|t-?\s?90|pansarfordon)/u.test(explicitType)) {
      begrepp.splice(0, begrepp.length, combatVehicle);
      fieldsUncertain.delete('begrepp');
    }
    const specificVocabulary = begrepp.filter((item) => item !== fallback);
    if (!specificVocabulary.length) {
      const inferred = inferVocabulary(allowed, {
        slaget: labeled?.slaget ?? report.slaget,
        styrkan: labeled?.styrkan ?? styrkan.raw,
        sysselsattningen: labeled?.sysselsattningen ?? report.sysselsattningen,
        symbolen: labeled?.symbolen ?? report.symbolen,
        stallet: labeled?.stallet ?? stallet.raw,
      });
      begrepp.splice(0, begrepp.length, ...inferred);
      if (inferred.length) fieldsUncertain.delete('begrepp');
    } else if (begrepp.includes(fallback)) {
      begrepp.splice(0, begrepp.length, ...specificVocabulary);
    }
    if (!begrepp.length && fallback) {
      begrepp.push(fallback);
      fieldsUncertain.add('begrepp');
    }

    let countMin = integerOrNull(styrkan.count_min);
    let countMax = integerOrNull(styrkan.count_max);
    const labeledCount = nullableText(labeled?.styrkan)?.match(/\b(\d+)\b/u)?.[1];
    if (labeledCount) countMin = countMax = Number(labeledCount);
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
      source_report_id: nullableText(labeled?.source_report_id ?? report.source_report_id),
      stallet: {
        raw: labeledLocation?.raw ?? nullableText(stallet.raw),
        mgrs: position.mgrs,
        lat: position.lat,
        lon: position.lon,
        place_name: labeledLocation ? labeledLocation.placeName : nullableText(stallet.place_name),
      },
      styrkan: { raw: nullableText(labeled?.styrkan ?? styrkan.raw), count_min: countMin, count_max: countMax },
      slaget: nullableText(labeled?.slaget ?? report.slaget),
      sysselsattningen: nullableText(labeled?.sysselsattningen ?? report.sysselsattningen),
      symbolen: nullableText(labeled?.symbolen ?? report.symbolen),
      sagesmannen: nullableText(labeled?.sagesmannen ?? report.sagesmannen),
      begrepp,
      position_missing: position.position_missing,
      fields_uncertain: [...fieldsUncertain],
      summary_sv: String(report.summary_sv ?? '').trim(),
    };
  });
  return { reports, reason: reports.length ? null : nullableText(output.reason) };
}

export function extractionReportToCase(report, { sourceText, aiJson, createdBy = '' } = {}) {
  const short = (value) => String(value ?? '').trim().split(/\s+/u).slice(0, 4).join(' ') || null;
  return {
    created_by: createdBy,
    source_report_id: report.source_report_id,
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
    activity_summary: short(report.sysselsattningen),
    symbol: report.symbolen,
    traits_summary: short(report.symbolen),
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
    proposals: output.proposals.slice(0, 2).map((proposal) => ({
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
  let answer = String(output.answer ?? '').trim().replace(/^```(?:json)?\s*|\s*```$/giu, '');
  if (/^[\[{]/u.test(answer)) {
    try {
      const parsed = JSON.parse(answer);
      const preferred = parsed?.answer ?? parsed?.summary ?? parsed?.sammanfattning;
      const values = preferred ? [preferred] : Object.entries(parsed ?? {})
        .filter(([key]) => !/^(?:id|ids|cited_case_ids|pattern)$/iu.test(key))
        .flatMap(([, item]) => Array.isArray(item) ? item : [item])
        .filter((item) => ['string', 'number'].includes(typeof item));
      answer = values.map(String).join('. ').trim();
    } catch { /* Keep non-JSON prose unchanged. */ }
  }
  return {
    answer,
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
