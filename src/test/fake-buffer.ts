/** One query sent to the fake Buffer. */
export type Call = { query: string; variables: Record<string, any> };

/**
 * A fake Buffer that records every mutation and answers it the way the test says. Daily-limit checks are recorded
 * apart in `limitCalls` and answered by `limits` (default: nobody is at the limit).
 */
export function fakeBuffer(answer: (call: Call) => unknown, limits: (call: Call) => unknown = (c) => ({ dailyPostingLimits: c.variables.input.channelIds.map((channelId: string) => ({ channelId, isAtLimit: false, limit: null, scheduled: 0, sent: 0 })) })) {
  const calls: Call[] = [];
  /** One entry per limit check (one intended time and organization), however many share a request. */
  const limitCalls: Call[] = [];
  /** Each request that carried limit checks. */
  const limitRequests: Call[] = [];
  const q = (async (_token: string, query: string, variables?: Record<string, unknown>) => {
    const call = { query, variables: variables ?? {} };
    if (query.includes("dailyPostingLimits")) {
      limitRequests.push(call);
      // Several checks in one request, one alias each (l0, l1, ...), answered like Buffer: one key per alias.
      const aliases = [...query.matchAll(/\b(l\d+): dailyPostingLimits\(input: \$(i\d+)\)/g)];
      if (aliases.length) {
        const out: Record<string, unknown> = {};
        for (const [, alias, v] of aliases) {
          const one = { query, variables: { input: call.variables[v] } };
          limitCalls.push(one);
          const l = limits(one);
          if (l instanceof Error) throw l;
          out[alias] = (l as { dailyPostingLimits: unknown }).dailyPostingLimits;
        }
        return out;
      }
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
  return { q, calls, limitCalls, limitRequests };
}
