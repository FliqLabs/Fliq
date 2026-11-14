import { describe, expect, it } from "vitest";
import { retrying } from "../apps/api/src/retry.js";

function failing(times: number, error: Error = new Error("busy")) {
  let calls = 0;
  return {
    run: async () => {
      calls += 1;
      if (calls <= times) throw error;
      return `ok after ${calls}`;
    },
    calls: () => calls,
  };
}

const options = (waits: number[] = []) => ({
  delaysMs: [300, 800],
  retryable: (error: unknown) => (error as Error).message === "busy",
  pause: async (ms: number) => void waits.push(ms),
});

describe("retrying a call that is safe to repeat", () => {
  it("returns the first success without waiting", async () => {
    const waits: number[] = [];
    const call = failing(0);
    expect(await retrying(call.run, options(waits))).toBe("ok after 1");
    expect(waits).toEqual([]);
  });

  it("tries again after each wait until it works", async () => {
    const waits: number[] = [];
    const call = failing(2);
    expect(await retrying(call.run, options(waits))).toBe("ok after 3");
    expect(waits).toEqual([300, 800]);
  });

  it("gives up after the last attempt and reports that error", async () => {
    const call = failing(5);
    await expect(retrying(call.run, options())).rejects.toThrow("busy");
    expect(call.calls()).toBe(3);
  });

  it("does not repeat an error that repeating cannot fix", async () => {
    const call = failing(1, new Error("bad amount"));
    await expect(retrying(call.run, options())).rejects.toThrow("bad amount");
    expect(call.calls()).toBe(1);
  });
});
