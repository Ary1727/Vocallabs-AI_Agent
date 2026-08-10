import { evaluateCondition, ConditionEvaluationError } from './conditionEvaluator';

describe('evaluateCondition', () => {
  test('numeric greater-than comparison', () => {
    expect(evaluateCondition('output.length > 100', { length: 150 })).toBe(true);
    expect(evaluateCondition('output.length > 100', { length: 50 })).toBe(false);
  });

  test('string length via .length works on a raw string output', () => {
    expect(evaluateCondition('output.length > 5', 'hello world')).toBe(true);
    expect(evaluateCondition('output.length > 50', 'hello')).toBe(false);
  });

  test('nested property access', () => {
    const output = { metrics: { confidence: 0.92 } };
    expect(evaluateCondition('output.metrics.confidence >= 0.9', output)).toBe(true);
    expect(evaluateCondition('output.metrics.confidence >= 0.95', output)).toBe(false);
  });

  test('string equality with quoted literal', () => {
    expect(evaluateCondition("output.status == 'approved'", { status: 'approved' })).toBe(true);
    expect(evaluateCondition("output.status == 'approved'", { status: 'rejected' })).toBe(false);
  });

  test('boolean literal comparison', () => {
    expect(evaluateCondition('output.success == true', { success: true })).toBe(true);
    expect(evaluateCondition('output.success == true', { success: false })).toBe(false);
  });

  test('not-equal operator', () => {
    expect(evaluateCondition("output.status != 'failed'", { status: 'ok' })).toBe(true);
    expect(evaluateCondition("output.status != 'failed'", { status: 'failed' })).toBe(false);
  });

  test('missing/undefined path resolves to undefined, not a throw', () => {
    expect(evaluateCondition('output.nonexistent > 5', { other: 1 })).toBe(false);
  });

  test('rejects a condition with no recognized operator', () => {
    expect(() => evaluateCondition('output.length', { length: 5 })).toThrow(ConditionEvaluationError);
  });

  test('rejects a condition that does not reference output', () => {
    expect(() => evaluateCondition('someOtherThing > 5', {})).toThrow(ConditionEvaluationError);
  });

  test('rejects an unparseable right-hand literal', () => {
    expect(() => evaluateCondition('output.value == not_quoted_and_not_a_number', {})).toThrow(
      ConditionEvaluationError
    );
  });

  test('security: does not execute arbitrary code even if someone tries', () => {
    // If this were implemented with eval()/Function(), a condition like
    // this could execute arbitrary JS. Confirming it's treated as an
    // ordinary (failing) parse instead.
    let sideEffectRan = false;
    const maliciousCondition = "output.length > (globalThis.sideEffectRan = true, 0)";
    expect(() => evaluateCondition(maliciousCondition, { length: 5 })).toThrow(ConditionEvaluationError);
    expect(sideEffectRan).toBe(false);
    expect((globalThis as Record<string, unknown>).sideEffectRan).toBeUndefined();
  });
});
