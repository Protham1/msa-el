const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

export function formatMs(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return numberFormat.format(value);
}

export function formatLatency(value: number): string {
  return `${formatMs(value)} ms`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : plural}`;
}

export function relativeTime(value: string): string {
  const timestamp = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  if (!Number.isFinite(timestamp)) return "—";

  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(timestamp).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function absoluteTime(value: string): string {
  const timestamp = Date.parse(value.replace(/(\.\d{3})\d+/, "$1"));
  if (!Number.isFinite(timestamp)) return value;
  return new Date(timestamp).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

const SERVICE_LABELS: Record<string, string> = {
  "traceflow-api": "TraceFlow API",
  gateway: "Gateway",
  "auth-service": "Auth",
  "order-service": "Order",
  "payment-service": "Payment",
  "inventory-service": "Inventory",
};

export function displayServiceName(name: string): string {
  return (
    SERVICE_LABELS[name] ||
    name.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );
}

export function shortTraceId(traceId: string, length = 12): string {
  return traceId.length > length ? traceId.slice(0, length) : traceId;
}

const SERVICE_COLORS = [
  "#5cc8e8",
  "#a78bfa",
  "#5bd6a2",
  "#f2c66d",
  "#f28b95",
  "#7aa7ff",
  "#f0a66e",
  "#8dd6c2",
];

export function serviceColors(serviceNames: Iterable<string>): Map<string, string> {
  const map = new Map<string, string>();
  [...new Set(serviceNames)].sort().forEach((name, index) => {
    map.set(name, SERVICE_COLORS[index % SERVICE_COLORS.length]);
  });
  return map;
}
