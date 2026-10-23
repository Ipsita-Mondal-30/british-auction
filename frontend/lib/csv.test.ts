import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCsv } from './csv';

test('quotes commas, quotes and newlines', () => {
  assert.equal(csvCell('Swift Freight'), 'Swift Freight');
  assert.equal(csvCell('Kochi, Port'), '"Kochi, Port"');
  assert.equal(csvCell('The "Best" Co'), '"The ""Best"" Co"');
  assert.equal(csvCell('a\nb'), '"a\nb"');
  assert.equal(csvCell(null), '');
});

test('neutralises formula injection in text but not numbers', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1 555'), "'+1 555");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell(-5), '-5');
});

test('rows joined with CRLF', () => {
  assert.equal(toCsv(['a', 'b'], [[1, 'x,y']]), 'a,b\r\n1,"x,y"');
});
