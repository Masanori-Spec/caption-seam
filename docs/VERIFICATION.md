# Verification status

## Local candidate checks, 2026-10-05

- 25 Node contract/security regression tests: passed
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
