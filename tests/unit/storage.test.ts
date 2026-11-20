import { beforeEach, describe, expect, it } from 'vitest';
import { loadPrefs, savePrefs } from '../../src/storage';

const KEY = 'chessanalyser:v1';

beforeEach(() => localStorage.clear());

describe('préférences locales', () => {
  it('mémorise le pseudo et le préréglage sans que l’un efface l’autre', () => {
    savePrefs({ lastUsername: 'testeur' });
    savePrefs({ preset: 'deep' });
    expect(loadPrefs()).toEqual({ lastUsername: 'testeur', preset: 'deep' });
    savePrefs({ lastUsername: 'autre' });
    expect(loadPrefs()).toEqual({ lastUsername: 'autre', preset: 'deep' });
  });

  it('ignore les valeurs invalides ou illisibles', () => {
    localStorage.setItem(KEY, JSON.stringify({ lastUsername: 42, preset: 'ultra' }));
    expect(loadPrefs()).toEqual({});
    localStorage.setItem(KEY, '{pas du json');
    expect(loadPrefs()).toEqual({});
    localStorage.setItem(KEY, 'null');
    expect(loadPrefs()).toEqual({});
  });
});
