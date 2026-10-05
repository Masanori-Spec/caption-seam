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
// HTML requires start <= t < end. Hosted Chromium's paused seek can retain the
// ending cue at exactly t=end, even for the independent hand-written control.
// Do not change export intervals or silently treat that as spec conformance.
// Off-boundary assertions remain strict. Exact observations must be one complete
// endpoint model and actual downloads must reproduce the control's same snapshot.
// https://html.spec.whatwg.org/multipage/media.html#time-marches-on
export function assertBoundarySample(snapshot, position, reference = null) {
  const specExpected = EXPECTED_NATIVE_CUES.filter(cue => cue.start <= position.time && position.time < cue.end);
  let endpointModel = 'half-open';
  if (position.side === 'exact') {
    const closed = EXPECTED_NATIVE_CUES.filter(cue => cue.start <= position.time && position.time <= cue.end);
    const actual = JSON.stringify(snapshot.cues);
    if (actual !== JSON.stringify(specExpected)) {
      same(snapshot.cues, closed, `exact ${position.time}s: only the known end-inclusive native discrepancy is accepted`);
      endpointModel = 'native-end-inclusive-discrepancy';
    }
    if (reference) same(snapshot.cues, reference.cues, `exact ${position.time}s: actual download must match independent control`);
  } else {
    same(snapshot.cues, specExpected, `${position.side} ${position.time}s: strict half-open activeCues`);
  }
  return { specExpected, matchesHalfOpenSpec: endpointModel === 'half-open', endpointModel };
}
async function consume(page, fixture, bytes, label, referenceSamples = null) {
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
    const reference = referenceSamples?.find(sample => sample.time === position.time && sample.side === position.side);
    if (referenceSamples && !reference) throw new Error('Missing independent boundary-control sample');
    const boundaryCheck = assertBoundarySample(snapshot, position, reference);
    let repeat = null;
    if (position.side === 'exact') {
      repeat = await snapshotAt(page, position.time);
      same(repeat.cues, snapshot.cues, `${label}: stable exact ${position.time}s native activeCues`);
    }
    samples.push({ ...position, ...snapshot, ...boundaryCheck, repeat, referenceCues: reference?.cues ?? null });
  }
  return { label, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length, videoDuration: loaded.duration, nativeParsedCues: loaded.cues, boundarySamples: samples };
}
const PLAYBACK_GUARD_SECONDS = 0.03;
const PLAYBACK_EVENT_TOLERANCE_SECONDS = 0.15;
// These are explicit test observation windows, not claims of HTML conformance.
export function assertPlaybackProgression(playback) {
  if (playback.playbackRate !== 1 || !playback.ended || playback.rateChanges.some(event => event.rate !== 1)) throw new NativeCaptionMismatch('Native playback did not finish at 1x');
  if (!Number.isFinite(playback.duration) || playback.duration < VIDEO_SECONDS - 0.005) throw new NativeCaptionMismatch('Invalid playback duration');
  for (const event of [...playback.cueEvents, ...playback.cueChanges, ...playback.rateChanges]) if (!Number.isFinite(event.time) || event.time < 0) throw new NativeCaptionMismatch('Invalid native event media time');
  const samples = playback.samples;
  if (!Array.isArray(samples) || samples.length < 50) throw new NativeCaptionMismatch('Insufficient real playback samples');
  let lastTime = -1;
  for (const sample of samples) {
    if (!Number.isFinite(sample.time) || sample.time < 0 || sample.rate !== 1) throw new NativeCaptionMismatch('Invalid sample media time or non-1x playback');
    if (sample.time < lastTime) throw new NativeCaptionMismatch('Playback media time moved backwards');
    lastTime = sample.time;
    if (BOUNDARIES.every(boundary => Math.abs(sample.time - boundary) >= PLAYBACK_GUARD_SECONDS)) {
      try { same(sample.cues, EXPECTED_NATIVE_CUES.filter(cue => cue.start <= sample.time && sample.time < cue.end), `real playback at ${sample.time}s`); } catch (error) { error.playbackTime = sample.time; error.playbackFailure = 'active-state'; error.observedCues = sample.cues; throw error; }
    }
  }
  const boundaryObservations = [];
  for (const boundary of BOUNDARIES) {
    const before = samples.filter(sample => sample.time < boundary - PLAYBACK_GUARD_SECONDS).at(-1);
    const after = samples.find(sample => sample.time > boundary + PLAYBACK_GUARD_SECONDS);
    if (!before || !after || boundary - before.time > 0.25 || after.time - boundary > 0.25) { const error = new NativeCaptionMismatch(`Missing close playback observations around ${boundary}s`); error.playbackBoundary = boundary; error.playbackFailure = 'coverage'; throw error; }
    for (const sample of [before, after]) { try { same(sample.cues, EXPECTED_NATIVE_CUES.filter(cue => cue.start <= sample.time && sample.time < cue.end), `playback boundary ${boundary}s`); } catch (error) { error.playbackTime = sample.time; error.playbackFailure = 'active-state'; error.observedCues = sample.cues; throw error; } }
    boundaryObservations.push({ boundary, before, after });
  }
  if (!playback.cueChanges.length) throw new NativeCaptionMismatch('No native cuechange events during real playback');
  const eventObservations = [];
  for (const cue of EXPECTED_NATIVE_CUES) {
    for (const type of ['enter', 'exit']) {
      const events = playback.cueEvents.filter(event => event.type === type && event.start === cue.start && event.end === cue.end && event.text === cue.text);
      if (events.length !== 1) throw new NativeCaptionMismatch(`Expected one native ${type} event for ${cue.text}, got ${events.length}`);
      const boundary = type === 'enter' ? cue.start : cue.end;
      const offset = events[0].time - boundary;
      if (Math.abs(offset) > PLAYBACK_EVENT_TOLERANCE_SECONDS) { const error = new NativeCaptionMismatch(`Native ${type} event too far from ${boundary}s: ${offset}s`); error.playbackBoundary = boundary; error.playbackFailure = 'late-event'; error.observedEventTime = events[0].time; throw error; }
      if (!playback.cueChanges.some(event => Math.abs(event.time - boundary) <= PLAYBACK_EVENT_TOLERANCE_SECONDS)) throw new NativeCaptionMismatch(`Missing cuechange near ${boundary}s`);
      eventObservations.push({ ...events[0], boundary, offset });
    }
  }
  if (playback.cueEvents.length !== EXPECTED_NATIVE_CUES.length * 2) throw new NativeCaptionMismatch('Unexpected extra native cue events');
  return { status: 'pass', guardSeconds: PLAYBACK_GUARD_SECONDS, eventToleranceSeconds: PLAYBACK_EVENT_TOLERANCE_SECONDS, boundaryObservations, eventObservations };
}
async function observeRealPlayback(page) {
  await snapshotAt(page, 0);
  const playback = await page.evaluate(async () => {
    const { video, track } = window.__nativeConsumer;
    const list = () => Array.from(track.track.activeCues || [], cue => ({ start: cue.startTime, end: cue.endTime, text: cue.getCueAsHTML().textContent }));
    const samples = [{ time: video.currentTime, wallTime: performance.now(), rate: video.playbackRate, cues: list() }], cueEvents = [], cueChanges = [], rateChanges = [], listeners = [];
    const listen = (target, type, callback) => { target.addEventListener(type, callback); listeners.push(() => target.removeEventListener(type, callback)); };
    for (const cue of Array.from(track.track.cues || [])) for (const type of ['enter', 'exit']) listen(cue, type, () => cueEvents.push({ type, time: video.currentTime, start: cue.startTime, end: cue.endTime, text: cue.getCueAsHTML().textContent }));
    listen(track.track, 'cuechange', () => cueChanges.push({ time: video.currentTime, cues: list() }));
    listen(video, 'ratechange', () => rateChanges.push({ time: video.currentTime, rate: video.playbackRate }));
    video.playbackRate = 1;
    let frame = 0, timeout = 0;
    try {
      await new Promise(async (resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Real 1x native playback timed out')), 30000);
        listen(video, 'ended', resolve);
        listen(video, 'error', () => reject(new Error('Real native playback failed')));
        const sample = () => { samples.push({ time: video.currentTime, wallTime: performance.now(), rate: video.playbackRate, cues: list() }); if (!video.ended) frame = requestAnimationFrame(sample); };
        frame = requestAnimationFrame(sample);
        try { await video.play(); } catch (error) { reject(error); }
      });
      samples.push({ time: video.currentTime, wallTime: performance.now(), rate: video.playbackRate, cues: list() });
      return { playbackRate: video.playbackRate, ended: video.ended, duration: video.duration, samples, cueEvents, cueChanges, rateChanges };
    } finally { clearTimeout(timeout); cancelAnimationFrame(frame); video.pause(); listeners.forEach(remove => remove()); }
  });
  return playback;
}
// One retry is allowed only when a failing observation sits in an independently
// measured long scheduling gap across a cue boundary. Assertions are never widened.
export function diagnosePlaybackScheduling(playback, error) {
  const gaps = [];
  for (let i = 1; i < playback.samples.length; i++) {
    const a = playback.samples[i - 1], b = playback.samples[i];
    const wallGapMs = b.wallTime - a.wallTime;
    const crossedBoundaries = BOUNDARIES.filter(boundary => a.time < boundary && boundary <= b.time);
    if (Number.isFinite(wallGapMs) && wallGapMs > 100 && b.time - a.time > 0.08 && crossedBoundaries.length) gaps.push({ start: a.time, end: b.time, wallGapMs, crossedBoundaries });
  }
  const target = Number.isFinite(error.playbackBoundary) ? error.playbackBoundary : error.playbackTime;
  const candidates = Number.isFinite(target) ? gaps.filter(gap => gap.start < target && target <= gap.end + 0.005) : [];
  const relevant = candidates.filter(gap => {
    if (error.playbackFailure === 'active-state') {
      const knownBeforeGap = EXPECTED_NATIVE_CUES.filter(cue => cue.start <= gap.start && gap.start < cue.end);
      return JSON.stringify(error.observedCues) === JSON.stringify(knownBeforeGap);
    }
    if (error.playbackFailure === 'late-event') return Number.isFinite(error.observedEventTime) && gap.start < error.observedEventTime && error.observedEventTime <= gap.end + 0.005;
    return error.playbackFailure === 'coverage';
  });
  return { retryEligible: error instanceof NativeCaptionMismatch && relevant.length > 0, failureKind: error.playbackFailure ?? null, observedEventTime: error.observedEventTime ?? null, relevant, allBoundaryGaps: gaps, reason: 'Measured wall-clock scheduling gap >100ms across the failing boundary with an exact known stale cue set, immediately delayed event, or missing sampling coverage; retry once with unchanged strict checks' };
}
async function verifyPlaybackWithDiagnostics(page, fixture, bytes, label, attempts) {
  for (let index = 0; index < 2; index++) {
    if (index) {
      const loaded = await loadNativeTrack(page, fixture.bytes, bytes);
      same(loaded.cues, EXPECTED_NATIVE_CUES, `${label}: reloaded native cue times/text`);
    }
    const attempt = { index: index + 1, status: 'fail' };
    attempts.push(attempt);
    attempt.observations = await observeRealPlayback(page);
    try {
      attempt.checks = assertPlaybackProgression(attempt.observations);
      attempt.status = 'pass';
      return attempt;
    } catch (error) {
      attempt.error = `${error.name}: ${error.message}`;
      attempt.scheduling = diagnosePlaybackScheduling(attempt.observations, error);
      if (index || !attempt.scheduling.retryEligible) throw error;
      attempt.retryReason = attempt.scheduling.reason;
    }
  }
  throw new Error('Unreachable playback verification state');
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
  const report = { status: 'fail', consumer: 'HTMLVideoElement + actual HTMLTrackElement WebVTT parser', syntheticVideoIsTestOnly: true, expectationSource: 'independent hand-written six-cue fixture', exactBoundaryPolicy: 'Strict half-open before/after; exact snapshots constrained to half-open or observed native end-inclusive model, repeated, and actual download matched to independent control', specification: 'https://html.spec.whatwg.org/multipage/media.html#time-marches-on', epsilonSeconds: EPSILON_SECONDS };
  await fs.mkdir(outputDir, { recursive: true });
  try {
    const bytes = await inputBytes(actualVttPathOrBytes);
    const fixture = await videoFixture();
    report.ffmpeg = fixture.ffmpeg; report.fixtureCommand = fixture.args;
    report.positiveControl = await consume(page, fixture, Buffer.from(POSITIVE_CONTROL), 'independent positive VTT control');
    report.nativeSpecDiscrepancies = report.positiveControl.boundarySamples.filter(sample => !sample.matchesHalfOpenSpec).map(({time,endpointModel,specExpected,cues}) => ({time,endpointModel,specExpected,observed:cues}));
    report.nativeExactEndConformance = report.nativeSpecDiscrepancies.length ? 'Native exact-end discrepancy observed in independent control; actual output parity is checked separately, not a browser conformance claim' : 'All sampled exact positions match half-open specification';
    report.positiveControlPlaybackAttempts = [];
    await verifyPlaybackWithDiagnostics(page, fixture, Buffer.from(POSITIVE_CONTROL), 'independent positive VTT control playback', report.positiveControlPlaybackAttempts);
    report.negativeControls = [];
    report.negativeControls.push(await rejectBad(page, fixture, Buffer.from(POSITIVE_CONTROL.replace('00:00:01.000', '00:00:01.250')), 'bad 250ms cue start'));
    report.negativeControls.push(await rejectBad(page, fixture, Buffer.from(POSITIVE_CONTROL.replace('Last\ncaption', 'Last caption')), 'bad multiline text'));
    report.actualDownload = await consume(page, fixture, bytes, 'actual browser-downloaded recut.vtt', report.positiveControl.boundarySamples);
    report.actualPlaybackAttempts = [];
    await verifyPlaybackWithDiagnostics(page, fixture, bytes, 'actual downloaded VTT playback', report.actualPlaybackAttempts);
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
