export const BAS_VOCABULARY = Object.freeze([
  ['FORDON MIL', 'Military vehicle', 'Unarmored or unidentified military vehicles.', '10031000001105000000'],
  ['STRIDSFORDON', 'Combat vehicle', 'Tanks, infantry fighting vehicles and armored personnel carriers.', '10031000001205000000'],
  ['LUFTFARKOST', 'Aircraft', 'Fixed-wing, rotary-wing or unidentified aircraft.', '10030100000000000000'],
  ['UAS/DRÖNARE', 'UAS/drone', 'Uncrewed aircraft of any size.', '10030100001100000000'],
  ['HELIKOPTER', 'Helicopter', 'Rotary-wing aircraft.', '10030100001300000000'],
  ['FARTYG ÖRLOG', 'Naval vessel', 'Warships and military patrol craft.', '10033000001200000000'],
  ['FARTYG CIVILT AVVIKANDE', 'Anomalous civilian vessel', 'Civil vessels with anomalous movement or behavior.', '10033000001400000000'],
  ['PERSONAL/TRUPP', 'Personnel/troops', 'Uniformed or organized personnel.', '10031000001211000000'],
  ['SPANING/REKOGNOSERING', 'Reconnaissance', 'Observation, photography or probing of a site.', '10031000001214000000'],
  ['SIGNALSTÖRNING/GNSS', 'Signal/GNSS jamming', 'Navigation or communications interference.', '10032500001500000000'],
  ['KRITISK INFRASTRUKTUR', 'Critical infrastructure', 'Events at or near essential infrastructure.', '10031500002100000000'],
  ['GRÄNSKRÄNKNING', 'Border violation', 'Air, sea or land incursions.', '10032500001600000000'],
  ['SABOTAGE/SKADEGÖRELSE', 'Sabotage/vandalism', 'Damage to an object or site of interest.', '10032500001900000000'],
  ['UNDERRÄTTELSEVERKSAMHET', 'Intelligence activity', 'Suspected collection, elicitation or recruitment activity.', '10032500002000000000'],
  ['LOGISTIK/TRANSPORT', 'Logistics/transport', 'Convoys, supply movement or unusual freight.', '10031000001302000000'],
  ['ÖVNING/UTBILDNING', 'Exercise/training', 'Observed training or exercise activity.', '10032500002300000000'],
  ['CBRN', 'CBRN', 'Chemical, biological, radiological or nuclear indicators.', '10031000001600000000'],
  ['ÖVRIGT/OKÄNT', 'Other/unknown', 'No other controlled term fits.', '10031000000000000000'],
]);

export function seedVocabulary(db) {
  const insert = db.prepare(`
    INSERT INTO begrepp (name_sv, name_en, definition, active, sidc, sort)
    VALUES (?, ?, ?, 1, ?, ?)
    ON CONFLICT(name_sv) DO NOTHING
  `);
  db.exec('BEGIN IMMEDIATE');
  try {
    BAS_VOCABULARY.forEach(([nameSv, nameEn, definition, sidc], sort) => {
      insert.run(nameSv, nameEn, definition, sidc, sort);
    });
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function listVocabulary(db, { active } = {}) {
  const where = active === undefined ? '' : 'WHERE active = ?';
  const args = active === undefined ? [] : [active ? 1 : 0];
  return db.prepare(`SELECT * FROM begrepp ${where} ORDER BY sort, name_sv`).all(...args)
    .map((row) => ({ ...row, active: Boolean(row.active) }));
}

export function vocabularyNames(db, { activeOnly = false } = {}) {
  const sql = activeOnly
    ? 'SELECT name_sv FROM begrepp WHERE active = 1 ORDER BY sort, name_sv'
    : 'SELECT name_sv FROM begrepp ORDER BY sort, name_sv';
  return new Set(db.prepare(sql).all().map((row) => row.name_sv));
}
