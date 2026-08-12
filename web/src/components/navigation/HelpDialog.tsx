import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal } from '../common/Modal';

type HelpAudience = 'user' | 'technical';

const help = {
  sv: {
    eyebrow: 'HJÄLP & DOKUMENTATION',
    title: 'Så fungerar Aurora',
    user: 'För användare',
    technical: 'För teknisk personal',
    userIntro: 'Aurora är en lokal underrättelseliggare. Arbeta källkritiskt: AI-förslag är utkast och varje uppgift ska verifieras av en människa.',
    technicalIntro: 'Teknisk översikt för administratörer, driftsättare och den som förbereder ett offlinepaket.',
    userSections: [
      ['Kom igång', 'Skapa ett ärende med Nytt ärende. Klistra in en 7S-rapport eller använd manuell inmatning. Kontrollera alltid AI-utkastet, välj källbedömning själv och spara först när fälten stämmer. Klicka på en rad för detaljer och redigering.'],
      ['Liggaren', 'Liggaren är den gemensamma källan för tabell, karta, sökning, filter, bedömning och spaningsfrågor. Stjärnmarkera viktiga rader, använd status och taggar för arbetsflödet och markera flera rader för gemensam bedömning. Originalrapporten bevaras separat från sammanfattningen.'],
      ['Karta och position', 'Ärenden med MGRS eller latitud/longitud visas på den helt lokala kartan. Kartan och tabellen använder samma filter. Ett kartutsnitt kan användas som filter. Ärenden utan position ligger kvar i liggaren och visas i listan Utan position.'],
      ['Excel-import och export', 'XLSX är formatet för en komplett Aurora-kopia: ärenden, spaningsfrågor, begrepp och anteckningar följer med. CSV innehåller endast ärenderader och passar enklare tabellarbete. För import: välj fil, kontrollera förhandsgranskning och kolumnmappning och välj sedan Sammanfoga, Lägg till eller Ersätt. Ersätt raderar nuvarande innehåll först; ta alltid en export före detta.'],
      ['Lokal AI och bedömningar', 'Modellen körs på samma dator och får bara ett begränsat urval av liggaren och den lokala kunskapsbanken. AI kan strukturera rapporter, föreslå bedömningar, svara med källrader och skapa spaningsfrågor. Manuella funktioner fortsätter fungera när modellen är frånkopplad.'],
      ['Rensa, avinstallera och återställa', 'Rensa data i Inställningar tar först emot en komplett XLSX-export och raderar sedan arbetsdata. Teardown-skriptet skapar både XLSX och CSV i exports innan runtime och arbetsdata tas bort. Exporterna bevaras normalt och kan återläsas med build --restore-latest. Kontrollera alltid att exportfilen går att öppna innan media eller gamla installationer kasseras.'],
    ],
    technicalSections: [
      ['Arkitektur och lagring', 'React/Vite-klienten serveras av en Node-server på loopback. SQLite lagrar liggare, begrepp, spaningsfrågor, anteckningar, inställningar, väder och AI-jobb. MapLibre läser endast den medföljande GeoJSON-kartan. llama.cpp är en separat lokal process; ingen molntjänst krävs.'],
      ['Data- och modellflöde', '7S-text skickas till den lokala modellen med ett strikt JSON-schema. Servern validerar och normaliserar resultatet före lagring. Frågor och bedömningar får ett avgränsat urval av ärenden samt relevanta lokala kunskapsutdrag. Modellresultat är beslutsstöd, aldrig automatisk sanning.'],
      ['XLSX, CSV och sammanslagning', 'Auroras XLSX innehåller separata blad för cases, spaningsfragor och begrepp, inklusive bevarade ID:n och JSON-kolumner för listor och anteckningar. Sammanfogning matchar bevarat ID, källrapport-ID eller en sammansatt händelsenyckel. Lägg till skapar nya rader. Ersätt återställer hela arbetsmängden. CSV är avsiktligt begränsat till cases.'],
      ['Release och installation', 'Kör prepare_release på en betrodd internetansluten byggdator. Det hämtar pinnade artefakter, verifierar SHA-256, bygger och testar, skapar SBOM och lägger offline-mappen, ZIP-filen och yttre checksumma i applicationExportFolder. På måldatorn packas hela ZIP-filen upp och build.command eller build.bat kör verifierad installation utan nät.'],
      ['Prune/teardown och återställning', 'Normal teardown stoppar processer, skapar och kontrollerar slutexporter och tar därefter bort runtime, databas, lokala paket och lokal konfiguration. exports bevaras. --no-export måste väljas uttryckligen. --purge-exports kräver den exakta destruktiva bekräftelsen. Build med --restore-latest importerar senaste fullständiga arbetsbok efter migrering.'],
      ['Kontroller och felsökning', 'npm run check bygger webbklienten och kör enhets-, integrations-, offline-URL- och licenstester. Releaseförberedelsen kör samma kontroll i den iscensatta kopian och verifierar därefter ZIP-struktur och transportchecksumma. Loggar finns i data/logs. Ändra aldrig modelldata, runtimearkiv eller checksums.txt inne i ett förberett paket.'],
    ],
  },
  en: {
    eyebrow: 'HELP & DOCUMENTATION',
    title: 'How Aurora works',
    user: 'For users',
    technical: 'For technical staff',
    userIntro: 'Aurora is a local intelligence ledger. Work critically: AI proposals are drafts and every item must be verified by a person.',
    technicalIntro: 'Technical overview for administrators, deployers and staff preparing an offline package.',
    userSections: [
      ['Getting started', 'Create a case with New case. Paste a 7S report or use manual entry. Always review the AI draft, choose the source assessment yourself and save only after checking the fields. Select a row for details and editing.'],
      ['The ledger', 'The ledger is the shared source for the table, map, search, filters, assessments and collection questions. Star important rows, use status and tags for workflow, and select several rows for a joint assessment. The original report is preserved separately from its summary.'],
      ['Map and position', 'Cases with MGRS or latitude/longitude appear on the fully local map. Map and table use the same filters, and the current map extent can be a filter. Cases without a position remain in the ledger and appear under Missing positions.'],
      ['Excel import and export', 'XLSX is the complete Aurora copy: cases, collection questions, vocabulary and notes are included. CSV contains case rows only and suits simple table work. To import, select a file, review its preview and column mapping, then choose Merge, Append or Replace. Replace clears current content first; always export before using it.'],
      ['Local AI and assessments', 'The model runs on this computer and receives only a bounded selection from the ledger and local knowledge bank. It can structure reports, draft assessments, answer with source rows and propose collection questions. Manual features continue working while the model is disconnected.'],
      ['Wipe, uninstall and restore', 'Wipe data in Settings first receives a complete XLSX export and only then deletes working data. The teardown script creates XLSX and CSV files in exports before removing runtime and working data. Exports are normally retained and can be restored with build --restore-latest. Verify that an export opens before discarding media or an old installation.'],
    ],
    technicalSections: [
      ['Architecture and storage', 'The React/Vite client is served by a loopback Node server. SQLite stores the ledger, vocabulary, collection questions, notes, settings, weather and AI jobs. MapLibre reads only bundled GeoJSON. llama.cpp is a separate local process; no cloud service is required.'],
      ['Data and model flow', '7S text is sent to the local model under a strict JSON schema. The server validates and normalises the result before storage. Questions and assessments receive a bounded case selection and relevant local knowledge excerpts. Model output is decision support, never automatic truth.'],
      ['XLSX, CSV and merge rules', 'Aurora XLSX files have separate cases, spaningsfragor and begrepp sheets, with preserved IDs and JSON columns for lists and notes. Merge matches a preserved ID, source report ID or composite event key. Append creates new rows. Replace restores the complete working set. CSV is intentionally limited to cases.'],
      ['Release and installation', 'Run prepare_release on a trusted connected build computer. It downloads pinned artifacts, verifies SHA-256, builds and tests, creates an SBOM, and places the offline folder, ZIP and outer checksum in applicationExportFolder. On the target, extract the complete ZIP and run build.command or build.bat for verified offline installation.'],
      ['Prune/teardown and restore', 'Normal teardown stops processes, creates and validates final exports, then removes runtime, database, local packages and local configuration. exports is retained. --no-export must be explicit. --purge-exports requires the exact destructive confirmation. Build with --restore-latest imports the latest complete workbook after migration.'],
      ['Checks and troubleshooting', 'npm run check builds the client and runs unit, integration, offline-URL and licence tests. Release preparation repeats the check in staging, then validates ZIP structure and transport checksum. Logs are in data/logs. Never alter model data, runtime archives or checksums.txt inside a prepared package.'],
    ],
  },
} as const;

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { i18n } = useTranslation();
  const [audience, setAudience] = useState<HelpAudience>('user');
  useEffect(() => { if (!open) setAudience('user'); }, [open]);
  const content = i18n.language.startsWith('sv') ? help.sv : help.en;
  const sections = audience === 'user' ? content.userSections : content.technicalSections;
  return (
    <Modal open={open} eyebrow={content.eyebrow} title={content.title} wide onClose={onClose}>
      <div className="help-layout">
        <nav className="help-audience" aria-label={content.title}>
          {(['user', 'technical'] as const).map((item) => (
            <button key={item} type="button" className={audience === item ? 'is-active' : ''} aria-current={audience === item ? 'page' : undefined} onClick={() => setAudience(item)}>
              <span aria-hidden="true">{item === 'user' ? '◇' : '⌘'}</span>{content[item]}
            </button>
          ))}
        </nav>
        <article className="help-article">
          <p className="help-intro">{audience === 'user' ? content.userIntro : content.technicalIntro}</p>
          <div className="help-sections">
            {sections.map(([title, body], index) => <section key={title}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{title}</h3><p>{body}</p></div></section>)}
          </div>
        </article>
      </div>
    </Modal>
  );
}
