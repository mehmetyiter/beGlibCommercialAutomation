import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export async function loadLocalEnv(envPath = '.env.local') {
  const resolvedPath = resolve(envPath);
  let text;

  try {
    text = await readFile(resolvedPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { loaded: false, path: resolvedPath, variables: [] };
    }

    throw error;
  }

  const variables = [];

  text.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      return;
    }

    const normalizedLine = line.startsWith('export ') ? line.slice(7).trim() : line;
    const equalsIndex = normalizedLine.indexOf('=');
    if (equalsIndex <= 0) {
      return;
    }

    const key = normalizedLine.slice(0, equalsIndex).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
      return;
    }

    if (typeof process.env[key] !== 'undefined') {
      return;
    }

    const value = normalizeValue(normalizedLine.slice(equalsIndex + 1));
    if (!value) {
      return;
    }

    process.env[key] = value;
    variables.push(key);
  });

  return { loaded: true, path: resolvedPath, variables };
}

function normalizeValue(value) {
  const trimmedValue = value.trim();
  const quote = trimmedValue[0];
  const lastCharacter = trimmedValue[trimmedValue.length - 1];

  if ((quote === '"' || quote === "'") && lastCharacter === quote) {
    return trimmedValue.slice(1, -1);
  }

  return trimmedValue;
}
