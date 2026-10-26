// Permet à Node d'exécuter les scripts TypeScript qui importent src/ : Node retire les
// types lui-même, mais exige l'extension que le code de src/ omet (résolution « bundler »).
// Usage : node --import ./scripts/ts-hooks.mjs scripts/<script>.ts
import { existsSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const RELATIVE = /^\.{1,2}\//;
const HAS_EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/;

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (RELATIVE.test(specifier) && !HAS_EXTENSION.test(specifier) && context.parentURL) {
      for (const extension of ['.ts', '.tsx']) {
        const url = new URL(specifier + extension, context.parentURL);
        if (existsSync(fileURLToPath(url))) return nextResolve(url.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
