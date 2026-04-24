const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB", "PB"] as const;
const SPARKLINE_CHARS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"] as const;

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function bytesOrZero(value: number | null | undefined): number {
  return value ?? 0;
}

export function formatBytes(value: number | null | undefined, precision = 1): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return "n/a";
  }

  const absolute = Math.abs(value);
  if (absolute < 1024) {
    return `${Math.round(value)} B`;
  }

  let size = absolute;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < BYTE_UNITS.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const sign = value < 0 ? "-" : "";
  return `${sign}${size.toFixed(size >= 10 ? Math.min(precision, 1) : precision)} ${BYTE_UNITS[unitIndex]}`;
}

export function formatDeltaBytes(value: number | null | undefined, precision = 1): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return "n/a";
  }

  if (value === 0) {
    return `±0 ${BYTE_UNITS[0]}`;
  }

  const sign = value > 0 ? "+" : "-";
  return `${sign}${formatBytes(Math.abs(value), precision)}`;
}

export function formatPercent(value: number | null | undefined, precision = 1): string {
  if (value === null || value === undefined || Number.isNaN(value) || !Number.isFinite(value)) {
    return "n/a";
  }

  return `${value.toFixed(precision)}%`;
}

export function formatDurationFromSeconds(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || !Number.isFinite(totalSeconds)) {
    return "n/a";
  }

  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;

  return [hours, minutes, remainder].map((part) => String(part).padStart(2, "0")).join(":");
}

export function formatTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${hours}:${minutes}:${seconds}`;
}

export function toFileSafeTimestamp(date = new Date()): string {
  return date.toISOString().replaceAll(":", "-").replaceAll(".", "-");
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

export function parseDuration(input: string | undefined): number | undefined {
  if (!input) {
    return undefined;
  }

  if (/^\d+$/.test(input)) {
    return Number(input);
  }

  const durationPattern = /(\d+(?:\.\d+)?)(ms|s|m|h|d)/gi;
  let total = 0;
  let matched = false;

  for (const match of input.matchAll(durationPattern)) {
    matched = true;
    const value = Number(match[1]);
    const unit = match[2]?.toLowerCase();

    switch (unit) {
      case "ms":
        total += value;
        break;
      case "s":
        total += value * 1000;
        break;
      case "m":
        total += value * 60_000;
        break;
      case "h":
        total += value * 3_600_000;
        break;
      case "d":
        total += value * 86_400_000;
        break;
      default:
        break;
    }
  }

  return matched && total > 0 ? Math.round(total) : undefined;
}

export function parseElapsedToSeconds(value: string): number {
  if (!value) {
    return 0;
  }

  const [daysPart, restPart] = value.includes("-") ? value.split("-", 2) : [undefined, value];
  const rest = restPart ?? "";
  const timeBits = rest.split(":").map((part) => Number(part));
  const [first = 0, second = 0, third = 0] = timeBits;

  let seconds = 0;
  if (daysPart) {
    seconds += Number(daysPart) * 86_400;
  }

  if (timeBits.length === 3) {
    seconds += first * 3600 + second * 60 + third;
  } else if (timeBits.length === 2) {
    seconds += first * 60 + second;
  } else if (timeBits.length === 1 && Number.isFinite(first)) {
    seconds += first;
  }

  return seconds;
}

export function humanSizeToBytes(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  const normalized = value.replaceAll(/\s+/g, "").toUpperCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)([KMGTP]?)(B)?$/);
  if (!match) {
    return null;
  }

  const [, amountText, unitText] = match;
  if (!amountText) {
    return null;
  }

  const amount = Number(amountText);
  const unit = unitText ?? "";
  const power = ["", "K", "M", "G", "T", "P"].indexOf(unit);
  if (power === -1) {
    return null;
  }

  return Math.round(amount * 1024 ** power);
}

export function sparkline(values: number[], width = 24): string {
  if (values.length === 0) {
    return "·".repeat(width);
  }

  const sampled = resample(values, width);
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  if (min === max) {
    const middle = SPARKLINE_CHARS[Math.floor(SPARKLINE_CHARS.length / 2)] ?? "▅";
    return middle.repeat(sampled.length);
  }

  return sampled
    .map((value) => {
      const normalized = (value - min) / (max - min);
      const index = clamp(Math.round(normalized * (SPARKLINE_CHARS.length - 1)), 0, SPARKLINE_CHARS.length - 1);
      return SPARKLINE_CHARS[index] ?? SPARKLINE_CHARS[0];
    })
    .join("");
}

function resample(values: number[], width: number): number[] {
  if (values.length <= width) {
    return [...values];
  }

  const output: number[] = [];
  for (let index = 0; index < width; index += 1) {
    const start = Math.floor((index / width) * values.length);
    const end = Math.max(start + 1, Math.floor(((index + 1) / width) * values.length));
    const slice = values.slice(start, end);
    const average = slice.reduce((sum, value) => sum + value, 0) / slice.length;
    output.push(average);
  }
  return output;
}

export function formatTrend(delta: number, deadband = 1024 * 1024): "↑" | "↓" | "→" {
  if (delta > deadband) {
    return "↑";
  }
  if (delta < -deadband) {
    return "↓";
  }
  return "→";
}

export function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1))}…`;
}
