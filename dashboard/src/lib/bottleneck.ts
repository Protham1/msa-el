import type { Span } from "../types/tracing";

const NANOS_PER_MS = 1_000_000;

export interface Bottleneck {
  span: Span;
  selfTimeMs: number;
  percentOfTrace: number;
}

interface Interval {
  start: bigint;
  end: bigint;
}

function startNano(span: Span): bigint | null {
  try {
    return BigInt(span.startTimeUnixNano);
  } catch {
    return null;
  }
}

function endNano(span: Span, start: bigint): bigint {
  const durationMs = Number.isFinite(span.durationMs) ? Math.max(0, span.durationMs) : 0;
  return start + BigInt(Math.round(durationMs * NANOS_PER_MS));
}

/**
 * Returns the fraction of a span's lifetime that is covered by its direct
 * children. The union is important: concurrent children (Payment and
 * Inventory) must be counted once, not added together.
 */
function coveredNanos(span: Span, children: Span[]): bigint {
  const spanStart = startNano(span);
  if (spanStart === null) return 0n;
  const spanEnd = endNano(span, spanStart);

  const intervals: Interval[] = [];
  for (const child of children) {
    const childStart = startNano(child);
    if (childStart === null) continue;
    const start = childStart > spanStart ? childStart : spanStart;
    const childEnd = endNano(child, childStart);
    const end = childEnd < spanEnd ? childEnd : spanEnd;
    if (end > start) intervals.push({ start, end });
  }

  intervals.sort((left, right) => (left.start < right.start ? -1 : left.start > right.start ? 1 : 0));

  let covered = 0n;
  let currentStart: bigint | null = null;
  let currentEnd = 0n;
  for (const interval of intervals) {
    if (currentStart === null) {
      currentStart = interval.start;
      currentEnd = interval.end;
    } else if (interval.start <= currentEnd) {
      if (interval.end > currentEnd) currentEnd = interval.end;
    } else {
      covered += currentEnd - currentStart;
      currentStart = interval.start;
      currentEnd = interval.end;
    }
  }
  if (currentStart !== null) covered += currentEnd - currentStart;
  return covered;
}

/**
 * Finds the operation that owns the trace's latency.
 *
 * A parent span's duration includes all of its children, so selecting the
 * longest span always picks a root/server span. Instead, subtract each span's
 * direct-child time from its duration and select the largest remaining
 * "self time". That surfaces `payment.charge` for a delayed payment rather
 * than the 609 ms root checkout span.
 */
export function computeBottleneck(spans: Span[], traceDurationMs: number): Bottleneck | null {
  if (spans.length === 0) return null;

  const spanIds = new Set(spans.map((span) => span.spanId));
  const childrenByParent = new Map<string, Span[]>();
  for (const span of spans) {
    if (!span.parentSpanId || !spanIds.has(span.parentSpanId)) continue;
    const siblings = childrenByParent.get(span.parentSpanId);
    if (siblings) siblings.push(span);
    else childrenByParent.set(span.parentSpanId, [span]);
  }

  let best: { span: Span; selfTimeMs: number } | null = null;
  for (const span of spans) {
    if (startNano(span) === null) continue;
    const durationMs = Number.isFinite(span.durationMs) ? Math.max(0, span.durationMs) : 0;
    if (durationMs <= 0) continue;

    const coveredMs = Number(coveredNanos(span, childrenByParent.get(span.spanId) ?? [])) / NANOS_PER_MS;
    const selfTimeMs = Math.max(0, durationMs - coveredMs);
    if (selfTimeMs <= 0) continue;

    if (
      !best ||
      selfTimeMs > best.selfTimeMs ||
      (selfTimeMs === best.selfTimeMs && durationMs > best.span.durationMs)
    ) {
      best = { span, selfTimeMs };
    }
  }

  if (!best) return null;
  return {
    ...best,
    percentOfTrace:
      traceDurationMs > 0 ? Math.min(100, (best.selfTimeMs / traceDurationMs) * 100) : 0,
  };
}
