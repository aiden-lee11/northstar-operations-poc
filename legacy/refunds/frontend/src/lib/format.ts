const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: "currency",
  currency: "USD",
});

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZoneName: "short",
});

export function formatMoney(cents: number): string {
  return currencyFormatter.format(cents / 100);
}

export function formatDate(value: string, withTime = false): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown historical time";
  return (withTime ? dateTimeFormatter : dateFormatter).format(parsed);
}

export function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function stateSummary(enabled: boolean, rollout: number | string): string {
  return `${enabled ? "Enabled" : "Disabled"} · ${rollout}% rollout`;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The local request failed.";
}
