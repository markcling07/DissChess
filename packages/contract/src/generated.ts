/* Generated from schema/recognition-response.schema.json. Do not edit.
   Run `pnpm contract:generate` to update. */

export type RecognitionResponse = RecognitionSuccess | RecognitionFailure;
export type Confidence = number;
/**
 * The four board corners, clockwise from the top left as seen in the image.
 *
 * @minItems 4
 * @maxItems 4
 */
export type Corners = [Point, Point, Point, Point];
export type X = number;
export type Y = number;
export type ContractVersion = "1.0";
export type Name = string;
export type Version = string;
export type Code =
  | "missing_king"
  | "extra_king"
  | "kings_adjacent"
  | "pawn_on_back_rank"
  | "too_many_pawns"
  | "too_many_pieces"
  | "impossible_promotion_count"
  | "orientation_uncertain";
export type Message = string;
export type Severity = "blocking" | "warning";
export type Squares = string[];
export type Issues = PositionIssue[];
export type Confidence1 = number;
export type Method = "board_labels" | "piece_layout" | "square_colour" | "assumed";
export type NeedsReview = boolean;
/**
 * Clockwise quarter turns of the corrected board view that bring White to the bottom. 0 means White was at the bottom of the image and 2 means Black was.
 */
export type QuarterTurnsCw = number;
/**
 * The piece placement field of a FEN, and nothing else.
 */
export type Placement = string;
/**
 * The corrected board as a JPEG data URL, for side by side comparison.
 */
export type RectifiedPreview = string | null;
export type SourceKind = "screenshot" | "photo";
/**
 * @minItems 64
 * @maxItems 64
 */
export type Squares1 = [
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult,
  SquareResult
];
export type Label = "empty" | "P" | "N" | "B" | "R" | "Q" | "K" | "p" | "n" | "b" | "r" | "q" | "k";
export type Probability = number;
/**
 * Next most likely labels, most likely first.
 */
export type Alternatives = LabelProbability[];
/**
 * Calibrated probability that label is correct.
 */
export type Confidence2 = number;
export type Label1 = "empty" | "P" | "N" | "B" | "R" | "Q" | "K" | "p" | "n" | "b" | "r" | "q" | "k";
export type NeedsReview1 = boolean;
export type ReviewReasons = ("low_confidence" | "close_alternative" | "position_conflict")[];
export type Square = string;
export type Status = "ok";
/**
 * Boards that were found, when several were detected.
 */
export type BoardCandidates = BoardLocation[];
export type Code1 =
  | "unsupported_media_type"
  | "file_too_large"
  | "image_too_large"
  | "image_unreadable"
  | "no_board_detected"
  | "multiple_boards_detected"
  | "image_too_blurry"
  | "board_incomplete"
  | "recognition_timeout"
  | "internal_error";
export type ContractVersion1 = "1.0";
/**
 * Safe to show to the user.
 */
export type Message1 = string;
export type Retryable = boolean;
export type Status1 = "error";

export interface RecognitionSuccess {
  board: BoardLocation;
  contract_version?: ContractVersion;
  engine: EngineInfo;
  issues?: Issues;
  orientation: Orientation;
  placement: Placement;
  rectified_preview?: RectifiedPreview;
  source_kind: SourceKind;
  squares: Squares1;
  status?: Status;
  timings_ms?: TimingsMs;
}
export interface BoardLocation {
  confidence: Confidence;
  corners: Corners;
}
/**
 * A position in the submitted image: 0,0 is the top left and 1,1 the bottom right.
 */
export interface Point {
  x: X;
  y: Y;
}
/**
 * Identifies the recognition engine, so results can be traced to a model version.
 */
export interface EngineInfo {
  name: Name;
  version: Version;
}
export interface PositionIssue {
  code: Code;
  message: Message;
  severity: Severity;
  squares?: Squares;
}
export interface Orientation {
  confidence: Confidence1;
  method: Method;
  needs_review: NeedsReview;
  quarter_turns_cw: QuarterTurnsCw;
}
/**
 * The prediction for one square, named by its true board coordinate.
 */
export interface SquareResult {
  alternatives?: Alternatives;
  confidence: Confidence2;
  label: Label1;
  needs_review: NeedsReview1;
  review_reasons?: ReviewReasons;
  square: Square;
}
export interface LabelProbability {
  label: Label;
  probability: Probability;
}
export interface TimingsMs {
  [k: string]: number;
}
/**
 * Recognition could not produce a board. The user can always retry or arrange it by hand.
 */
export interface RecognitionFailure {
  board_candidates?: BoardCandidates;
  code: Code1;
  contract_version?: ContractVersion1;
  message: Message1;
  retryable: Retryable;
  status?: Status1;
}
