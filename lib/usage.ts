/**
 * Per-million-token reference rates in USD.
 * Defaults track Anthropic Sonnet 4.6 published pricing as a meaningful
 * reference point — Ollama itself is local and has no API cost, but the
 * "what would this have cost on a frontier API?" number is the most useful
 * single number to surface to the user.
 *
 * Override via env to match your actual provider:
 *   COST_PER_M_INPUT_USD, COST_PER_M_OUTPUT_USD
 */
const DEFAULT_INPUT_USD_PER_M = 3.0;
const DEFAULT_OUTPUT_USD_PER_M = 15.0;

export function getRates(): { inputPerM: number; outputPerM: number } {
  const inputPerM = Number(
    process.env.COST_PER_M_INPUT_USD ?? DEFAULT_INPUT_USD_PER_M,
  );
  const outputPerM = Number(
    process.env.COST_PER_M_OUTPUT_USD ?? DEFAULT_OUTPUT_USD_PER_M,
  );
  return { inputPerM, outputPerM };
}

export function computeCostUsd(
  inputTokens: number,
  outputTokens: number,
): number {
  const { inputPerM, outputPerM } = getRates();
  const cost =
    (inputTokens / 1_000_000) * inputPerM +
    (outputTokens / 1_000_000) * outputPerM;
  return Math.round(cost * 1_000_000) / 1_000_000;
}

export function formatUsd(value: number | string): string {
  const n = typeof value === "string" ? Number(value) : value;
  if (!Number.isFinite(n)) return "$0.0000";
  if (n === 0) return "$0.0000";
  if (n < 0.01) return `$${n.toFixed(6)}`;
  if (n < 1) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}
