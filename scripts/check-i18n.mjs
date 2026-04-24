import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const DICTIONARIES = [
  { locale: 'en', file: path.join(repoRoot, 'src', 'i18n', 'en.json') },
  { locale: 'it', file: path.join(repoRoot, 'src', 'i18n', 'it.json') },
];

function lineOf(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text[i] === '\n') line += 1;
  }
  return line;
}

function scanDuplicates(text, fileLabel) {
  let i = 0;
  const duplicates = [];

  function skipWhitespace() {
    while (i < text.length && /\s/.test(text[i])) i += 1;
  }

  function parseString() {
    if (text[i] !== '"') {
      throw new Error(`${fileLabel}: expected string at offset ${i}`);
    }
    i += 1;
    let out = '';
    while (i < text.length) {
      const ch = text[i];
      i += 1;
      if (ch === '"') return out;
      if (ch === '\\') {
        if (i >= text.length) {
          throw new Error(`${fileLabel}: invalid escape at offset ${i}`);
        }
        const esc = text[i];
        i += 1;
        out += `\\${esc}`;
        if (esc === 'u') {
          out += text.slice(i, i + 4);
          i += 4;
        }
      } else {
        out += ch;
      }
    }
    throw new Error(`${fileLabel}: unterminated string`);
  }

  function parsePrimitive() {
    while (i < text.length && !/[\s,\]}]/.test(text[i])) i += 1;
  }

  function parseArray(pathSegments) {
    i += 1;
    skipWhitespace();
    if (text[i] === ']') {
      i += 1;
      return;
    }
    while (i < text.length) {
      parseValue(pathSegments);
      skipWhitespace();
      if (text[i] === ',') {
        i += 1;
        skipWhitespace();
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        return;
      }
      throw new Error(`${fileLabel}: expected , or ] at offset ${i}`);
    }
    throw new Error(`${fileLabel}: unterminated array`);
  }

  function parseObject(pathSegments) {
    i += 1;
    skipWhitespace();
    const seen = new Map();
    if (text[i] === '}') {
      i += 1;
      return;
    }
    while (i < text.length) {
      const keyOffset = i;
      const key = parseString();
      const fullPath = [...pathSegments, key].join('.');
      const keyLine = lineOf(text, keyOffset);
      if (seen.has(key)) {
        duplicates.push({
          path: fullPath,
          firstLine: seen.get(key),
          secondLine: keyLine,
        });
      } else {
        seen.set(key, keyLine);
      }
      skipWhitespace();
      if (text[i] !== ':') {
        throw new Error(`${fileLabel}: expected : at offset ${i}`);
      }
      i += 1;
      skipWhitespace();
      parseValue([...pathSegments, key]);
      skipWhitespace();
      if (text[i] === ',') {
        i += 1;
        skipWhitespace();
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        return;
      }
      throw new Error(`${fileLabel}: expected , or } at offset ${i}`);
    }
    throw new Error(`${fileLabel}: unterminated object`);
  }

  function parseValue(pathSegments) {
    skipWhitespace();
    if (i >= text.length) {
      throw new Error(`${fileLabel}: unexpected end of file`);
    }
    const ch = text[i];
    if (ch === '{') return parseObject(pathSegments);
    if (ch === '[') return parseArray(pathSegments);
    if (ch === '"') return parseString();
    return parsePrimitive();
  }

  parseValue([]);
  skipWhitespace();
  return duplicates;
}

function flattenObject(value, prefix = '', out = new Map()) {
  if (Array.isArray(value)) {
    out.set(prefix, value);
    return out;
  }

  if (value && typeof value === 'object') {
    for (const [key, nested] of Object.entries(value)) {
      const nextPath = prefix ? `${prefix}.${key}` : key;
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        flattenObject(nested, nextPath, out);
      } else {
        out.set(nextPath, nested);
      }
    }
  }

  return out;
}

export function analyzeI18n() {
  const results = DICTIONARIES.map(({ locale, file }) => {
    const text = fs.readFileSync(file, 'utf8');
    const duplicates = scanDuplicates(text, file);
    const parsed = JSON.parse(text);
    const flattened = flattenObject(parsed);
    return { locale, file, duplicates, flattened };
  });

  const [base, ...others] = results;
  const mismatches = [];

  for (const result of others) {
    const onlyBase = [...base.flattened.keys()].filter((key) => !result.flattened.has(key)).sort();
    const onlyCurrent = [...result.flattened.keys()].filter((key) => !base.flattened.has(key)).sort();
    if (onlyBase.length || onlyCurrent.length) {
      mismatches.push({
        base: base.locale,
        compare: result.locale,
        onlyBase,
        onlyCurrent,
      });
    }
  }

  return {
    duplicates: results.flatMap((result) =>
      result.duplicates.map((duplicate) => ({ locale: result.locale, ...duplicate })),
    ),
    mismatches,
    counts: Object.fromEntries(results.map((result) => [result.locale, result.flattened.size])),
  };
}

export function formatI18nReport(report) {
  const lines = [];

  if (report.duplicates.length === 0 && report.mismatches.length === 0) {
    lines.push(`I18n check passed. Keys aligned: ${Object.entries(report.counts).map(([locale, count]) => `${locale}=${count}`).join(', ')}`);
    return lines.join('\n');
  }

  if (report.duplicates.length > 0) {
    lines.push('Duplicate keys detected:');
    for (const duplicate of report.duplicates) {
      lines.push(`- [${duplicate.locale}] ${duplicate.path} (lines ${duplicate.firstLine} and ${duplicate.secondLine})`);
    }
  }

  if (report.mismatches.length > 0) {
    for (const mismatch of report.mismatches) {
      lines.push(`Key mismatch between ${mismatch.base} and ${mismatch.compare}:`);
      if (mismatch.onlyBase.length > 0) {
        lines.push(`- Only in ${mismatch.base}: ${mismatch.onlyBase.join(', ')}`);
      }
      if (mismatch.onlyCurrent.length > 0) {
        lines.push(`- Only in ${mismatch.compare}: ${mismatch.onlyCurrent.join(', ')}`);
      }
    }
  }

  return lines.join('\n');
}

function main() {
  const report = analyzeI18n();
  const hasIssues = report.duplicates.length > 0 || report.mismatches.length > 0;
  const output = formatI18nReport(report);
  if (hasIssues) {
    console.error(output);
    process.exitCode = 1;
    return;
  }
  console.log(output);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
