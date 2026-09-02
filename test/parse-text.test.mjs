import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// src/parse-text.js is a plain browser script defining parseMediaInfoText(); load it as a function.
const src = readFileSync(new URL('../src/parse-text.js', import.meta.url), 'utf8');
const parseMediaInfoText = new Function(src + '\nreturn parseMediaInfoText;')();

const sample = [
  'General',
  'Format                                   : MPEG-4',
  'File size                                : 31.1 KiB',
  'Title                                    : ',
  '',
  'Video',
  'Format settings, CABAC                   : Yes',
  'Display aspect ratio                     : 4:3',
  '',
  'Audio #1',
  'Format                                   : AAC LC',
  '',
  'Menu',
  '00:00:00.000                             : Chapter 1',
  '',
].join('\r\n');

test('parses sections and rows from MediaInfo text output', () => {
  const s = parseMediaInfoText(sample);
  assert.deepEqual(s.map((x) => x.title), ['General', 'Video', 'Audio #1', 'Menu']);
  assert.deepEqual(s[0].rows, [['Format', 'MPEG-4'], ['File size', '31.1 KiB'], ['Title', '']]);
  assert.deepEqual(s[1].rows, [['Format settings, CABAC', 'Yes'], ['Display aspect ratio', '4:3']]);
  assert.deepEqual(s[3].rows, [['00:00:00.000', 'Chapter 1']]);
});

test('handles empty input and rows before any header', () => {
  assert.deepEqual(parseMediaInfoText(''), []);
  const s = parseMediaInfoText('Format : X\n');
  assert.equal(s.length, 1);
  assert.equal(s[0].title, '');
  assert.deepEqual(s[0].rows, [['Format', 'X']]);
});
