#!/usr/bin/env python3
"""Independent integer-interval oracle for CaptionSeam; Python standard library only.

No application helper is imported. Expected interval mapping is computed from an
independent prefix-length integral and compared with normalized app output. The
six-cue fixture is hand-authored rather than copied from application results.

  python3 tests/oracle.py --self-test
  python3 tests/oracle.py --write-cases /tmp/caption-cases.json
  python3 tests/oracle.py --check-results /tmp/caption-results.json

If tests/oracle_bridge.mjs exists, the default invocation also compares the app
against all generated cases, through a separate Node process.
"""
from __future__ import annotations

import argparse
import copy
import json
import random
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
MIN_MS = 500
MAX_MS = 86_400_000  # Explicit application limit: 24 hours, integer milliseconds.


def integer(value):
    return isinstance(value, int) and not isinstance(value, bool)


def canonical_ranges(keep):
    if not isinstance(keep, list) or not keep:
        raise ValueError("At least one keep interval is required")
    merged = []
    for interval in keep:
        if not isinstance(interval, (list, tuple)) or len(interval) != 2:
            raise ValueError("Keep intervals need two endpoints")
        start, end = interval
        if not integer(start) or not integer(end) or not 0 <= start < end <= MAX_MS:
            raise ValueError("Keep endpoints must be valid integer milliseconds")
        if merged and start < merged[-1][1]:
            raise ValueError("Keep intervals must be sorted and nonoverlapping")
        if merged and start == merged[-1][1]:
            merged[-1][1] = end
        else:
            merged.append([start, end])
    return merged


def prefix_length(keep, point):
    """Measure of kept source strictly before a point; no app offset formula."""
    return sum(max(0, min(point, end) - start) for start, end in keep)


def fragments_for(cue, keep):
    ranges = canonical_ranges(keep)
    start, end = cue["startMs"], cue["endMs"]
    if not integer(start) or not integer(end) or not 0 <= start < end <= MAX_MS:
        raise ValueError("Cue endpoints must be valid integer milliseconds")
    fragments = []
    for left, right in ranges:
        # Strict inequalities make source intervals half-open: mere touching
        # never produces a fragment, an empty cue, or a duplicated millisecond.
        if start < right and end > left:
            a, b = max(start, left), min(end, right)
            fragments.append({"sourceStartMs": a, "sourceEndMs": b,
                              "startMs": prefix_length(ranges, a),
                              "endMs": prefix_length(ranges, b)})
    return fragments


def plan_for(cue, keep):
    fragments = fragments_for(cue, keep)
    retained = sum(f["sourceEndMs"] - f["sourceStartMs"] for f in fragments)
    untouched = retained == cue["endMs"] - cue["startMs"]
    if not fragments:
        status = "removed"
    elif untouched and len(fragments) == 1 and retained >= MIN_MS:
        status = "automatic"
    else:
        status = "review"
    return {"id": cue["id"], "status": status, "fragments": fragments}


def require_text(text):
    if not isinstance(text, str) or not text.strip():
        raise ValueError("An exported cue requires nonempty explicit text")
    if re.search(r"\n\s*\n", text):
        raise ValueError("Blank subtitle-text lines would create another SRT block")
    return text


def compile_reference(case):
    keep = canonical_ranges(case["keep"])
    output = []
    decisions = case.get("decisions", {})
    for cue in case["source"]:
        plan = plan_for(cue, keep)
        fragments = plan["fragments"]
        if plan["status"] == "removed":
            continue
        if plan["status"] == "automatic":
            selected = [(fragments[0], require_text(cue["text"]))]
        else:
            decision = decisions.get(cue["id"])
            if not isinstance(decision, dict):
                raise ValueError("Review decisions are required")
            action = decision.get("action")
            if action == "remove":
                selected = []
            elif action == "keep":
                index = decision.get("fragment")
                if not integer(index) or not 0 <= index < len(fragments):
                    raise ValueError("Choose an existing fragment")
                selected = [(fragments[index], require_text(decision.get("text")))]
            elif action == "split":
                texts = decision.get("texts")
                if len(fragments) < 2 or not isinstance(texts, list) or len(texts) != len(fragments):
                    raise ValueError("Each fragment needs independently supplied text")
                selected = [(fragment, require_text(text))
                            for fragment, text in zip(fragments, texts)]
            elif action == "continuous":
                if len(fragments) < 2:
                    raise ValueError("A continuous decision requires a cut")
                selected = [({"startMs": fragments[0]["startMs"],
                              "endMs": fragments[-1]["endMs"]},
                             require_text(decision.get("text")))]
            else:
                raise ValueError("Unknown review decision")
        for fragment, text in selected:
            output.append({"number": len(output) + 1,
                           "startMs": fragment["startMs"],
                           "endMs": fragment["endMs"], "text": text})
    verify_output(output, sum(b - a for a, b in keep))
    return output


def verify_output(output, duration_ms):
    if not output:
        raise ValueError("Empty subtitle output must not be exported")
    previous_end = 0
    for n, cue in enumerate(output, 1):
        if cue.get("number") != n:
            raise ValueError("Export numbering must be contiguous and start at one")
        start, end = cue.get("startMs"), cue.get("endMs")
        if not integer(start) or not integer(end) or not 0 <= start < end <= duration_ms:
            raise ValueError("Invalid exported cue duration")
        if start < previous_end:
            raise ValueError("Overlapping or unsorted exported cues")
        require_text(cue.get("text"))
        previous_end = end


def timestamp(ms):
    hours, rest = divmod(ms, 3_600_000)
    minutes, rest = divmod(rest, 60_000)
    seconds, millis = divmod(rest, 1000)
    return f"{hours:02d}:{minutes:02d}:{seconds:02d},{millis:03d}"


def write_srt(output):
    return "\n\n".join(f'{c["number"]}\n{timestamp(c["startMs"])} --> '
                        f'{timestamp(c["endMs"])}\n{c["text"]}' for c in output) + "\n"


def hand_case():
    return json.loads((HERE / "fixtures" / "hand_expected.json").read_text(encoding="utf-8"))


def case_record(name, keep, cues):
    case = {"name": name, "keep": keep, "source": cues,
            "durationMs": sum(b - a for a, b in canonical_ranges(keep)),
            "plans": [plan_for(c, keep) for c in cues], "decisions": {}}
    salt = sum(ord(c) for c in name)
    for i, plan in enumerate(case["plans"]):
        if plan["status"] != "review":
            continue
        fragments = plan["fragments"]
        choice = (i + salt) % 4
        if choice == 0:
            decision = {"action": "remove"}
        elif len(fragments) == 1 or choice == 1:
            decision = {"action": "keep", "fragment": len(fragments) - 1,
                        "text": f"Reviewed fragment {i} 日本語\nExplicit second line"}
        elif choice == 2:
            decision = {"action": "split", "texts": [f"Reviewed {i}/{j} independently"
                                                      for j in range(len(fragments))]}
        else:
            decision = {"action": "continuous", "text": f"Reviewed continuous {i} & seam"}
        case["decisions"][plan["id"]] = decision
    try:
        case["output"] = compile_reference(case)
        case["srt"] = write_srt(case["output"])
    except ValueError as error:
        if str(error) != "Empty subtitle output must not be exported":
            raise
        case["exportError"] = "EMPTY_EXPORT"
    return case


def generated_cases():
    cases = [hand_case()]
    # Exact cut endpoints and one-millisecond intersections. Each case is a
    # single cue so deliberately overlapping boundary probes remain valid input.
    bounds = [(0, 1), (0, 5000), (4999, 5000), (5000, 8000), (5000, 8001),
              (4999, 8000), (4999, 8001), (8000, 12000), (12000, 15000),
              (11999, 15001), (15000, 20000), (20000, 21000), (0, 21000)]
    for n, (start, end) in enumerate(bounds):
        cases.append(case_record(f"boundary-{n}", [[0, 5000], [8000, 12000], [15000, 20000]],
                                 [{"id": "1", "startMs": start, "endMs": end, "text": "Boundary"}]))
    for length in (1, 499, 500, 501):
        cases.append(case_record(f"threshold-{length}", [[1000, 10000]],
                                 [{"id": "1", "startMs": 1000, "endMs": 1000 + length,
                                   "text": "日本語 🪡\nA separate line"}]))
    cases.append(case_record("24-hour-edge", [[86_399_000, 86_400_000]],
                             [{"id": "1", "startMs": 86_399_000, "endMs": 86_400_000, "text": "Day end"}]))
    rng = random.Random(0xCA9710)
    # Reproducible base cases plus translation, scaling and redundant-boundary
    # transforms exercise arithmetic without assuming meaningful surviving words.
    for index in range(180):
        keep, cursor = [], rng.randrange(0, 5000)
        for _ in range(rng.randrange(1, 7)):
            length = rng.randrange(1, 7000)
            keep.append([cursor, cursor + length])
            cursor += length + rng.randrange(1, 5000)
        cues, position = [], 0
        for number in range(rng.randrange(1, 9)):
            position += rng.randrange(0, 3000)
            length = rng.randrange(1, 9000)
            cues.append({"id": str(number + 1), "startMs": position,
                         "endMs": position + length, "text": f"Cue {number + 1} 日本語\nline two"})
            position += length
        cases.append(case_record(f"random-{index}", keep, cues))
        shift = rng.randrange(1, 100_000)
        translated = [{**c, "startMs": c["startMs"] + shift, "endMs": c["endMs"] + shift} for c in cues]
        cases.append(case_record(f"translate-{index}", [[a + shift, b + shift] for a, b in keep], translated))
        scaled = [{**c, "startMs": c["startMs"] * 2, "endMs": c["endMs"] * 2} for c in cues]
        cases.append(case_record(f"scale-{index}", [[a * 2, b * 2] for a, b in keep], scaled))
        divided = []
        for a, b in keep:
            middle = (a + b) // 2
            divided.extend([[a, middle], [middle, b]] if a < middle < b else [[a, b]])
        cases.append(case_record(f"partition-{index}", divided, cues))
        trailing_start = max(keep[-1][1], cues[-1]["endMs"]) + 1000
        cases.append(case_record(f"append-{index}", keep + [[trailing_start, trailing_start + 1000]], cues))
    return cases


class OracleSelfTests(unittest.TestCase):
    def test_hand_calculated_mapping_and_export(self):
        case = hand_case()
        self.assertEqual(case["plans"], [plan_for(c, case["keep"]) for c in case["source"]])
        self.assertEqual(case["durationMs"], 14000)
        self.assertEqual(compile_reference(case), case["output"])
        self.assertEqual(write_srt(case["output"]), case["srt"])

    def test_no_implicit_word_inference(self):
        case = hand_case()
        del case["decisions"]["B"]
        with self.assertRaisesRegex(ValueError, "Review decisions"):
            compile_reference(case)
        case["decisions"]["B"] = {"action": "split", "texts": ["Before"]}
        with self.assertRaisesRegex(ValueError, "independently"):
            compile_reference(case)
        case["decisions"]["B"] = {"action": "split", "texts": ["", "and after"]}
        with self.assertRaisesRegex(ValueError, "nonempty"):
            compile_reference(case)

    def test_explicit_fragment_and_continuous(self):
        case = hand_case()
        case["decisions"]["B"] = {"action": "keep", "fragment": 1, "text": "Edited fragment"}
        self.assertEqual(compile_reference(case)[1], {"number": 2, "startMs": 5000, "endMs": 6000,
                                                    "text": "Edited fragment"})
        case["decisions"]["B"] = {"action": "continuous", "text": "Reviewed across the cut"}
        self.assertEqual(compile_reference(case)[1], {"number": 2, "startMs": 4000, "endMs": 6000,
                                                    "text": "Reviewed across the cut"})

    def test_half_open_boundaries(self):
        keep = [[0, 5000], [8000, 12000]]
        for start, end in ((5000, 8000), (12000, 13000)):
            cue = {"id": "x", "startMs": start, "endMs": end}
            self.assertEqual(plan_for(cue, keep)["status"], "removed")
        cue = {"id": "x", "startMs": 4999, "endMs": 8001}
        self.assertEqual(fragments_for(cue, keep), [
            {"sourceStartMs": 4999, "sourceEndMs": 5000, "startMs": 4999, "endMs": 5000},
            {"sourceStartMs": 8000, "sourceEndMs": 8001, "startMs": 5000, "endMs": 5001}])

    def test_short_threshold(self):
        for length, status in ((499, "review"), (500, "automatic"), (501, "automatic")):
            self.assertEqual(plan_for({"id": "x", "startMs": 0, "endMs": length}, [[0, 1000]])["status"], status)

    def test_invalid_ranges(self):
        for keep in ([], [[2, 1]], [[1, 1]], [[-1, 1]], [[0, 1.5]], [[False, 3]],
                     [[0, 3], [2, 5]], [[10, 20], [0, 5]], [[0]], [[0, MAX_MS + 1]]):
            with self.subTest(keep=keep), self.assertRaises(ValueError):
                canonical_ranges(keep)

    def test_bad_exports(self):
        good = hand_case()["output"]
        variants = [[], [{**good[0], "number": 2}], [{**good[0], "text": "  "}],
                    [{**good[0], "text": "first\n\nsecond"}], [{**good[0], "endMs": 1000}],
                    [{**good[0], "startMs": -1}], [{**good[0], "endMs": 14001}],
                    [good[0], {**good[1], "startMs": 2000}],
                    [{**good[0], "startMs": 1000.5}]]
        for output in variants:
            with self.subTest(output=output), self.assertRaises(ValueError):
                verify_output(output, 14000)

    def test_result_checker_detects_corrupted_app_results(self):
        case = hand_case()
        valid = {key: copy.deepcopy(case[key]) for key in ("name", "durationMs", "plans", "output", "srt")}
        self.assertEqual(check_results([valid], [case]), {"cases": 1, "cues": 6})
        mutations = []
        bad = copy.deepcopy(valid); bad["durationMs"] += 1; mutations.append(bad)
        bad = copy.deepcopy(valid); bad["plans"][1]["fragments"][1]["startMs"] += 1; mutations.append(bad)
        bad = copy.deepcopy(valid); bad["plans"][1]["status"] = "automatic"; mutations.append(bad)
        bad = copy.deepcopy(valid); bad["output"][1]["text"] = "Unreviewed inferred words"; mutations.append(bad)
        bad = copy.deepcopy(valid); bad["output"][1]["number"] = 7; mutations.append(bad)
        bad = copy.deepcopy(valid); bad["srt"] = bad["srt"].replace("00:00:07,000", "00:00:08,000"); mutations.append(bad)
        for bad in mutations:
            with self.subTest(bad=bad), self.assertRaises((AssertionError, ValueError)):
                check_results([bad], [case])
        with self.assertRaises(AssertionError):
            check_results([valid, valid], [case])
        with self.assertRaises(AssertionError):
            check_results([], [case])

    def test_reproducible_metamorphic_geometry(self):
        cases = generated_cases()
        by_name = {case["name"]: case for case in cases}
        for index in range(180):
            base = by_name[f"random-{index}"]
            translated = by_name[f"translate-{index}"]
            scaled = by_name[f"scale-{index}"]
            partitioned = by_name[f"partition-{index}"]
            self.assertEqual(base["plans"], partitioned["plans"])
            appended = by_name[f"append-{index}"]
            self.assertEqual(base["plans"], appended["plans"])
            self.assertEqual(base["durationMs"] + 1000, appended["durationMs"])
            self.assertEqual(base["durationMs"], translated["durationMs"])
            self.assertEqual(base["durationMs"] * 2, scaled["durationMs"])
            for original, shifted, doubled in zip(base["plans"], translated["plans"], scaled["plans"]):
                self.assertEqual(original["status"], shifted["status"])
                self.assertEqual(len(original["fragments"]), len(shifted["fragments"]))
                self.assertEqual(len(original["fragments"]), len(doubled["fragments"]))
                for a, b, c in zip(original["fragments"], shifted["fragments"], doubled["fragments"]):
                    self.assertEqual((a["startMs"], a["endMs"]), (b["startMs"], b["endMs"]))
                    self.assertEqual((a["startMs"] * 2, a["endMs"] * 2), (c["startMs"], c["endMs"]))


def check_results(results, cases=None):
    cases = generated_cases() if cases is None else cases
    expected = {case["name"]: case for case in cases}
    if not isinstance(results, list):
        raise AssertionError("App result must be a JSON array")
    if len(results) != len(expected) or {r.get("name") for r in results} != set(expected):
        raise AssertionError("App results must include every unique generated case exactly once")
    checked = 0
    for actual in results:
        case = expected[actual["name"]]
        for key in ("durationMs", "plans"):
            if actual.get(key) != case[key]:
                raise AssertionError(f'{case["name"]} {key} mismatch\nexpected: {case[key]!r}\nactual: {actual.get(key)!r}')
        if "output" in case:
            verify_output(actual.get("output", []), actual["durationMs"])
            if actual["output"] != case["output"]:
                raise AssertionError(f'{case["name"]} output mismatch')
            # SRT line endings and trailing newline are transport choices; all
            # block text, times and numbering must still match byte-for-byte.
            if actual.get("srt", "").replace("\r\n", "\n").rstrip("\n") != case["srt"].rstrip("\n"):
                raise AssertionError(f'{case["name"]} SRT mismatch')
        if "exportError" in case and actual.get("exportError") != case["exportError"]:
            raise AssertionError(f'{case["name"]} expected export refusal {case["exportError"]!r}, got {actual.get("exportError")!r}')
        checked += len(case["source"])
    return {"cases": len(results), "cues": checked}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--write-cases", type=Path)
    parser.add_argument("--check-results", type=Path)
    args = parser.parse_args()
    if args.write_cases:
        args.write_cases.write_text(json.dumps(generated_cases(), ensure_ascii=False), encoding="utf-8")
        print(f"Wrote {len(generated_cases())} independent oracle cases")
        return 0
    if args.check_results:
        report = check_results(json.loads(args.check_results.read_text(encoding="utf-8")))
        print(json.dumps({"ok": True, **report}))
        return 0
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(OracleSelfTests))
    if not result.wasSuccessful():
        return 1
    bridge = HERE / "oracle_bridge.mjs"
    if not args.self_test and bridge.exists():
        with tempfile.TemporaryDirectory(prefix="caption-seam-oracle-") as temp:
            inputs, outputs = Path(temp) / "cases.json", Path(temp) / "results.json"
            inputs.write_text(json.dumps(generated_cases(), ensure_ascii=False), encoding="utf-8")
            subprocess.run(["node", str(bridge), str(inputs), str(outputs)], cwd=ROOT, check=True)
            report = check_results(json.loads(outputs.read_text(encoding="utf-8")))
            print(json.dumps({"ok": True, "independentOracle": report}))
    elif not args.self_test:
        print("App comparison not run: tests/oracle_bridge.mjs is not present", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
