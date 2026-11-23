export type RetryOptions = {
  // Waits between attempts; the number of entries is the number of extra attempts.
  delaysMs: readonly number[];
  retryable: (error: unknown) => boolean;
  pause?: (ms: number) => Promise<void>;
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// For calls that change nothing when repeated. The last error is the one the caller sees.
export async function retrying<T>(run: () => Promise<T>, options: RetryOptions): Promise<T> {
  for (const delay of options.delaysMs) {
    try {
      return await run();
    } catch (error) {
      if (!options.retryable(error)) throw error;
      await (options.pause ?? sleep)(delay);
    }
  }
  return run();
}
