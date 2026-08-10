import { withRetry, RetryExhaustedError } from './retry';

describe('withRetry', () => {
  test('returns immediately on first success, attempts = 1', async () => {
    const fn = jest.fn().mockResolvedValue('ok');
    const { result, attempts } = await withRetry(fn, { maxAttempts: 3, delayMs: 1 });
    expect(result).toBe('ok');
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test('retries on failure and succeeds on a later attempt', async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new Error('fail 1'))
      .mockRejectedValueOnce(new Error('fail 2'))
      .mockResolvedValueOnce('ok on third try');

    const { result, attempts } = await withRetry(fn, { maxAttempts: 3, delayMs: 1 });
    expect(result).toBe('ok on third try');
    expect(attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('throws RetryExhaustedError after maxAttempts consecutive failures', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('always fails'));
    await expect(withRetry(fn, { maxAttempts: 3, delayMs: 1 })).rejects.toThrow(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test('RetryExhaustedError carries the attempt count and original cause', async () => {
    const originalError = new Error('root cause');
    const fn = jest.fn().mockRejectedValue(originalError);
    try {
      await withRetry(fn, { maxAttempts: 2, delayMs: 1 });
      fail('expected withRetry to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(RetryExhaustedError);
      const retryErr = err as RetryExhaustedError;
      expect(retryErr.attempts).toBe(2);
      expect(retryErr.cause).toBe(originalError);
    }
  });

  test('maxAttempts of 1 means no retries at all', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('fail'));
    await expect(withRetry(fn, { maxAttempts: 1, delayMs: 1 })).rejects.toThrow(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
