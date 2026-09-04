import { describe, expect, it } from 'vitest';
import { emptyState, escapeHtml } from './dom.js';
describe('DOM safety',()=>{it('escapes customer text',()=>expect(escapeHtml('<script>alert(1)</script>')).toContain('&lt;script&gt;'));it('renders empty state as text',()=>{const element=emptyState('<unsafe>');expect(element.textContent).toBe('<unsafe>');});});
