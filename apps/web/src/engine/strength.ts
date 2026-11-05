/** Strength settings for the computer opponent. Lower skill levels make deliberate errors. */
export interface Strength {
  readonly id: string;
  readonly label: string;
  readonly skill: number;
  readonly movetimeMs: number;
}

export const STRENGTHS: readonly Strength[] = [
  { id: "beginner", label: "Beginner", skill: 0, movetimeMs: 150 },
  { id: "casual", label: "Casual", skill: 4, movetimeMs: 250 },
  { id: "club", label: "Club", skill: 9, movetimeMs: 500 },
  { id: "strong", label: "Strong", skill: 15, movetimeMs: 1000 },
  { id: "maximum", label: "Maximum", skill: 20, movetimeMs: 2000 },
];

export const DEFAULT_STRENGTH = STRENGTHS[2]!;
