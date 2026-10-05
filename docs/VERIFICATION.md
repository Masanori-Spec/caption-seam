# Verification status

## Local candidate checks, 2026-10-05

- 35 Node tests (25 core/contract/security regressions and 10 native-boundary/playback guards): passed
- Independent Python oracle: 9 self-tests, 919 deterministic cases, 4,079 source cues: passed
- Oracle outcomes: 818 complete exports and 101 expected empty-export refusals
- Deterministic standalone build: passed
- FFprobe/FFmpeg on the CLI-produced authored main fixture: passed; all six packet starts, durations and UTF-8 payloads match the hand-authored expectation, including multiline text and SRT→WebVTT conversion
- Independent code review found and fixed CR-normalization validation, separate-input upload races, oversized self-replay decisions, unpaired Unicode surrogates, and legacy ASS escapes

## Required hosted acceptance, not yet run in this candidate

This local executor denies Chromium process sockets. It cannot perform trustworthy local browser capture, download, or native-track checks. The author did not disable the browser sandbox or claim screenshots were reviewed here.

The committed Ubuntu 22.04 workflow must pass all of these before calling the release fully verified:

1. Node 22 and Node 24 core/oracle plus exact committed-build comparison
2. Sandboxed Chromium UI, input/replay/reset races, actual five-file download, JA/EN desktop and mobile capture, enlarged text, A4 PDF/render checks
3. Real native HTML track parsing of the downloaded VTT; `activeCues` and visible text at 34 positions (before/exact/after each boundary); independent positive control and two deliberate corruptions
4. Separate FFprobe/FFmpeg job reading the actual browser artifacts, verifying their download hashes, exact packet start/duration/text, and SRT→VTT conversion; four deliberate corruptions must fail
5. Human/agent pixel review of the resulting JA/EN desktop, mobile and rendered A4 pages

Until the hosted result and pixel review are recorded, browser/print/native-track behavior is an implemented test target, not an observed pass. No test establishes synchronization against an arbitrary real edited video.

## Native exact-end observation

The first hosted native run reached its independent hand-written positive control, then observed Chromium retaining the ending cue at an exact paused seek to 3.000 seconds. This is distinct from the HTML Standard's half-open current-cue rule. The export interval math is unchanged. The harness retains exact parsed-time assertions and strict checks just before/after each boundary. Exact samples must match either the full half-open set or the narrowly defined end-inclusive native set, must be stable on repeated observation, and the actual downloaded VTT must reproduce the independent control's exact snapshot. Every discrepancy from the standard is reported explicitly. Missing a newly starting cue or adding an unrelated cue still fails. This is consumer-equivalence evidence, not a claim that Chromium conforms at an exact paused endpoint. [HTML time-marches-on algorithm](https://html.spec.whatwg.org/multipage/media.html#time-marches-on)


A further real 1× playback pass records native cue `enter`/`exit` and `cuechange` events and animation-frame `activeCues` snapshots through the whole generated video. It requires one enter and exit per expected cue, nearby cuechange evidence, finite monotonic media time, sampled and event-reported 1× rate, and strict active-cue text/time states outside a 30 ms endpoint guard window, including observations on both sides of every boundary. Event offsets must be within 150 ms; that is a declared test observation tolerance, not a standards claim. Those measured offsets and all raw observations are retained. Guard tests reject missing/extra/late events, wrong text, sparse observations, speed changes and incomplete playback.

Hosted run 2 produced readable JA/EN desktop, mobile, enlarged-text and A4 print evidence. Pixel review found a ghosted offscreen skip link in one desktop capture; its unfocused opacity is now zero, with explicit visible-on-focus and hidden-after-focus browser assertions. Updated capture acceptance awaits the rerun.
