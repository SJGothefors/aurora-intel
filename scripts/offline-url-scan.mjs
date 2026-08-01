import fs from "node:fs";
import path from "node:path";

const TEXT_EXTENSIONS = new Set([".css", ".html", ".js", ".json", ".map", ".svg", ".txt", ".xml"]);
const SCHEMED_URL = /\b(?:https?|wss?):\/\/[^\s'"`<>)\\\]}]+/gi;
const PROTOCOL_RELATIVE = /(?<!:)\/\/(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:[/?#][^\s'"`<>)\\\]}]*)?/gi;
const INERT_NAMESPACE_IDENTIFIERS = new Set([
  "http://www.w3.org/1999/xlink",
  "http://www.w3.org/XML/1998/namespace",
  "http://www.w3.org/2000/svg",
  "http://www.w3.org/1998/Math/MathML",
  "http://www.w3.org/1999/xhtml",
]);

function decodeBase64Calls(source) {
  return source.replace(/\batob\(\s*(['"`])([A-Za-z0-9+/]{8,}={0,2})\1\s*\)/g, (whole, _quote, encoded) => {
    try {
      const decoded = Buffer.from(encoded, "base64").toString("utf8");
      return /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(decoded) ? decoded : whole;
    } catch {
      return whole;
    }
  });
}

function decodeCharCodeCalls(source) {
  return source.replace(/\bString\.fromCharCode\(\s*((?:\d{1,3}\s*,\s*)*\d{1,3})\s*\)/g, (whole, values) => {
    const numbers = values.split(",").map((value) => Number.parseInt(value.trim(), 10));
    return numbers.every((value) => value >= 0 && value <= 255) ? String.fromCharCode(...numbers) : whole;
  });
}

export function normalizeEncodedUrls(source) {
  let value = source;
  for (let pass = 0; pass < 6; pass += 1) {
    const previous = value;
    value = value
      .replace(/\\u\{([0-9a-f]{1,6})\}/gi, (_whole, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/\\u([0-9a-f]{4})/gi, (_whole, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\x([0-9a-f]{2})/gi, (_whole, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\([0-7]{3})/g, (_whole, octal) => String.fromCharCode(Number.parseInt(octal, 8)))
      .replace(/&#x([0-9a-f]{1,6});?/gi, (_whole, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
      .replace(/&#(\d{1,7});?/g, (_whole, decimal) => String.fromCodePoint(Number.parseInt(decimal, 10)))
      .replace(/&(colon|sol|period);/gi, (_whole, entity) => ({ colon: ":", sol: "/", period: "." })[entity.toLowerCase()])
      .replace(/%([0-9a-f]{2})/gi, (_whole, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\\//g, "/")
      .replace(/(['"`])\s*\+\s*(['"`])/g, "")
      .replace(/\b(https?|wss?):(?:\\+|\/){2}/gi, (_whole, scheme) => `${scheme}://`);
    value = decodeBase64Calls(decodeCharCodeCalls(value));
    if (value === previous) break;
  }
  return value;
}

function isAllowedLoopback(candidate) {
  if (candidate.startsWith("//")) return false;
  try {
    const url = new URL(candidate);
    return (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "ws:" || url.protocol === "wss:")
      && (url.hostname === "127.0.0.1" || url.hostname === "localhost");
  } catch {
    return false;
  }
}

export function externalUrlsInText(source) {
  const normalized = normalizeEncodedUrls(source);
  const candidates = [...normalized.matchAll(SCHEMED_URL), ...normalized.matchAll(PROTOCOL_RELATIVE)].map((match) => match[0]);
  return [...new Set(candidates.filter((candidate) => !isAllowedLoopback(candidate) && !INERT_NAMESPACE_IDENTIFIERS.has(candidate)))];
}

export function scanBuiltAssets(rootArgument) {
  const root = path.resolve(rootArgument ?? "web/dist");
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) throw new Error(`Built frontend not found: ${root}`);
  const violations = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(filename);
      else if (entry.isFile() && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const source = fs.readFileSync(filename, "utf8");
        for (const url of externalUrlsInText(source)) violations.push({ file: path.relative(root, filename), url });
      }
    }
  }
  walk(root);
  return { root, violations };
}
