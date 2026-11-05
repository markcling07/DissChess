"""Decides which side is at the bottom of a flat board, from where the pieces are.

White's pieces start at the bottom when White is at the bottom, and pawns can't move backwards, so
the two sides' average rows say a lot. This is evidence rather than proof: in a sparse endgame it
may say very little, so the result carries a confidence and is flagged for review when it's weak.
"""

import math
from dataclasses import dataclass

import numpy as np

PAWN_WEIGHT = 1.0
KING_WEIGHT = 0.35
MATERIAL_WEIGHT = 0.6
CONFIDENCE_SLOPE = 1.1
REVIEW_BELOW = 0.97


@dataclass(frozen=True)
class OrientationResult:
    white_at_bottom: bool
    confidence: float
    has_evidence: bool
    needs_review: bool


def _mean_rows(grid: list[list[str]], labels: str) -> list[int]:
    return [row for row in range(8) for column in range(8) if grid[row][column] in tuple(labels)]


def decide_orientation(grid: list[list[str]]) -> OrientationResult:
    """Grid is labels by image row and column, with row 0 at the top."""
    white_pawns = _mean_rows(grid, "P")
    black_pawns = _mean_rows(grid, "p")
    white_all = _mean_rows(grid, "PNBRQK")
    black_all = _mean_rows(grid, "pnbrqk")
    white_king = _mean_rows(grid, "K")
    black_king = _mean_rows(grid, "k")

    evidence = 0.0
    has_evidence = False
    if white_pawns and black_pawns:
        evidence += PAWN_WEIGHT * (np.mean(white_pawns) - np.mean(black_pawns))
        has_evidence = True
    elif white_pawns:
        evidence += PAWN_WEIGHT * (np.mean(white_pawns) - 3.5)
        has_evidence = True
    elif black_pawns:
        evidence += PAWN_WEIGHT * (3.5 - np.mean(black_pawns))
        has_evidence = True
    if white_all and black_all:
        evidence += MATERIAL_WEIGHT * (np.mean(white_all) - np.mean(black_all))
        has_evidence = True
    if white_king and black_king:
        evidence += KING_WEIGHT * (np.mean(white_king) - np.mean(black_king))
        has_evidence = True

    confidence = 1 / (1 + math.exp(-CONFIDENCE_SLOPE * abs(float(evidence))))
    return OrientationResult(
        white_at_bottom=evidence >= 0,
        confidence=confidence if has_evidence else 0.5,
        has_evidence=has_evidence,
        needs_review=not has_evidence or confidence < REVIEW_BELOW,
    )
