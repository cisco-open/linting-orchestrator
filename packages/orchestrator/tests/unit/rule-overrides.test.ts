/**
 * Unit tests for rule override post-filter logic
 * 
 * Tests the applyRuleOverrides function that runs in workers
 * and the CLI override parsing logic.
 */

import { describe, it, expect } from 'vitest';

// ============================================
// Re-implement applyRuleOverrides for testing
// (The original lives in worker.ts which runs in worker_threads context)
// ============================================

const SEVERITY_MAP: Record<string, number> = { error: 0, warn: 1, info: 2, hint: 3 };

function applyRuleOverrides(
  diagnostics: any[],
  overrides: Record<string, string>
): any[] {
  return diagnostics
    .filter(d => overrides[d.code] !== 'off')
    .map(d => {
      const override = overrides[d.code];
      if (override && override !== 'off' && SEVERITY_MAP[override] !== undefined) {
        return { ...d, severity: SEVERITY_MAP[override] };
      }
      return d;
    });
}

// ============================================
// CLI override parser (mirrors lint.ts logic — now accepts string[])
// ============================================

function parseOverrides(input: string | string[]): Record<string, string> | undefined {
  const validSeverities = new Set(['off', 'error', 'warn', 'info', 'hint']);
  const overrides: Record<string, string> = {};
  const inputs = Array.isArray(input) ? input : [input];
  const entries = inputs.flatMap(o => o.split(','));
  for (const entry of entries) {
    const trimmed = entry.trim();
    if (!trimmed) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) {
      overrides[trimmed] = 'off';
    } else {
      const ruleId = trimmed.slice(0, eqIdx).trim();
      const severity = trimmed.slice(eqIdx + 1).trim().toLowerCase();
      if (!ruleId || !validSeverities.has(severity)) {
        return undefined; // invalid
      }
      overrides[ruleId] = severity;
    }
  }
  return Object.keys(overrides).length > 0 ? overrides : undefined;
}

// ============================================
// Test Data
// ============================================

const sampleDiagnostics = [
  { code: 'operationId-required', message: 'Missing operationId', severity: 0, path: ['paths', '/test'] },
  { code: 'error-status-code', message: 'Missing error code', severity: 1, path: ['paths', '/test', 'get'] },
  { code: 'description-required', message: 'Missing description', severity: 2, path: ['info'] },
  { code: 'contact-info', message: 'Missing contact', severity: 3, path: ['info'] },
];

// ============================================
// Tests: applyRuleOverrides
// ============================================

describe('applyRuleOverrides', () => {
  it('should return all diagnostics when overrides map is empty', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {});
    expect(result).toHaveLength(4);
    expect(result).toEqual(sampleDiagnostics);
  });

  it('should exclude rules set to off', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'operationId-required': 'off'
    });
    expect(result).toHaveLength(3);
    expect(result.find(d => d.code === 'operationId-required')).toBeUndefined();
  });

  it('should exclude multiple rules set to off', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'operationId-required': 'off',
      'contact-info': 'off'
    });
    expect(result).toHaveLength(2);
    expect(result.map(d => d.code)).toEqual(['error-status-code', 'description-required']);
  });

  it('should remap severity for overridden rules', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'error-status-code': 'error'  // warn(1) → error(0)
    });
    expect(result).toHaveLength(4);
    const overridden = result.find(d => d.code === 'error-status-code');
    expect(overridden?.severity).toBe(0);
  });

  it('should remap severity to hint', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'operationId-required': 'hint'  // error(0) → hint(3)
    });
    const overridden = result.find(d => d.code === 'operationId-required');
    expect(overridden?.severity).toBe(3);
  });

  it('should handle both off and severity overrides together', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'operationId-required': 'off',
      'error-status-code': 'info',
      'contact-info': 'warn'
    });
    expect(result).toHaveLength(3);
    expect(result.find(d => d.code === 'operationId-required')).toBeUndefined();
    expect(result.find(d => d.code === 'error-status-code')?.severity).toBe(2); // info
    expect(result.find(d => d.code === 'contact-info')?.severity).toBe(1); // warn
  });

  it('should not modify diagnostics for rules not in overrides', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'nonexistent-rule': 'off'
    });
    expect(result).toHaveLength(4);
    expect(result).toEqual(sampleDiagnostics);
  });

  it('should preserve original diagnostic properties', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'error-status-code': 'error'
    });
    const overridden = result.find(d => d.code === 'error-status-code');
    expect(overridden?.message).toBe('Missing error code');
    expect(overridden?.path).toEqual(['paths', '/test', 'get']);
  });

  it('should not mutate original diagnostics', () => {
    const original = [...sampleDiagnostics.map(d => ({ ...d }))];
    applyRuleOverrides(sampleDiagnostics, {
      'error-status-code': 'error',
      'operationId-required': 'off'
    });
    expect(sampleDiagnostics).toEqual(original);
  });

  it('should return empty array when all rules are turned off', () => {
    const result = applyRuleOverrides(sampleDiagnostics, {
      'operationId-required': 'off',
      'error-status-code': 'off',
      'description-required': 'off',
      'contact-info': 'off'
    });
    expect(result).toHaveLength(0);
  });

  it('should return empty array when input is empty', () => {
    const result = applyRuleOverrides([], { 'some-rule': 'off' });
    expect(result).toHaveLength(0);
  });
});

// ============================================
// Tests: CLI override parsing
// ============================================

describe('parseOverrides (CLI)', () => {
  it('should parse simple rule=severity pairs', () => {
    expect(parseOverrides('rule1=off,rule2=warn')).toEqual({
      'rule1': 'off',
      'rule2': 'warn'
    });
  });

  it('should treat bare rule names as off', () => {
    expect(parseOverrides('rule1')).toEqual({ 'rule1': 'off' });
  });

  it('should handle mixed bare and severity pairs', () => {
    expect(parseOverrides('rule1,rule2=warn,rule3=error')).toEqual({
      'rule1': 'off',
      'rule2': 'warn',
      'rule3': 'error'
    });
  });

  it('should handle all valid severity levels', () => {
    expect(parseOverrides('r1=off,r2=error,r3=warn,r4=info,r5=hint')).toEqual({
      'r1': 'off',
      'r2': 'error',
      'r3': 'warn',
      'r4': 'info',
      'r5': 'hint'
    });
  });

  it('should be case-insensitive for severity', () => {
    expect(parseOverrides('rule1=WARN,rule2=Error')).toEqual({
      'rule1': 'warn',
      'rule2': 'error'
    });
  });

  it('should return undefined for invalid severity', () => {
    expect(parseOverrides('rule1=invalid')).toBeUndefined();
  });

  it('should return undefined for empty rule ID', () => {
    expect(parseOverrides('=off')).toBeUndefined();
  });

  it('should return undefined for empty input', () => {
    expect(parseOverrides('')).toBeUndefined();
  });

  it('should handle whitespace around entries', () => {
    expect(parseOverrides(' rule1 = off , rule2 = warn ')).toEqual({
      'rule1': 'off',
      'rule2': 'warn'
    });
  });

  it('should handle rule IDs with hyphens and dots', () => {
    expect(parseOverrides('operationId-required=off,my.custom.rule=warn')).toEqual({
      'operationId-required': 'off',
      'my.custom.rule': 'warn'
    });
  });

  // Array input tests (repeated --override flags)
  it('should accept an array of override strings', () => {
    expect(parseOverrides(['rule1=off', 'rule2=warn'])).toEqual({
      'rule1': 'off',
      'rule2': 'warn'
    });
  });

  it('should merge comma-separated and array entries', () => {
    expect(parseOverrides(['rule1=off,rule2=warn', 'rule3=error'])).toEqual({
      'rule1': 'off',
      'rule2': 'warn',
      'rule3': 'error'
    });
  });

  it('should handle single-element array', () => {
    expect(parseOverrides(['rule1=off'])).toEqual({ 'rule1': 'off' });
  });

  it('should handle empty array', () => {
    expect(parseOverrides([])).toBeUndefined();
  });

  it('should let later entries override earlier ones', () => {
    expect(parseOverrides(['rule1=off', 'rule1=warn'])).toEqual({ 'rule1': 'warn' });
  });
});

// ============================================
// Tests: formatRulesetDisplay and formatRulesetShort
// ============================================

// Import actual formatter functions
import { formatRulesetDisplay, formatRulesetShort } from '../../src/cli/formatters.js';

describe('formatRulesetDisplay', () => {
  it('should show name and version without overrides', () => {
    const result = formatRulesetDisplay('pubhub', '1.1.0');
    expect(result).toBe('pubhub v1.1.0');
  });

  it('should show name and version with undefined overrides', () => {
    const result = formatRulesetDisplay('pubhub', '1.1.0', undefined);
    expect(result).toBe('pubhub v1.1.0');
  });

  it('should show name and version with empty overrides', () => {
    const result = formatRulesetDisplay('pubhub', '1.1.0', {});
    expect(result).toBe('pubhub v1.1.0');
  });

  it('should show excluded count', () => {
    const result = formatRulesetDisplay('pubhub', '1.1.0', {
      'rule1': 'off',
      'rule2': 'off'
    });
    expect(result).toBe('pubhub v1.1.0 (2 rules excluded)');
  });

  it('should show severity override count', () => {
    const result = formatRulesetDisplay('pubhub', '1.1.0', {
      'rule1': 'warn',
      'rule2': 'error'
    });
    expect(result).toBe('pubhub v1.1.0 (2 severity overrides)');
  });

  it('should show both excluded and severity counts', () => {
    const result = formatRulesetDisplay('pubhub', '1.1.0', {
      'rule1': 'off',
      'rule2': 'off',
      'rule3': 'warn'
    });
    expect(result).toBe('pubhub v1.1.0 (2 rules excluded, 1 severity override)');
  });

  it('should use singular forms correctly', () => {
    const result = formatRulesetDisplay('pubhub', '1.1.0', {
      'rule1': 'off'
    });
    expect(result).toBe('pubhub v1.1.0 (1 rule excluded)');
  });
});

describe('formatRulesetShort', () => {
  it('should return plain name without overrides', () => {
    expect(formatRulesetShort('pubhub')).toBe('pubhub');
  });

  it('should return plain name with undefined overrides', () => {
    expect(formatRulesetShort('pubhub', undefined)).toBe('pubhub');
  });

  it('should return plain name with empty overrides', () => {
    expect(formatRulesetShort('pubhub', {})).toBe('pubhub');
  });

  it('should append * when overrides present', () => {
    expect(formatRulesetShort('pubhub', { 'rule1': 'off' })).toBe('pubhub*');
  });
});
