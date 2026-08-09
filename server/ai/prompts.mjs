import fs from 'node:fs';
import path from 'node:path';

const FALLBACKS = Object.freeze({
  SYSTEM: `Du är AURORA, en erfaren svensk underrättelseofficer och analytiker vid en militär stab. Du arbetar metodiskt och noggrant. Regler:
1. Du hittar aldrig på uppgifter. Saknas information anger du null och listar fältet i fields_uncertain.
2. Du skiljer alltid strikt mellan FAKTA och BEDÖMNING.
3. Bedömningar använder enbart den angivna sannolikhetsskalan.
4. Använd bifogad kunskapsbank endast som analytisk kontext, aldrig som påhittade fakta.
5. Begrepp väljer du ENDAST ur listan i anropet. Passar inget: ÖVRIGT/OKÄNT.
6. Svara exakt i begärt JSON-format utan text utanför JSON.`,
  A1: 'Strukturera den bifogade texten som noll eller flera separata 7S-rapporter. Bevara råvärden och markera osäkerhet.',
  A3: 'Föreslå högst fem konkreta och besvarbara spaningsfrågor. Länka endast verkliga ärende-id och undvik dubbletter.',
  A4: 'Besvara frågan endast med stöd i bifogade rader. Ange exakt vilka ärende-id som stödjer svaret. Säg tydligt när underlaget inte räcker.',
  A5: 'Skilj FAKTA från BEDÖMNING. Bedöm endast utifrån bifogade ärenden och kunskapsutdrag, med angiven sannolikhetsskala.',
});

function markedSection(markdown, key) {
  const expression = new RegExp(`<!--\\s*AURORA:${key}:START\\s*-->([\\s\\S]*?)<!--\\s*AURORA:${key}:END\\s*-->`, 'i');
  return markdown.match(expression)?.[1]?.trim() ?? null;
}

function headedSection(markdown, key) {
  const lines = markdown.split(/\r?\n/);
  const matcher = key === 'SYSTEM'
    ? /^#{1,3}\s+.*(?:SYSTEM|PERSONA)/i
    : new RegExp(`^#{1,3}\\s+.*\\b${key}\\b`, 'i');
  const start = lines.findIndex((line) => matcher.test(line));
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)?.[0].length ?? 2;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    const heading = lines[index].match(/^(#+)\s+/);
    if (heading && heading[1].length <= level) { end = index; break; }
  }
  const content = lines.slice(start + 1, end).join('\n').trim();
  return content.replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').replace(/^> ?/gm, '').trim() || null;
}

export class PromptStore {
  constructor(docsDir) {
    this.filenames = [path.join(docsDir, 'technical', 'PROMPTS.md'), path.join(docsDir, 'PROMPTS.md')];
  }

  load(key) {
    const normalized = String(key).toUpperCase();
    let markdown = '';
    for (const filename of this.filenames) {
      try { markdown = fs.readFileSync(filename, 'utf8'); break; } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
    }
    return markedSection(markdown, normalized) ?? headedSection(markdown, normalized) ?? FALLBACKS[normalized];
  }

  render(key, values = {}) {
    let prompt = this.load(key);
    for (const [name, value] of Object.entries(values)) {
      const rendered = typeof value === 'string' ? value : JSON.stringify(value);
      prompt = prompt.replace(new RegExp(`{{\\s*${name}\\s*}}`, 'g'), () => rendered ?? 'null');
    }
    return prompt;
  }
}
