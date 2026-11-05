"""The versioned recognition API contract.

These models are the single source of truth. The JSON Schema and the TypeScript types in
packages/contract are generated from them; run `pnpm contract:generate` after any change.

A photo only shows where the pieces are, so a successful response carries a piece placement and
never a full FEN. Side to move, castling rights, en passant and move counters are absent on
purpose: the user supplies them in the confirmation screen.
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, TypeAdapter, model_validator

from ptc_vision.board import ALL_SQUARES, SquareLabel, parse_placement

CONTRACT_VERSION = "1.0"

SquareName = Annotated[str, Field(pattern=r"^[a-h][1-8]$")]
Probability = Annotated[float, Field(ge=0.0, le=1.0)]
NormalisedCoordinate = Annotated[float, Field(ge=0.0, le=1.0)]

ReviewReason = Literal["low_confidence", "close_alternative", "position_conflict"]
OrientationMethod = Literal["board_labels", "piece_layout", "square_colour", "assumed"]
PositionIssueCode = Literal[
    "missing_king",
    "extra_king",
    "kings_adjacent",
    "pawn_on_back_rank",
    "too_many_pawns",
    "too_many_pieces",
    "impossible_promotion_count",
    "orientation_uncertain",
]
FailureCode = Literal[
    "unsupported_media_type",
    "file_too_large",
    "image_too_large",
    "image_unreadable",
    "no_board_detected",
    "multiple_boards_detected",
    "image_too_blurry",
    "board_incomplete",
    "recognition_timeout",
    "internal_error",
]


class _Model(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        frozen=True,
        # Replies always include every field, so generated client types can rely on them.
        json_schema_serialization_defaults_required=True,
    )


class LabelProbability(_Model):
    label: SquareLabel
    probability: Probability


class SquareResult(_Model):
    """The prediction for one square, named by its true board coordinate."""

    square: SquareName
    label: SquareLabel
    confidence: Probability = Field(description="Calibrated probability that label is correct.")
    alternatives: list[LabelProbability] = Field(
        default_factory=list, description="Next most likely labels, most likely first."
    )
    needs_review: bool
    review_reasons: list[ReviewReason] = Field(default_factory=list)

    @model_validator(mode="after")
    def _check_consistency(self) -> "SquareResult":
        if self.needs_review != bool(self.review_reasons):
            raise ValueError("needs_review must be true exactly when review_reasons is non-empty")
        probabilities = [a.probability for a in self.alternatives]
        if probabilities != sorted(probabilities, reverse=True):
            raise ValueError("alternatives must be ordered most likely first")
        if any(a.label == self.label for a in self.alternatives):
            raise ValueError("alternatives must not repeat the chosen label")
        if self.confidence + sum(probabilities) > 1.001:
            raise ValueError("confidence and alternatives must not sum to more than 1")
        return self


class Point(_Model):
    """A position in the submitted image: 0,0 is the top left and 1,1 the bottom right."""

    x: NormalisedCoordinate
    y: NormalisedCoordinate


class BoardLocation(_Model):
    corners: Annotated[list[Point], Field(min_length=4, max_length=4)] = Field(
        description="The four board corners, clockwise from the top left as seen in the image."
    )
    confidence: Probability


class Orientation(_Model):
    quarter_turns_cw: Annotated[int, Field(ge=0, le=3)] = Field(
        description=(
            "Clockwise quarter turns of the corrected board view that bring White to the bottom. "
            "0 means White was at the bottom of the image and 2 means Black was."
        )
    )
    confidence: Probability
    method: OrientationMethod
    needs_review: bool


class PositionIssue(_Model):
    code: PositionIssueCode
    severity: Literal["blocking", "warning"]
    squares: list[SquareName] = Field(default_factory=list)
    message: str


class EngineInfo(_Model):
    """Identifies the recognition engine, so results can be traced to a model version."""

    name: str
    version: str


class RecognitionSuccess(_Model):
    contract_version: Literal["1.0"] = CONTRACT_VERSION
    status: Literal["ok"] = "ok"
    source_kind: Literal["screenshot", "photo"]
    board: BoardLocation
    orientation: Orientation
    placement: str = Field(description="The piece placement field of a FEN, and nothing else.")
    squares: Annotated[list[SquareResult], Field(min_length=64, max_length=64)]
    issues: list[PositionIssue] = Field(default_factory=list)
    rectified_preview: str | None = Field(
        default=None,
        pattern=r"^data:image/jpeg;base64,",
        description="The corrected board as a JPEG data URL, for side by side comparison.",
    )
    engine: EngineInfo
    timings_ms: dict[str, float] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _check_board(self) -> "RecognitionSuccess":
        by_square = {result.square: result.label for result in self.squares}
        if set(by_square) != set(ALL_SQUARES):
            raise ValueError("squares must contain each of the 64 squares exactly once")
        if parse_placement(self.placement) != by_square:
            raise ValueError("placement must match the labels in squares")
        return self


class RecognitionFailure(_Model):
    """Recognition could not produce a board. The user can always retry or arrange it by hand."""

    contract_version: Literal["1.0"] = CONTRACT_VERSION
    status: Literal["error"] = "error"
    code: FailureCode
    message: str = Field(description="Safe to show to the user.")
    retryable: bool
    board_candidates: list[BoardLocation] = Field(
        default_factory=list, description="Boards that were found, when several were detected."
    )


RecognitionResponse = Annotated[
    RecognitionSuccess | RecognitionFailure, Field(discriminator="status")
]

recognition_response_adapter: TypeAdapter[RecognitionSuccess | RecognitionFailure] = TypeAdapter(
    RecognitionResponse
)
