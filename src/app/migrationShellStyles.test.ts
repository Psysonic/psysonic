import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('canonical migration shell styles', () => {
  it('does not depend on inline styles that packaged webviews may reject', () => {
    const main = readFileSync(resolve(process.cwd(), 'src/main.tsx'), 'utf8');
    const shellStart = main.indexOf('rootElement.innerHTML = `');
    const shellEnd = main.indexOf('\n  `;\n  if (error)', shellStart);

    expect(shellStart).toBeGreaterThan(-1);
    expect(shellEnd).toBeGreaterThan(shellStart);

    const shell = main.slice(shellStart, shellEnd);
    expect(shell).not.toContain('style=');
    expect(shell).toContain('class="canonical-migration-shell"');
    expect(shell).toContain('class="canonical-migration-panel"');
    expect(shell).toContain('<progress class="canonical-migration-progress-bar"');
    expect(shell).toContain('aria-labelledby="canonical-migration-progress-label"');
    expect(main).toContain("import './styles/layout/index.css';");
  });

  it('loads the shell stylesheet through the startup CSS graph', () => {
    const layoutIndex = readFileSync(resolve(process.cwd(), 'src/styles/layout/index.css'), 'utf8');
    const shellCss = readFileSync(
      resolve(process.cwd(), 'src/styles/layout/canonical-migration-shell.css'),
      'utf8',
    );

    expect(layoutIndex).toContain("@import './canonical-migration-shell.css';");
    expect(shellCss).toContain('.canonical-migration-shell');
    expect(shellCss).toContain('.canonical-migration-panel');
    expect(shellCss).toContain('-webkit-appearance: none');
    expect(shellCss).toContain('.canonical-migration-progress-bar::-webkit-progress-bar');
    expect(shellCss).toContain('.canonical-migration-progress-bar::-webkit-progress-value');
    expect(shellCss).toContain('.canonical-migration-progress-bar::-moz-progress-bar');
  });
});
