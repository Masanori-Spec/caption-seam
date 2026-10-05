# Independent interval oracle

Run `npm run test:oracle` (Python 3 and Node 22+; no third-party Python package).
`npm test` additionally runs `oracle_contract.test.mjs` alongside the application's
unit tests. The oracle writes only temporary JSON and does not modify app files.

## What is independent

`oracle.py` never imports app code. It computes the length of retained source
strictly before each endpoint, using a sum of interval measures. The JavaScript
app instead applies accumulated offsets to interval intersections. The small
`oracle_bridge.mjs` adapter calls the app, normalizes field names, and translates
explicit decision formats; it performs no interval calculation or expected-output
construction. Python compares the resulting geometry, classification, full cue
text, numbering, SRT, and expected refusal of empty exports.

The 14-second fixture in `fixtures/hand_expected.json` is hand-calculated:

| Source cue | Retained source milliseconds | Output milliseconds | Decision |
|---|---|---|---|
| A | 1000–3000 | 1000–3000 | Automatic |
| B | 4000–5000; 8000–9000 | 4000–5000; 5000–6000 | Explicit split: “Before” / “and after” |
| C | 10000–11000 | 7000–8000 | Automatic |
| D | 11800–12000; 15000–15200 | 8800–9000; 9000–9200 | Explicit removal of both 200 ms fragments |
| E | 16000–17000 | 10000–11000 | Automatic |
| F | 18000–20000 | 12000–14000 | Automatic, two text lines preserved |

This produces six consecutively numbered cues. The output does not include D.
The source numbering used by the bridge is 7, 14, 21, …, so output numbering
cannot accidentally pass by copying the original indices.

## Cases and invariants

The deterministic seed produces 180 base cases and four related variants per
base case, plus the hand fixture, exact boundary probes, 499/500/501 ms probes,
and the 24-hour input limit: **919 cases / 4,079 input cues**.

- Half-open intervals: touching an excluded boundary never creates a fragment
- Source translation: shifting source cues and keep ranges equally leaves output
  geometry and classification unchanged
- Integer scaling: doubling all endpoints doubles output endpoints and duration;
  review classification may change at the fixed 500 ms threshold
- Redundant partitions: dividing a kept interval at a touching endpoint leaves
  geometry unchanged (the application coalesces adjacency)
- Trailing extension: adding kept duration after all cues changes duration only
- Every output has integer, positive-length, nonnegative, ordered intervals inside
  the output duration, with no overlaps or blank subtitle text
- Explicit split/fragment/continuous/removal decisions use synthetic reviewer text;
  no test expects inference about which source words survived
- SRT comparison normalizes only line-ending style and final newline count; all
  cue times, indices and internal text must match exactly

## Adversarial contracts

`oracle_contract.test.mjs` covers unresolved decisions, zero-cue exports, stale
source and keep-map bindings, a geometrically equivalent but differently encoded
keep map, unknown/automatic/removed decision targets, invalid action shapes,
missing fragment text, all fragment decisions, short-cue review, source overlap
and order, invalid timings, input limits, malformed UTF-8, BOM/CRLF input,
nonconsecutive source indices, markup/control/blank-line rejection, CSV formula
escaping, provenance of removal, and export non-mutation.

A regression test explicitly supplies `one\r\rtwo` as review text. Normalization
must occur before blank-line validation; accepting this string would otherwise
produce invalid SRT block boundaries.

## Reproduce or integrate another runner

```sh
python3 tests/oracle.py --self-test
python3 tests/oracle.py --write-cases /tmp/caption-cases.json
node tests/oracle_bridge.mjs /tmp/caption-cases.json /tmp/caption-results.json
python3 tests/oracle.py --check-results /tmp/caption-results.json
```

The bridge also reads JSON from stdin and emits JSON on stdout when file paths
are omitted. The separate consumer tests cover downstream readers; this oracle
is an interval/decision verifier, not a media-rendering or spoken-word-alignment
claim.
