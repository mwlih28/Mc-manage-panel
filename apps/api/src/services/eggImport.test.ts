import { describe, it, expect } from 'vitest';
import { normalizeScript, parsePterodactylEgg } from './eggImport';

describe('normalizeScript', () => {
  it('converts CRLF line endings to LF', () => {
    expect(normalizeScript('line1\r\nline2\r\nline3')).toBe('line1\nline2\nline3');
  });

  it('converts lone CR line endings to LF', () => {
    expect(normalizeScript('line1\rline2')).toBe('line1\nline2');
  });

  it('leaves already-normalized scripts untouched', () => {
    expect(normalizeScript('line1\nline2\n')).toBe('line1\nline2\n');
  });

  it('passes through null/empty unchanged', () => {
    expect(normalizeScript(null)).toBeNull();
    expect(normalizeScript(undefined)).toBeNull();
    expect(normalizeScript('')).toBe('');
  });
});

describe('parsePterodactylEgg — CRLF handling', () => {
  // Regression test: a real-world community egg (e.g. 7 Days to Die) whose
  // install script was authored/exported with Windows line endings used to
  // fail on Wings with "$'\r': command not found" and a syntax error at the
  // last line, because the raw CRLF script was stored verbatim.
  const baseEgg = {
    name: '7 Days to Die',
    author: 'community@import',
    docker_images: { 'Default': 'ghcr.io/example/7dtd:latest' },
    startup: './7DaysToDieServer.x86_64',
    config: {},
    scripts: {
      installation: {
        script: 'apt-get update\r\napt-get install -y curl\r\ncurl -o server.zip https://example.com\r\n',
        container: 'debian:bullseye-slim',
        entrypoint: 'bash',
      },
    },
  };

  it('strips CRLF from the install script on import', async () => {
    const parsed = await parsePterodactylEgg(baseEgg);
    expect(parsed.scriptInstall).not.toBeNull();
    expect(parsed.scriptInstall).not.toContain('\r');
    expect(parsed.scriptInstall).toBe('apt-get update\napt-get install -y curl\ncurl -o server.zip https://example.com\n');
  });
});
