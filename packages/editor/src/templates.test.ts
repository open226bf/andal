import { describe, expect, it } from 'vitest';
import { validateDoc } from './index.js';
import { PAGE_TEMPLATES, templateDoc } from './templates.js';

describe('modèles de page', () => {
  for (const template of PAGE_TEMPLATES) {
    for (const locale of ['fr', 'en'] as const) {
      it(`${template.id} (${locale}) respecte le schéma`, () => {
        const doc = templateDoc(template.id, locale);
        expect(validateDoc(doc)).toBeNull();
        const types = new Set((doc.content ?? []).map((n) => n.type));
        expect(types.has('heading')).toBe(true);
        expect(types.has('table')).toBe(true);
      });
    }
  }

  it('garde les encadrés, les cases à cocher et le code', () => {
    const runbook = templateDoc('runbook', 'fr');
    const types = (runbook.content ?? []).map((n) => n.type);
    expect(types).toContain('callout');
    expect(types).toContain('taskList');
    expect(types).toContain('codeBlock');
  });
});
