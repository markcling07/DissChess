"""Loads and validates labelled test image collections. See corpus/README.md for the format."""

import json
from pathlib import Path, PurePosixPath
from typing import Annotated, Literal

from ptc_vision.board import parse_placement
from ptc_vision.contract import FailureCode, Point
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator


class CorpusEntry(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    id: Annotated[str, Field(min_length=1)]
    image: str = Field(description="Path relative to the corpus folder, using forward slashes.")
    kind: Literal["screenshot", "photo"]
    set_id: Annotated[str, Field(min_length=1)] = Field(
        description="The physical set or digital theme. Keeps look-alike images in one split."
    )
    split: Literal["dev", "holdout"]
    source: Annotated[str, Field(min_length=1)]
    license: Annotated[str, Field(min_length=1)]
    placement: str | None = Field(default=None, description="The true position.")
    expected_failure: FailureCode | None = Field(
        default=None, description="For images that should be refused, such as one with no board."
    )
    corners: Annotated[list[Point], Field(min_length=4, max_length=4)] | None = None
    tags: list[str] = Field(default_factory=list)

    @field_validator("placement")
    @classmethod
    def _placement_is_valid(cls, value: str | None) -> str | None:
        if value is not None:
            parse_placement(value)
        return value

    @model_validator(mode="after")
    def _exactly_one_expectation(self) -> "CorpusEntry":
        if (self.placement is None) == (self.expected_failure is None):
            raise ValueError("set exactly one of placement or expected_failure")
        return self


class CorpusError(Exception):
    """The corpus cannot be used. Holds every problem found, not just the first."""

    def __init__(self, problems: list[str]):
        super().__init__("\n".join(problems))
        self.problems = problems


def load_corpus(corpus_dir: Path) -> list[CorpusEntry]:
    manifest = corpus_dir / "manifest.jsonl"
    if not manifest.is_file():
        raise CorpusError([f"{manifest}: manifest not found"])

    entries: list[CorpusEntry] = []
    problems: list[str] = []
    seen_ids: set[str] = set()
    split_by_set: dict[str, str] = {}

    lines = manifest.read_text(encoding="utf-8-sig").splitlines()
    for number, line in enumerate(lines, start=1):
        if not line.strip():
            continue
        where = f"manifest.jsonl line {number}"
        try:
            entry = CorpusEntry.model_validate(json.loads(line))
        except json.JSONDecodeError as error:
            problems.append(f"{where}: invalid JSON: {error}")
            continue
        except ValidationError as error:
            details = "; ".join(
                f"{'.'.join(str(p) for p in e['loc']) or 'entry'}: {e['msg']}"
                for e in error.errors()
            )
            problems.append(f"{where}: {details}")
            continue

        if entry.id in seen_ids:
            problems.append(f"{where}: duplicate id {entry.id!r}")
        seen_ids.add(entry.id)

        problem = _image_problem(corpus_dir, entry.image)
        if problem:
            problems.append(f"{where}: {problem}")

        # Images of the same set in both splits would inflate holdout accuracy.
        first_split = split_by_set.setdefault(entry.set_id, entry.split)
        if first_split != entry.split:
            problems.append(f"{where}: set {entry.set_id!r} appears in both dev and holdout")

        entries.append(entry)

    if problems:
        raise CorpusError(problems)
    return entries


def _image_problem(corpus_dir: Path, image: str) -> str | None:
    path = PurePosixPath(image)
    if path.is_absolute() or ".." in path.parts or "\\" in image or ":" in image:
        return f"image must be a relative path inside the corpus: {image!r}"
    if not (corpus_dir / path).is_file():
        return f"image not found: {image!r}"
    return None
