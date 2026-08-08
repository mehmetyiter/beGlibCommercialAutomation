import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const TOKEN_PATH = resolve('data/.outreach-server-token.local');

/**
 * The dashboard never holds this token: the Vite dev proxy reads it server-side and
 * injects it on the way through, so a page in another tab cannot reach the send API
 * even though it listens on loopback.
 */
export async function resolveServerToken(env = process.env, { create = false } = {}) {
  const fromEnv = typeof env.OUTREACH_SERVER_TOKEN === 'string' ? env.OUTREACH_SERVER_TOKEN.trim() : '';

  if (fromEnv) {
    return fromEnv;
  }

  try {
    const stored = (await readFile(TOKEN_PATH, 'utf8')).trim();

    if (stored) {
      return stored;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      throw error;
    }
  }

  if (!create) {
    return '';
  }

  const generated = randomBytes(32).toString('hex');

  await mkdir(dirname(TOKEN_PATH), { recursive: true });
  await writeFile(TOKEN_PATH, `${generated}\n`, { encoding: 'utf8', mode: 0o600 });

  return generated;
}

export function timingSafeEqualString(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) {
    return false;
  }

  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) {
    mismatch |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return mismatch === 0;
}
