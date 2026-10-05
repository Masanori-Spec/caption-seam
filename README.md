# CaptionSeam

**Cut the footage. Keep the meaning.**

A local-first, Japanese/English subtitle handoff tool for one source video shortened by several cuts. It moves safe captions automatically, then asks a person to decide the text at each edit seam. It exports a single concatenated recut track, not a batch of separate clips.

Open `dist/index.html` in a modern browser. There is no installation, server, account, API key, runtime dependency, telemetry, or external network request. The application also works from a local `file://` URL. Inputs live in page memory only; closing or resetting the page discards them.

## Workflow

1. Load or paste a plain UTF-8 SRT file.
2. Specify the **actual** source intervals retained in the edited video, using integer milliseconds:

```json
{"version":1,"keep":[
  {"startMs":0,"endMs":5000},
  {"startMs":8000,"endMs":12000},
  {"startMs":15000,"endMs":20000}
]}
```

3. Select **Find the seams**. The example above produces a 14-second timeline.
4. Review every clipped, split, or short surviving cue. Choose one retained fragment with reviewed text; split with separately entered text for every fragment; retain one continuous cue across the resulting cut; or remove the cue. Split editors begin empty. No words are assigned by duration or guessed from the audio.
5. Save each decision. Prepare the exports only after every required decision is resolved.
6. Download `recut.srt`, `recut.vtt`, `decisions.json`, `provenance.json`, and `review.csv`. Loading the decision file against the exact same inputs restores the reviewed work. Edited source or cut intervals reject stale decisions.

The interface includes keyboard-accessible controls, visible focus, a skip link, Japanese/English text, responsive layouts, a source keep/remove timeline, and print styles. Actual browser and print acceptance are separate gates; see [verification status](docs/VERIFICATION.md).

## Bounded semantics

- Single source, chronological order, speed exactly 1×; no repeated/reordered segments.
- Half-open intervals `[startMs, endMs)`. A cue that only touches an endpoint has no surviving duration there.
- Keep intervals must be ascending, non-overlapping, positive-duration integer milliseconds. Adjacent intervals are treated as one continuous keep for geometry. Their original representation remains part of the decision hash.
- Input cues must be chronological and non-overlapping; positive, unique SRT numbers are accepted even when nonconsecutive. Output numbers are consecutive from 1.
- Wholly retained cues move without text changes. Wholly removed cues get a review record. Any clipped/split cue and any surviving fragment shorter than 500 ms requires review. The fixed 500 ms threshold is a tool warning, **not** a broadcast/accessibility compliance standard.
- Caption text is plain UTF-8. Multiline text, Japanese, emoji, whitespace, and literal ampersands are preserved. HTML tags, ASS override syntax/newline escapes, blank lines inside a cue, invalid Unicode, timing arrows in text, and control characters are rejected.
- Limits: 2,000,000 UTF-8 source bytes; 5,000 source cues; 500 keep intervals; 10,000 UTF-16 code units per cue or reviewed fragment; times from 0 through 24 hours; 8,000,000 UTF-8 bytes for the complete pretty-printed decision file. Oversized decisions cannot be saved/exported, so every accepted decision export is replayable within the same limit.
- All final subtitle exports are blocked while decisions are unresolved. Empty subtitle tracks are not emitted.
- SHA-256 of the exact SRT editor text encoded as UTF-8, canonical keep-map SHA-256, algorithm/threshold basis hash, source ordinal plus content hash, source ranges, output ranges, and original text bind the decision record. The browser may normalize uploaded CRLF to LF and remove a UTF-8 BOM before the text enters the editor; the source hash binds that editor text, not necessarily the original file bytes. These hashes detect changes; they do not authenticate another person's file.
- CSV formula-like text cells are prefixed with an apostrophe for spreadsheet safety. The JSON/SRT/VTT artifacts retain the authored text.

### Important synchronization limit

Use intervals from the **actual cut result**, not merely a planned edit list. Lossless/keyframe cutters may move planned boundaries. CaptionSeam does not read the edited video or verify spoken-word alignment and cannot guarantee synchronization with it. Speed changes, frame-rate conversion, styled subtitles, transcription, forced alignment, multiple sources, and automatic reading-quality compliance are out of scope. No LosslessCut CSV import is claimed.

## Why this exists

Existing subtitle tools already retime, split, and export captions. The particular handoff here is a **single concatenated recut with mandatory per-cue seam text decisions and short-fragment review**. It is not a claim of a new subtitle algorithm or an absence of alternatives. [Research and comparison](docs/RESEARCH.md) describes the original workflow reports, Clip Caption Kit, Subtitle Edit, and the existing DaVinci Resolve alternative.

## Reproduce checks

Node 22+ and Python 3.12+ are sufficient for the core, independent oracle, deterministic build, and source packaging. Playwright is development-only.

```sh
npm ci --ignore-scripts
npm run check
node scripts/export-example.mjs
python3 tests/consumers.py artifacts/cli --input-origin cli-export
```

The last command requires FFmpeg/FFprobe and tests **CLI-produced files**, not browser downloads. The exact-input example exports appear under `artifacts/cli`.

For real browser/download/media-consumer checks on a browser-capable Linux host:

```sh
npx --no-install playwright install --with-deps chromium
# Install official distribution ffmpeg, fonts-noto-cjk and poppler-utils.
npm run build
npm run test:browser
npm run test:consumers
```

The browser runs with its sandbox enabled. `CHROME_BIN` can select an installed Chromium. Tests serve only `127.0.0.1`, save actual downloaded bytes, capture JA/EN desktop/mobile/enlarged-text screenshots and A4 PDFs, render PDF pages, and verify stale-state/reset/replay paths. The native media test consumes the downloaded WebVTT through a real `<track src>` element and native `activeCues`; it never creates `VTTCue` objects from app state. Its own generated test video has a 14-second caption timeline plus 250 ms of tail so the final cue's end can be tested from both sides. Temporary video bytes are deleted and never packaged. The FFmpeg gate requires the passing browser report and exact download SHA-256 before calling those files browser downloads.

GitHub Actions runs Node 22/24 core+oracle checks, sandboxed Chromium on Ubuntu 22.04, and FFprobe/FFmpeg in a separate downstream job over actual browser artifacts. Workflow permissions are `contents: read`; no deployment, secret, write token, paid plan, or elevated repository permission is needed.

```sh
python3 scripts/package.py ../caption-seam-output
```

This creates a deterministic source ZIP and per-file SHA-256 manifest, copies the standalone HTML, and creates an authored example bundle. The source archive excludes dependencies, browser/FFmpeg binaries, fonts, generated video, traces, and local test results. See [third-party tools](docs/THIRD_PARTY.md).

## 日本語

元のSRTと実際に残した区間を読み込み、字幕がカットをまたぐ部分だけを確認するツールです。安全に残る字幕は自動で移動し、途中が切れる字幕・複数区間に分かれる字幕・500 ms未満の残存区間は、人がテキストを確認するまで書き出せません。入力や保存した判断が変わった場合は古い出力を無効にします。

分割した字幕に元の全文を自動で複製したり、秒数の比率から残る単語を推測したりしません。最終映像との同期、発話との一致、読みやすさの規格適合は保証しません。キーフレームによる切り出しでは予定と実際のカット位置がずれるため、実際の保持区間を入力してください。
