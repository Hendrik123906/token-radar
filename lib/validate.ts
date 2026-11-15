// Token Radar's validation: how much to trust one board, checked from the snapshot alone.
//
// The model scores every row from the sealed snapshot, so its own numbers can be checked
// without waiting for a launch: the board's confidence distribution, and how far the top
// ten move when the model's constants are nudged. A board whose top ten survive the nudges
// and whose rows carry real evidence is a board the radar can stand behind; a board whose
// top ten reshuffle on a small nudge says more about the constants than about the protocols.
// Everything here is pure and deterministic: the same snapshot and the same constants give
// the same report, byte for byte. The report is advisory — it never refuses a board on its
// own; the gate's boardIssue still decides that — but a board with a low mean confidence or
// a shaky top ten is one to read twice.

import {
  MODEL,
  MODEL_VERSION,
  buildBoard,
  categoryEvidence,
  confidenceFor,
  type BoardRow,
  type ModelConstants,
  type Snapshot,
} from './model.ts';

/** One nudge to the model's constants, and what it is called. */
export interface Perturbation {
  label: string;
  patch: Partial<ModelConstants>;
}

/** The nudges the stability check runs: each constant moved one step in each direction. */
export const PERTURBATIONS: Perturbation[] = [
  { label: 'growth_weight 0.4', patch: { growth_weight: 0.4 } },
  { label: 'growth_weight 0.8', patch: { growth_weight: 0.8 } },
  { label: 'multiple_cap 1.25', patch: { multiple_cap: 1.25 } },
  { label: 'multiple_cap 1.75', patch: { multiple_cap: 1.75 } },
  { label: 'maturity_floor 0.45', patch: { maturity_floor: 0.45 } },
  { label: 'maturity_floor 0.65', patch: { maturity_floor: 0.65 } },
  { label: 'breadth_cap 0.05', patch: { breadth_cap: 0.05 } },
  { label: 'breadth_cap 0.15', patch: { breadth_cap: 0.15 } },
];

/** How one nudge moved the board's top ten. */
export interface StabilityRow {
  label: string;
  overlap: number;
  top10: string[];
}

/** The confidence distribution across the board's rows. */
export interface ConfidenceSummary {
  mean: number;
  median: number;
  low_count: number;
  low_slugs: string[];
}

/** The whole validation report for one board. */
export interface ValidationReport {
  model_version: string;
  rows: number;
  top10: string[];
  confidence: ConfidenceSummary;
  stability: StabilityRow[];
  worst_overlap: number;
  worst_label: string;
  issues: string[];
}

/** The top ten slugs of a board, in rank order. */
function top10Slugs(board: BoardRow[]): string[] {
  return board.slice(0, 10).map((r) => r.slug);
}

/** The overlap of two top-ten lists: how many slugs they share. */
function overlap(a: string[], b: string[]): number {
  const inB = new Set(b);
  return a.filter((s) => inB.has(s)).length;
}

/** The mean of numbers, rounded to three decimals, or 0 when there are none. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 1000) / 1000;
}

/** The median of numbers, rounded to three decimals, or 0 when there are none. */
function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const m = sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
  return Math.round(m * 1000) / 1000;
}

/**
 * The confidence distribution: the board's mean and median score, and the rows below 0.5
 * (thin evidence: a category multiple backed by fewer than three comparables, a missing
 * 7-day change, or an unknown listing date). Only the first five low slugs are named so
 * the report stays short on a long board.
 */
export function confidenceSummary(board: BoardRow[]): ConfidenceSummary {
  const scores = board.map((r) => r.model.confidence);
  const low = board.filter((r) => r.model.confidence < 0.5);
  return {
    mean: mean(scores),
    median: median(scores),
    low_count: low.length,
    low_slugs: low.slice(0, 5).map((r) => r.slug),
  };
}

/**
 * The stability check: rebuild the board under each nudge and count how many of the base
 * top ten stay in the top ten. A nudge that keeps 8 or more is a steady board; below 5 the
 * ranking leans on that constant more than on the protocols.
 */
export function rankStability(snapshot: Snapshot, model: ModelConstants = MODEL): StabilityRow[] {
  const base = top10Slugs(buildBoard(snapshot, model));
  return PERTURBATIONS.map(({ label, patch }) => {
    const nudged = buildBoard(snapshot, { ...model, ...patch });
    const top = top10Slugs(nudged);
    return { label, overlap: overlap(base, top), top10: top };
  });
}

/**
 * The whole report: confidence, stability, and every issue the board carries. It also
 * recomputes every row's confidence from the snapshot and flags any row whose stored
 * numbers disagree with the recomputation — the board must not claim more than it has.
 */
export function validateBoard(board: BoardRow[], snapshot: Snapshot, model: ModelConstants = MODEL): ValidationReport {
  const top10 = top10Slugs(board);
  const confidence = confidenceSummary(board);
  const stability = rankStability(snapshot, model);
  const worst = stability.reduce((a, b) => (b.overlap < a.overlap ? b : a), stability[0]!);
  const issues: string[] = [];
  if (confidence.mean < 0.6) issues.push(`mean confidence ${confidence.mean} is below 0.6: the board leans on thin evidence`);
  if (confidence.low_count > board.length / 4) issues.push(`${confidence.low_count} of ${board.length} rows score below 0.5 confidence`);
  if (worst.overlap < 5) issues.push(`top ten is shaky under '${worst.label}': only ${worst.overlap} of 10 stay in the top ten`);
  const evidence = categoryEvidence(snapshot);
  for (const row of board) {
    const recomputed = confidenceFor(
      {
        slug: row.slug,
        name: row.name,
        category: row.category,
        chains: row.chains,
        tvl_usd: row.tvl_usd,
        change_7d: row.change_7d,
        mcap_usd: row.mcap_usd,
        listed_at: row.listed_at,
        gecko_id: row.gecko_id,
        symbol: row.symbol,
      },
      evidence.get(row.category ?? 'Other') ?? 0,
      model,
    );
    if (recomputed.score !== row.model.confidence || recomputed.comparables !== row.model.comparables) {
      issues.push(`${row.slug} carries confidence ${row.model.confidence} but the snapshot recomputes ${recomputed.score}`);
      break;
    }
  }
  return {
    model_version: MODEL_VERSION,
    rows: board.length,
    top10,
    confidence,
    stability,
    worst_overlap: worst.overlap,
    worst_label: worst.label,
    issues,
  };
}
