/** One query sent to the fake Buffer. */
export type Call = { query: string; variables: Record<string, any> };

/**
 * A fake Buffer that records every mutation and answers it the way the test says. Daily-limit checks are recorded
 * apart in `limitCalls` and answered by `limits` (default: nobody is at the limit).
 */
export function fakeBuffer(answer: (call: Call) => unknown, limits: (call: Call) => unknown = (c) => ({ dailyPostingLimits: c.variables.input.channelIds.map((channelId: string) => ({ channelId, isAtLimit: false, limit: null, scheduled: 0, sent: 0 })) })) {
  const calls: Call[] = [];
  const limitCalls: Call[] = [];
  const q = (async (_token: string, query: string, variables?: Record<string, unknown>) => {
    const call = { query, variables: variables ?? {} };
    if (query.includes("dailyPostingLimits")) {
      limitCalls.push(call);
      const l = limits(call);
      if (l instanceof Error) throw l;
      return l;
    }
    calls.push(call);
    const a = answer(call);
    if (a instanceof Error) throw a;
    return a;
  }) as any;
  return { q, calls, limitCalls };
}
