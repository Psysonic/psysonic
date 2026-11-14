import { describe, expect, it } from 'vitest';
import { PasswordEdgeSpaceHint } from '@/ui/PasswordEdgeSpaceHint';
import { renderWithProviders } from '@/test/helpers/renderWithProviders';

function hintFor(password: string, language?: string): HTMLElement {
  const view = renderWithProviders(
    <PasswordEdgeSpaceHint id="hint" password={password} />,
    language ? { language } : undefined,
  );
  return view.getByRole('status');
}

describe('PasswordEdgeSpaceHint', () => {
  it.each([' secret', 'secret ', '\tsecret', 'secret\n'])(
    'warns when the password has whitespace at an edge (%j)',
    password => {
      const region = hintFor(password);
      expect(region).toHaveAttribute('id', 'hint');
      expect(region).toHaveTextContent(/starts or ends with a space/i);
    },
  );

  it.each(['sec ret', 'secret', ''])(
    'keeps the live region mounted but empty otherwise (%j)',
    password => {
      expect(hintFor(password)).toBeEmptyDOMElement();
    },
  );

  it('uses the app language for the warning', () => {
    expect(hintFor('secret ', 'de')).toHaveTextContent(/Leerzeichen/);
  });
});
