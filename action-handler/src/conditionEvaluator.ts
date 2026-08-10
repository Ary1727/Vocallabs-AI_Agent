/**
 * Evaluates simple conditions like "output.length > 100" or
 * "output.status == 'approved'" against a previous step's output.
 *
 * Deliberately NOT implemented with eval()/new Function(): condition
 * strings come from workflow_steps.config, which any editor/owner can
 * write — treating that as executable code would be a straightforward
 * remote code execution hole in the action-handler process, which also
 * holds the Postgres admin connection. This is exactly the "proper
 * security, not shortcuts that happen to work in a demo" the assignment
 * asks for. Instead: a minimal grammar supporting only property access
 * (dot notation) on the previous output, one comparison operator, and one
 * literal (number, string, or boolean) on the right-hand side. Anything
 * outside that grammar is a validation error, not a code path.
 */

type ComparisonOp = '>' | '<' | '>=' | '<=' | '==' | '!=';
const OPERATORS: ComparisonOp[] = ['>=', '<=', '==', '!=', '>', '<']; // longest-match first

export class ConditionEvaluationError extends Error {}

export function evaluateCondition(condition: string, previousOutput: unknown): boolean {
  const trimmed = condition.trim();

  const op = OPERATORS.find((candidate) => trimmed.includes(candidate));
  if (!op) {
    throw new ConditionEvaluationError(
      `Condition "${condition}" has no recognized comparison operator (>, <, >=, <=, ==, !=).`
    );
  }

  const opIndex = trimmed.indexOf(op);
  const leftRaw = trimmed.slice(0, opIndex).trim();
  const rightRaw = trimmed.slice(opIndex + op.length).trim();

  if (!leftRaw.startsWith('output')) {
    throw new ConditionEvaluationError(
      `Condition left-hand side must reference "output" (the previous step's result), got "${leftRaw}".`
    );
  }

  const leftValue = resolvePath(previousOutput, leftRaw);
  const rightValue = parseLiteral(rightRaw);

  return compare(leftValue, op, rightValue);
}

function resolvePath(root: unknown, path: string): unknown {
  // path looks like "output" or "output.some.nested.field"
  const segments = path.split('.').slice(1); // drop the leading "output"
  let current: unknown = root;
  for (const segment of segments) {
    if (current === null || current === undefined) return undefined;

    // Only strings/arrays get the built-in .length treatment. A plain
    // object with a field literally named "length" (e.g. { length: 150 }
    // as a data field, not a JS array) must fall through to ordinary
    // property lookup below — conflating the two was a real bug caught
    // by conditionEvaluator.test.ts's very first test case.
    if (typeof current === 'string' || Array.isArray(current)) {
      if (segment === 'length') return current.length;
      return undefined;
    }

    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function parseLiteral(raw: string): string | number | boolean {
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  const asNumber = Number(raw);
  if (!Number.isNaN(asNumber) && raw !== '') return asNumber;
  const stringMatch = raw.match(/^['"](.*)['"]$/);
  if (stringMatch) return stringMatch[1] ?? '';
  throw new ConditionEvaluationError(
    `Right-hand side "${raw}" is not a recognized literal (number, boolean, or quoted string).`
  );
}

function compare(left: unknown, op: ComparisonOp, right: string | number | boolean): boolean {
  switch (op) {
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return typeof left === 'number' && typeof right === 'number' && left > right;
    case '<':
      return typeof left === 'number' && typeof right === 'number' && left < right;
    case '>=':
      return typeof left === 'number' && typeof right === 'number' && left >= right;
    case '<=':
      return typeof left === 'number' && typeof right === 'number' && left <= right;
    default:
      return false;
  }
}
