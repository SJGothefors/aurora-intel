import test from 'node:test';
import assert from 'node:assert/strict';
import { externalUrlsInText, normalizeEncodedUrls } from '../scripts/offline-url-scan.mjs';

test('offline guard rejects direct and commonly encoded external URLs', () => {
  const fixtures = [
    'https://evil.example/path',
    String.raw`https:\u002f\u002fevil.example/path`,
    String.raw`https:\x2f\x2fevil.example/path`,
    'https:%2F%2Fevil.example/path',
    'https:&#x2f;&#47;evil.example/path',
    '"https:" + "//evil.example/path"',
    'atob("aHR0cHM6Ly9ldmlsLmV4YW1wbGUvcGF0aA==")',
    'String.fromCharCode(104,116,116,112,115,58,47,47,101,118,105,108,46,101,120,97,109,112,108,101)',
    'wss://evil.example/socket',
    '//evil.example/asset.js',
    'http://localhost.evil.example/',
  ];
  for (const fixture of fixtures) assert.ok(externalUrlsInText(fixture).length > 0, fixture);
});

test('offline guard permits only explicit loopback URL hosts', () => {
  const fixture = [
    'http://127.0.0.1:8474/api/health',
    'https://localhost/local-only',
    String.raw`http:\u002f\u002f127.0.0.1:9000`,
    'ws://localhost:1234/socket',
  ].join('\n');
  assert.deepEqual(externalUrlsInText(fixture), []);
});

test('offline guard allows only the exact inert W3 DOM namespace identifiers', () => {
  const namespaces = [
    'http://www.w3.org/1999/xlink',
    'http://www.w3.org/XML/1998/namespace',
    'http://www.w3.org/2000/svg',
    'http://www.w3.org/1998/Math/MathML',
    'http://www.w3.org/1999/xhtml',
  ].join('\n');
  assert.deepEqual(externalUrlsInText(namespaces), []);
  assert.deepEqual(externalUrlsInText('http://www.w3.org/2000/svg/remote.js'), ['http://www.w3.org/2000/svg/remote.js']);
});

test('normalization reveals Vite-style escaped slashes', () => {
  assert.match(normalizeEncodedUrls(String.raw`https:\u002f\u002fexample.com`), /https:\/\/example\.com/);
});
