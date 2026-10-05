# Verification

## Verified implementation snapshot

Verified on 2026-10-05:

- Implementation commit: [`9405ecbd0779a324f83d82bfb9a166333335b138`](https://github.com/Masanori-Spec/caption-seam/commit/9405ecbd0779a324f83d82bfb9a166333335b138)
- GitHub Actions run: [`37283420602`](https://github.com/Masanori-Spec/caption-seam/actions/runs/37283420602)
- All four jobs passed: Node 22 core/oracle, Node 24 core/oracle, sandboxed browser/native track, and independent FFmpeg over the actual browser downloads
- Runner: Ubuntu 22.04
- Chromium: `154.0.8037.57`, sandbox enabled
- FFmpeg/FFprobe: `4.4.2-0ubuntu0.22.04.1`

This document records that exact implementation snapshot. Later documentation-only commits must still have their own head checks reviewed; the evidence below does not claim an unobserved future run.

## Core and independent oracle

- 39 Node tests: 25 core/contract/security regressions and 14 native-boundary/playback guards
- Independent Python oracle: 9 self-tests, 919 deterministic cases, 4,079 source cues
- Oracle outcomes: 818 complete exports and 101 expected empty-export refusals
- Deterministic standalone build matched the committed HTML
- Genuine clean npm installations succeeded after regenerating the malformed optional-dependency lock entry; a dry-run alone was insufficient installation evidence

The independent model covers interval geometry, half-open boundaries, unchanged multiline/Unicode text, source/cut-map stale decisions, explicit fragment/split/continuous/removal choices, short-fragment review, numbering and deterministic output. See [oracle methodology](../tests/ORACLE.md).

## Actual browser and download checks

29 browser groups passed, with zero page errors and zero external requests during the app workflow. Coverage includes actual SRT/keep-map uploads, explicit editorial choices, unresolved/empty-text blocking, source/map invalidation, deterministic decision replay, same-input and cross-input read races, reset during a pending read, UTF-8/markup rejection, and standalone `file://` operation.

All five actual browser downloads were hashed. The separate FFmpeg job verified the SRT/VTT hashes before consuming those two files:

- `recut.srt`: `191727dd54b2a0b99810fd82e5cd940eff89151e8fa453d431a3dda9f9c40d09`
- `recut.vtt`: `140c995527f5d3a80c8076c874d342a1df065855cd293e69bae5498f6d6fb9ec`
- `decisions.json`: `1ff7b7273ca8623c184a9a944c81b3535ef637d77ab3ee0408cc24a418701fac`
- `provenance.json`: `fc7558bd84e0dab02bad139dcd83a73393b51d513945ffe5aff03b85ac877aa1`
- `review.csv`: `fe7bb1068a85b5a84b827221a7f4a5006e502810e0773b437e8da714208039cc`

FFprobe independently confirmed all six cue start times, durations and decoded UTF-8 payloads. FFmpeg SRT→WebVTT conversion retained the expected fixture values. Four deliberate timing/text corruptions were rejected. This gate read the browser-download artifacts, not a separately generated replacement.

## Native WebVTT consumer

The actual downloaded VTT was loaded through a real HTML `<track src>` and parsed by Chromium. No `VTTCue` objects were constructed from app data. Exact parsed cue times and visible `getCueAsHTML().textContent` matched the independent handwritten fixture. There were 34 before/exact/after seek observations, repeated observations at every exact boundary, and two rejected negative controls. A separate actual Unicode download preserved Japanese, emoji, literal ampersand/entity text and a newline in native rendering.

### Explicit paused-seek limitation

Chromium retained ending cues on exact paused seeks at **3, 5, 6, 8, 11 and 14 seconds**. At 5 seconds this includes the preceding cue alongside the newly starting cue. The same behavior occurred in the independently authored positive control and the app's actual exported file.

The HTML Standard specifies a half-open current-cue interval. Therefore this result is **consumer equivalence with an observed native exact-end discrepancy**, not a browser standards-conformance claim. Application interval math remains half-open and is unchanged. Parsed timestamps and just-before/after checks remain strict. Exact samples must be either the complete half-open set or the narrowly defined complete end-inclusive set, must remain stable, and the actual download must match the independent control's exact observation. Missing new cues, unrelated cues, altered text/bounds and control mismatches fail. [HTML time-marches-on algorithm](https://html.spec.whatwg.org/multipage/media.html#time-marches-on)

### Real 1× playback

Both the independent control and the actual exported track passed on their **first playback attempt; no retry was used**:

- Each produced 857 animation-frame observations, 12 native cue enter/exit events and 11 cuechange events
- Maximum measured cue-event offset: 1.164 ms for the control and 1.052 ms for the actual download
- Media time was finite and monotonic; sampled rate and ratechange observations remained 1×; playback reached the end
- Active cue states were checked strictly outside a 30 ms endpoint observation guard, with observations on both sides of every boundary
- Each expected cue had exactly one enter and exit event, plus nearby cuechange evidence

The 30 ms guard and 150 ms event-offset ceiling are declared test tolerances, not claims about caption standards or arbitrary real-world playback. Raw observations and measured offsets are retained in the workflow artifact.

An earlier run failed after a 241 ms observation gap across the final boundary. Its stale sample at 14.151258s was followed by removal at 14.151844s and an exit event at 14.152176s. That failure is preserved and is not counted as passing playback. The harness now records wall-clock observations and permits one diagnostic retry only when a measured gap over 100 ms crosses the specific failing boundary and the observed state exactly matches the known pre-gap cue set, an event arrives within 5 ms of the gap ending, or the gap caused missing sampling coverage. Both attempts remain visible; assertions are unchanged. Wrong payloads, unrelated cues, ordinary timing failures and any second failure still fail. The successful implementation snapshot above did not need this retry.

## Visual review

JA/EN desktop, initial and unresolved states, 390 px mobile, enlarged-text reflow, and all six rendered JA/EN A4 pages were inspected. Split texts and the final multiline caption remain readable; no overlapping content, clipped review cards, missing-glyph squares or document-level horizontal overflow were found. The offscreen skip-link capture defect was fixed and the final screenshot plus focused/unfocused assertions confirm the correction.

## Scope of the evidence

The generated monochrome video is a test-only fixture with a 14-second caption timeline plus 250 ms of tail; it is deleted and never distributed. No test proves synchronization with an arbitrary edited video, exact spoken-word alignment, reading-quality/accessibility compliance, or behavior in every subtitle player. Actual retained source intervals are required; planned keyframe cuts can differ. No speed changes, frame-rate conversion, reordered/repeated segments, multiple sources or styled captions are supported.
