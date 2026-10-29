import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';

import { resolveFileInDir, stripTags, trimDashes } from '../server/services/textSanitize.js';

describe('stripTags', () => {
  it('removes tags and keeps the text', () => {
    assert.equal(stripTags('<b>Sales</b> team'), 'Sales team');
    assert.equal(stripTags('plain'), 'plain');
    assert.equal(stripTags(null), '');
  });

  it('never leaves a tag rebuilt from nested input', () => {
    assert.equal(stripTags('<<b>script>alert(1)<</b>/script>'), 'script>alert(1)/script>');
    assert.ok(!stripTags('<scr<script>ipt>x').includes('<'));
  });

  it('drops a stray < and keeps the rest', () => {
    assert.equal(stripTags('a < b'), 'a  b');
  });

  it('stays linear on a long run of unclosed <', () => {
    const started = Date.now();
    assert.equal(stripTags('<'.repeat(200_000)), '');
    assert.ok(Date.now() - started < 1000);
  });
});

describe('trimDashes', () => {
  it('trims leading and trailing dashes only', () => {
    assert.equal(trimDashes('--my-plugin--'), 'my-plugin');
    assert.equal(trimDashes('----'), '');
    assert.equal(trimDashes('a'), 'a');
  });
});

describe('resolveFileInDir', () => {
  const dir = path.resolve('data', 'app-icon-cache');

  it('joins a plain file name to the directory', () => {
    assert.equal(resolveFileInDir(dir, 'app.123.abcd.png'), path.join(dir, 'app.123.abcd.png'));
  });

  it('refuses names that would leave the directory', () => {
    for (const name of ['../secret', '..', '.', 'sub/file.png', 'sub\\file.png', '/etc/passwd', '', null]) {
      assert.equal(resolveFileInDir(dir, name), null, String(name));
    }
  });
});
