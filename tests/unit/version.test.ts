import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

describe('version', () => {
  it('l’installeur Windows porte la version de package.json', () => {
    const { version } = JSON.parse(read('../../package.json')) as { version: string };
    const iss = /#define MyAppVersion "([^"]+)"/.exec(read('../../installer/ChessAnalyser.iss'));
    expect(iss?.[1]).toBe(version);
  });
});
