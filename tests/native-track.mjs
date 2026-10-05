/** Independent native Chromium WebVTT acceptance gate.
 *
 * verifyNativeTrack(page, actualDownloadPathOrBytes, { outputDir })
 * Replaces the supplied page with an isolated real <video><track> consumer.
 * Never imports the app, parses VTT in JS, or constructs VTTCue objects.
 * The test-only FFmpeg video lives in an OS temp directory and is deleted.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';

const execFileAsync = promisify(execFile);
export const EXPECTED_NATIVE_CUES = Object.freeze([
  { start: 1, end: 3, text: 'Welcome' },
  { start: 4, end: 5, text: 'Before' },
  { start: 5, end: 6, text: 'and after' },
  { start: 7, end: 8, text: 'Middle' },
  { start: 10, end: 11, text: 'Resume' },
  { start: 12, end: 14, text: 'Last\ncaption' },
].map(Object.freeze));

// A hand-written independent positive control; deliberately not app output.
const POSITIVE_CONTROL = `WEBVTT

00:00:01.000 --> 00:00:03.000
Welcome

00:00:04.000 --> 00:00:05.000
Before

00:00:05.000 --> 00:00:06.000
and after

00:00:07.000 --> 00:00:08.000
Middle

00:00:10.000 --> 00:00:11.000
Resume

00:00:12.000 --> 00:00:14.000
Last
caption
`;
const BOUNDARIES = [1, 3, 4, 5, 6, 7, 8, 10, 11, 12, 14];
// 14 seconds of caption timeline plus tail, required to seek AFTER its final end.
const VIDEO_SECONDS = 14.25;
const EPSILON_SECONDS = 0.01;

class NativeCaptionMismatch extends Error {
  constructor(message) { super(message); this.name = 'NativeCaptionMismatch'; }
}
function same(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new NativeCaptionMismatch(`${label}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}
async function inputBytes(input) {
  if (typeof input === 'string' || input instanceof URL) return fs.readFile(input);
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) return Buffer.from(input);
  if (input instanceof ArrayBuffer) return Buffer.from(input);
  throw new TypeError('Pass the actual downloaded VTT path, Buffer, Uint8Array, or ArrayBuffer');
}
async function videoFixture() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'caption-seam-native-'));
  try {
    const filename = path.join(directory, 'test-only-lavfi.webm');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
      'color=c=black:s=64x64:r=100', '-t', String(VIDEO_SECONDS), '-an', '-c:v',
      'libvpx', '-g', '1', '-pix_fmt', 'yuv420p', '-threads', '1', '-cpu-used', '8', filename];
    await execFileAsync('ffmpeg', args, { timeout: 30000 });
    const bytes = await fs.readFile(filename);
    const { stdout } = await execFileAsync('ffmpeg', ['-version']);
    return { bytes, ffmpeg: stdout.split('\n')[0], args: args.slice(0, -1).concat('<temporary-file>') };
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
}
async function loadNativeTrack(page, videoBytes, vttBytes) {
  await page.goto('about:blank');
  await page.setContent('<!doctype html><html lang="en"><meta charset="UTF-8"><title>CaptionSeam independent native track test</title><body><h1>Native WebVTT consumer</h1></body></html>');
  return page.evaluate(async ({ videoBase64, vttBase64 }) => {
    const bytes = b64 => Uint8Array.from(atob(b64), character => character.charCodeAt(0));
    const videoUrl = URL.createObjectURL(new Blob([bytes(videoBase64)], { type: 'video/webm' }));
    const vttUrl = URL.createObjectURL(new Blob([bytes(vttBase64)], { type: 'text/vtt;charset=utf-8' }));
    const video = document.createElement('video');
    video.id = 'native-video'; video.controls = true; video.muted = true; video.preload = 'auto';
    video.width = 640; video.height = 360;
    const track = document.createElement('track');
    track.id = 'native-track'; track.kind = 'subtitles'; track.srclang = 'en'; track.label = 'Actual exported VTT'; track.default = true;
    const loaded = (element, event, failure) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${event} timed out`)), 10000);
      element.addEventListener(event, () => { clearTimeout(timer); resolve(); }, { once: true });
      element.addEventListener(failure, () => { clearTimeout(timer); reject(new Error(`Native consumer ${failure}: ${element.error?.message || element.tagName}`)); }, { once: true });
    });
    const videoReady = loaded(video, 'loadeddata', 'error');
    const trackReady = loaded(track, 'load', 'error');
    video.append(track); document.body.append(video);
    video.src = videoUrl; track.src = vttUrl; track.track.mode = 'showing';
    await Promise.all([videoReady, trackReady]);
    video.pause();
    window.__nativeConsumer = { video, track, videoUrl, vttUrl };
    return {
      duration: video.duration, readyState: track.readyState,
      cues: Array.from(track.track.cues || [], cue => ({ start: cue.startTime, end: cue.endTime, text: cue.getCueAsHTML().textContent })),
    };
  }, { videoBase64: videoBytes.toString('base64'), vttBase64: vttBytes.toString('base64') });
}
async function snapshotAt(page, time) {
  return page.evaluate(async time => {
    const { video, track } = window.__nativeConsumer;
    if (Math.abs(video.currentTime - time) > 1e-9) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Native seek to ${time} timed out`)), 5000);
        video.addEventListener('seeked', () => { clearTimeout(timer); resolve(); }, { once: true });
        video.currentTime = time;
      });
    }
    // Let the media element update its native text-track active cue list.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return {
      requestedTime: time, actualTime: video.currentTime,
      cues: Array.from(track.track.activeCues || [], cue => ({ start: cue.startTime, end: cue.endTime, text: cue.getCueAsHTML().textContent })),
    };
  }, time);
}
async function consume(page, fixture, bytes, label) {
  const loaded = await loadNativeTrack(page, fixture.bytes, bytes);
  if (loaded.readyState !== 2) throw new Error(`${label}: HTML track never reached LOADED`);
  if (loaded.duration < VIDEO_SECONDS - 0.005) throw new Error(`${label}: test video is too short (${loaded.duration}s)`);
  same(loaded.cues, EXPECTED_NATIVE_CUES, `${label}: native parsed cue times and rendered text`);
  const samples = [];
  const positions = [{ time: 0, boundary: null, side: 'initial-gap' }];
  for (const boundary of BOUNDARIES) {
    positions.push({ time: boundary - EPSILON_SECONDS, boundary, side: 'before' });
    positions.push({ time: boundary, boundary, side: 'exact' });
    positions.push({ time: boundary + EPSILON_SECONDS, boundary, side: 'after' });
  }
  for (const position of positions) {
    const snapshot = await snapshotAt(page, position.time);
    if (Math.abs(snapshot.actualTime - position.time) > 0.001) throw new Error(`${label}: inaccurate video seek ${snapshot.actualTime} != ${position.time}`);
    const expected = EXPECTED_NATIVE_CUES.filter(cue => cue.start <= position.time && position.time < cue.end);
    same(snapshot.cues, expected, `${label}: ${position.side} ${position.boundary ?? 0}s activeCues/getCueAsHTML`);
    // Exact boundaries are sampled twice to demonstrate stable native behavior.
    if (position.side === 'exact') {
      const repeat = await snapshotAt(page, position.time);
      same(repeat.cues, expected, `${label}: stable exact ${position.time}s native activeCues`);
    }
    samples.push({ ...position, ...snapshot, expected });
  }
  return { label, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, videoDuration: loaded.duration, nativeParsedCues: loaded.cues, boundarySamples: samples };
}
async function rejectBad(page, fixture, bytes, label) {
  try {
    await consume(page, fixture, bytes, label);
  } catch (error) {
    if (!(error instanceof NativeCaptionMismatch)) throw error;
    return { label, rejected: true, reason: error.message };
  }
  throw new Error(`${label}: native consumer accepted deliberately incorrect VTT`);
}
async function cleanupPage(page) {
  await page.evaluate(() => {
    const state = window.__nativeConsumer;
    if (!state) return;
    state.video.pause(); state.video.removeAttribute('src'); state.video.load();
    URL.revokeObjectURL(state.videoUrl); URL.revokeObjectURL(state.vttUrl);
    delete window.__nativeConsumer;
  }).catch(() => {});
}

export async function verifyNativeTrack(page, actualVttPathOrBytes, { outputDir = 'test-results/browser' } = {}) {
  const report = { status: 'fail', consumer: 'HTMLVideoElement + actual HTMLTrackElement WebVTT parser', syntheticVideoIsTestOnly: true, expectationSource: 'independent hand-written six-cue fixture', exactBoundaryPolicy: 'start inclusive, end exclusive; every exact boundary sampled twice', epsilonSeconds: EPSILON_SECONDS };
  await fs.mkdir(outputDir, { recursive: true });
  try {
    const bytes = await inputBytes(actualVttPathOrBytes);
    const fixture = await videoFixture();
    report.ffmpeg = fixture.ffmpeg; report.fixtureCommand = fixture.args;
    report.positiveControl = await consume(page, fixture, Buffer.from(POSITIVE_CONTROL), 'independent positive VTT control');
    report.negativeControls = [];
    report.negativeControls.push(await rejectBad(page, fixture, Buffer.from(POSITIVE_CONTROL.replace('00:00:01.000', '00:00:01.250')), 'bad 250ms cue start'));
    report.negativeControls.push(await rejectBad(page, fixture, Buffer.from(POSITIVE_CONTROL.replace('Last\ncaption', 'Last caption')), 'bad multiline text'));
    report.actualDownload = await consume(page, fixture, bytes, 'actual browser-downloaded recut.vtt');
    report.status = 'pass';
    return report;
  } catch (error) {
    report.error = `${error.name}: ${error.message}`;
    throw error;
  } finally {
    await fs.writeFile(path.join(outputDir, 'native-track-report.json'), JSON.stringify(report, null, 2) + '\n');
    await cleanupPage(page);
  }
}

/** Additional public rejection helper: malformed/incorrect real output must fail.
 * Media/FFmpeg/load failures do NOT count as a successful negative control.
 */
export async function assertNativeTrackRejects(page, badVttPathOrBytes, { outputDir = 'test-results/browser' } = {}) {
  const fixture = await videoFixture();
  try {
    const result = await rejectBad(page, fixture, await inputBytes(badVttPathOrBytes), 'supplied bad VTT');
    await fs.mkdir(outputDir, { recursive: true });
    await fs.writeFile(path.join(outputDir, 'native-track-negative-report.json'), JSON.stringify(result, null, 2) + '\n');
    return result;
  } finally { await cleanupPage(page); }
}

/** Additional actual-download Unicode/entity/multiline parsing check. */
export async function verifyNativeUnicodeTrack(page, actualVttPathOrBytes, { outputDir = 'test-results/browser' } = {}) {
  const fixture = await videoFixture();
  const report = { status: 'fail', inputOrigin: 'actual browser download', expectationSource: 'handwritten Unicode and literal ampersand fixture' };
  const expected = [{ start: 1, end: 3, text: 'ようこそ 🎬 &amp; & literal\n字幕を残す' }];
  try {
    const bytes = await inputBytes(actualVttPathOrBytes);
    const loaded = await loadNativeTrack(page, fixture.bytes, bytes);
    same(loaded.cues, expected, 'Unicode native parsed cue and visible text');
    const active = await snapshotAt(page, 2);
    same(active.cues, expected, 'Unicode native activeCues and visible text');
    report.sha256 = createHash('sha256').update(bytes).digest('hex');
    report.cues = loaded.cues;
    report.active = active;
    report.status = 'pass';
    return report;
  } catch (error) {
    report.error = `${error.name}: ${error.message}`;
    throw error;
  } finally {
    await fs.writeFile(path.join(outputDir, 'native-unicode-report.json'), JSON.stringify(report, null, 2) + '\n');
    await cleanupPage(page);
  }
}
