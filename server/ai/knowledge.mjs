import fs from 'node:fs';
import path from 'node:path';

function parseArray(value) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (text.startsWith('[') && text.endsWith(']')) {
    return text.slice(1, -1).split(',').map((item) => item.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  }
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

function parseDocument(filename, source) {
  let metadata = {};
  let body = source;
  const frontMatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?/);
  if (frontMatter) {
    body = source.slice(frontMatter[0].length);
    for (const line of frontMatter[1].split(/\r?\n/)) {
      const match = line.match(/^([a-zA-Z_][\w-]*):\s*(.*)$/);
      if (!match) continue;
      metadata[match[1]] = ['tags', 'actors', 'begrepp'].includes(match[1]) ? parseArray(match[2]) : match[2].replace(/^['"]|['"]$/g, '');
    }
  }
  return { filename, id: metadata.id ?? path.basename(filename, '.md'), metadata, body };
}

function terms(value) {
  const source = Array.isArray(value) ? value.join(' ') : String(value ?? '');
  return [...new Set((source.toLocaleLowerCase('sv-SE').match(/[\p{L}\p{N}/-]{3,}/gu) ?? []))];
}

function paragraphs(document) {
  return document.body.split(/\n\s*\n/).map((text) => text.trim()).filter(Boolean)
    .map((text, index) => ({ document, text, index }));
}

export class KnowledgeSelector {
  constructor(directory, { maxChars = 6000 } = {}) {
    this.directory = directory;
    this.maxChars = maxChars;
  }

  documents() {
    let filenames = [];
    try { filenames = fs.readdirSync(this.directory).filter((name) => name.endsWith('.md')).sort(); }
    catch (error) { if (error?.code !== 'ENOENT') throw error; }
    return filenames.map((filename) => parseDocument(filename, fs.readFileSync(path.join(this.directory, filename), 'utf8')));
  }

  select(context = {}) {
    const queryTerms = terms([context.question, context.aktor, ...(context.begrepp ?? []), ...(context.keywords ?? [])]);
    const candidates = this.documents().flatMap(paragraphs).map((paragraph) => {
      const haystack = [paragraph.document.id, paragraph.document.filename,
        ...(paragraph.document.metadata.tags ?? []), ...(paragraph.document.metadata.actors ?? []),
        ...(paragraph.document.metadata.begrepp ?? []), paragraph.text].join(' ').toLocaleLowerCase('sv-SE');
      const base = paragraph.document.id === 'und_grund' ? 20 : 0;
      const score = base + queryTerms.reduce((sum, term) => sum + (haystack.includes(term) ? 5 : 0), 0)
        + (paragraph.index === 0 ? 1 : 0);
      return { ...paragraph, score };
    }).filter((candidate) => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.document.filename.localeCompare(b.document.filename) || a.index - b.index);

    const selected = [];
    let used = 0;
    const seen = new Set();
    for (const candidate of candidates) {
      const key = `${candidate.document.filename}:${candidate.index}`;
      if (seen.has(key)) continue;
      const excerpt = `[${candidate.document.metadata.title ?? candidate.document.id}]\n${candidate.text}`;
      if (used && used + excerpt.length + 2 > this.maxChars) continue;
      selected.push(excerpt.slice(0, this.maxChars - used));
      used += excerpt.length + 2;
      seen.add(key);
      if (used >= this.maxChars) break;
    }
    return selected.join('\n\n');
  }
}
