import json

import pytest
from ptc_eval.__main__ import main
from ptc_test_doubles import START, START_NO_E2, failure, success

RECOGNIZER = "ptc_test_doubles:make_scripted_recognizer"


def line(id, *, placement=START, set_id="set-1", split="dev", image=None, **extra):
    record = {
        "id": id,
        "image": image or f"{id}.png",
        "kind": "photo",
        "set_id": set_id,
        "split": split,
        "source": "test",
        "license": "test",
        **extra,
    }
    if placement is not None:
        record["placement"] = placement
    return json.dumps(record)


@pytest.fixture
def corpus(tmp_path):
    def build(lines, contents=None):
        directory = tmp_path / "corpus"
        directory.mkdir()
        (directory / "manifest.jsonl").write_text("\n".join(lines) + "\n", encoding="utf-8")
        for text in lines:
            record = json.loads(text)
            image = directory / record["image"]
            image.write_bytes((contents or {}).get(record["id"], b"image"))
        return directory

    return build


def read_report(path):
    return json.loads(path.read_text(encoding="utf-8"))


def test_run_with_recognizer_writes_report(corpus, tmp_path):
    directory = corpus([line("a"), line("b", placement=START_NO_E2)])
    report = tmp_path / "out" / "report.json"
    code = main(["run", str(directory), "--recognizer", RECOGNIZER, "--output", str(report)])
    assert code == 0
    data = read_report(report)
    assert data["summary"]["boards"] == 2
    assert data["summary"]["square_error_overall"] == 1 / 128
    assert data["summary"]["latency_ms_p50"] is not None
    assert data["images"][1]["unflagged_wrong_squares"] == ["e2"]


def test_a_crash_is_scored_and_does_not_abort_the_run(corpus, tmp_path, capsys):
    directory = corpus([line("a"), line("b")], {"b": b"crash"})
    report = tmp_path / "report.json"
    code = main(["run", str(directory), "--recognizer", RECOGNIZER, "--output", str(report)])
    assert code == 0
    assert read_report(report)["summary"]["failures"] == {"crash": 1}
    assert "Engine crashed on b" in capsys.readouterr().err


def test_gates(corpus, tmp_path, capsys):
    directory = corpus([line("a", placement=START_NO_E2)])
    args = ["run", str(directory), "--recognizer", RECOGNIZER]
    args += ["--output", str(tmp_path / "r.json")]
    assert main([*args, "--gate", "square_error_overall<=0.5"]) == 0
    assert main([*args, "--gate", "square_error_overall<=0.001"]) == 1
    assert "FAIL" in capsys.readouterr().out


def test_gate_on_a_metric_with_no_value_fails(corpus, tmp_path):
    directory = corpus([line("a")])
    args = ["run", str(directory), "--recognizer", RECOGNIZER]
    args += ["--output", str(tmp_path / "r.json"), "--gate", "flag_recall>=0.9"]
    assert main(args) == 1


@pytest.mark.parametrize("gate", ["nonsense", "not_a_metric<=1"])
def test_bad_gates_are_errors(corpus, tmp_path, gate):
    directory = corpus([line("a")])
    args = ["run", str(directory), "--recognizer", RECOGNIZER]
    assert main([*args, "--output", str(tmp_path / "r.json"), "--gate", gate]) == 2


def test_no_images_is_an_error_and_not_a_perfect_score(corpus, tmp_path, capsys):
    directory = corpus([line("a", split="dev")])
    args = ["run", str(directory), "--recognizer", RECOGNIZER, "--split", "holdout"]
    assert main([*args, "--output", str(tmp_path / "r.json")]) == 2
    assert "no images to score" in capsys.readouterr().err
    assert not (tmp_path / "r.json").exists()


def test_predictions_file(corpus, tmp_path):
    directory = corpus([line("a"), line("b")])
    predictions = tmp_path / "predictions.jsonl"
    predictions.write_text(
        "\n".join(
            json.dumps({"id": id, "response": response.model_dump(mode="json")})
            for id, response in [("a", success()), ("b", failure())]
        ),
        encoding="utf-8",
    )
    report = tmp_path / "report.json"
    code = main(["run", str(directory), "--predictions", str(predictions), "--output", str(report)])
    assert code == 0
    summary = read_report(report)["summary"]
    assert summary["recognised_rate"] == 0.5
    assert summary["latency_ms_p50"] is None


def test_missing_prediction_is_an_error(corpus, tmp_path, capsys):
    directory = corpus([line("a"), line("b")])
    predictions = tmp_path / "predictions.jsonl"
    predictions.write_text(
        json.dumps({"id": "a", "response": success().model_dump(mode="json")}), encoding="utf-8"
    )
    code = main(["run", str(directory), "--predictions", str(predictions)])
    assert code == 2
    assert "no prediction for 1 images" in capsys.readouterr().err


def test_invalid_prediction_is_an_error(corpus, tmp_path):
    directory = corpus([line("a")])
    predictions = tmp_path / "predictions.jsonl"
    predictions.write_text(json.dumps({"id": "a", "response": {"status": "ok"}}), encoding="utf-8")
    assert main(["run", str(directory), "--predictions", str(predictions)]) == 2


def test_unloadable_recognizer_is_an_error(corpus, capsys):
    directory = corpus([line("a")])
    assert main(["run", str(directory), "--recognizer", "no_such_module:make"]) == 2
    assert main(["run", str(directory), "--recognizer", "no-colon"]) == 2
    assert "module:factory" in capsys.readouterr().err


def test_refusal_images_are_scored_separately(corpus, tmp_path):
    directory = corpus([line("a"), line("r", placement=None, expected_failure="no_board_detected")])
    report = tmp_path / "report.json"
    assert main(["run", str(directory), "--recognizer", RECOGNIZER, "--output", str(report)]) == 0
    data = read_report(report)
    assert data["summary"]["boards"] == 1
    assert data["refusals"]["false_accepts"] == 1


def test_validate_accepts_good_corpus(corpus, capsys):
    assert main(["validate", str(corpus([line("a"), line("b")]))]) == 0
    assert "2 images" in capsys.readouterr().out


def test_validate_reports_every_problem(corpus, capsys):
    directory = corpus([line("a"), line("b")])
    (directory / "manifest.jsonl").write_text(
        "\n".join(
            [
                line("a"),
                line("a", image="b.png"),
                line("c", image="missing.png"),
                line("d", image="../outside.png"),
                line("e", image="a.png", placement="not-a-fen"),
                line("f", image="a.png", placement=None),
                line("g", image="a.png", expected_failure="no_board_detected"),
                line("h", image="a.png", split="holdout"),
                "{broken",
            ]
        ),
        encoding="utf-8",
    )
    assert main(["validate", str(directory)]) == 2
    err = capsys.readouterr().err
    assert "duplicate id 'a'" in err
    assert "image not found: 'missing.png'" in err
    assert "inside the corpus" in err
    assert "placement" in err
    assert "exactly one of placement or expected_failure" in err
    assert "appears in both dev and holdout" in err
    assert "invalid JSON" in err


def test_missing_manifest(tmp_path, capsys):
    assert main(["validate", str(tmp_path)]) == 2
    assert "manifest not found" in capsys.readouterr().err
