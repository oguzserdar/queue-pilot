/**
 * @fileoverview The reader's clock: the server always renders the same nothing (so server and browser markup match
 * when hydrating), the browser's value is whole seconds and moves on as time passes, and a period ticks until it is
 * unsubscribed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { noClockOnServer, readNow, tickEvery, useReaderClock } from "./reader-clock";

function Stamp() {
  const now = useReaderClock(1000);
  return <span>{now === null ? "no clock" : String(now)}</span>;
}

describe("useReaderClock", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-15T10:00:00.400Z")); });
  afterEach(() => { vi.useRealTimers(); });

  it("renders the same markup on the server every time, whatever the clock says", () => {
    const first = renderToStaticMarkup(<Stamp />);
    vi.setSystemTime(new Date("2027-01-01T00:00:00Z"));
    expect(renderToStaticMarkup(<Stamp />)).toBe(first);
    expect(first).toBe("<span>no clock</span>");
    expect(noClockOnServer()).toBe(noClockOnServer());
  });

  it("reads whole seconds, the same within one second, and moves on as time passes", () => {
    const now = readNow();
    expect(now).toBe(Date.parse("2026-11-15T10:00:00.000Z"));
    vi.advanceTimersByTime(300);
    expect(readNow()).toBe(now);
    vi.advanceTimersByTime(60_000);
    expect(readNow()).toBe(now + 60_000);
  });

  it("ticks every period until unsubscribed, and never without a period", () => {
    const onTick = vi.fn<() => void>();
    const stop = tickEvery(1000)(onTick);
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(3);
    stop();
    vi.advanceTimersByTime(3000);
    expect(onTick).toHaveBeenCalledTimes(3);
    const never = vi.fn<() => void>();
    tickEvery()(never);
    vi.advanceTimersByTime(10_000);
    expect(never).not.toHaveBeenCalled();
  });
});
