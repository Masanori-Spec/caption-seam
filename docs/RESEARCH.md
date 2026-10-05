# Research and bounded differentiation

Checked 2026-10-05. These are public primary product/support sources. No private captions, customer data, or vendor example assets were used.

## Observed workflow

A Shotcut user reported that ripple deletion of video/audio did not move the subtitle track. A maintainer explained that cuts can leave extremely short cues and that a person should make the subtitle-editing decisions. This supports a review-oriented handoff rather than treating all interval intersections as editorially correct. [Shotcut support discussion](https://forum.shotcut.org/t/cannot-ripple-the-subtitle-track/49755)

A Subtitle Edit user described repeated backward adjustments against a video cut list. The same discussion identifies DaVinci Resolve as an existing editing alternative. This is evidence of friction in a particular workflow, not proof that full editors cannot solve it. [Subtitle Edit discussion #9170](https://github.com/SubtitleEdit/subtitleedit/discussions/9170)

## Existing alternatives

- Clip Caption Kit already provides master-SRT plus clip ranges, previews, trim/exclude handling at boundaries, and per-clip files/manifests. A generic batch splitter or manifest generator would overlap substantially. CaptionSeam instead assembles one chronological recut and records explicit text decisions for every interrupted cue. This is a bounded product distinction, not a novelty claim. [Clip Caption Kit](https://clipcaptionkit.com/)
- Subtitle Edit's Assisted Split suggests text split points and divides cue timing in proportion to text. CaptionSeam does not infer retained spoken words from text length or a duration percentage; its split text fields are blank until the user writes them. [Subtitle Edit Assisted Split](https://subtitleedit.github.io/subtitleedit/features/assisted-split.html)
- A full nonlinear editor may already fit the user's workflow better. CaptionSeam is a small, local, auditable subtitle handoff when the source cut intervals and an SRT already exist; it does not replace an editor or audio alignment tool.

## Interchange and verification basis

- FFprobe documents packet/data inspection; the consumer gate checks decimal packet timing and decoded UTF-8 payload bytes independently of application calculations. [Official FFprobe documentation](https://ffmpeg.org/ffprobe.html)
- WebVTT is parsed by an actual native HTML track, including its text rendering and active cue list. [W3C WebVTT](https://www.w3.org/TR/webvtt1/), [MDN TextTrack.activeCues](https://developer.mozilla.org/en-US/docs/Web/API/TextTrack/activeCues)
- Lossless cutting can have inaccurate cut starts; planned boundaries cannot by themselves establish synchronization against the final video. CaptionSeam therefore requires actual retained source intervals and does not advertise LosslessCut CSV compatibility. [LosslessCut documentation](https://github.com/mifi/lossless-cut/blob/master/docs/index.md)

## Product hypothesis, not validated demand

The hypothesis is that making seam decisions explicit and replayable reduces repeated caption bookkeeping for short recuts. No customer outreach, willingness-to-pay validation, usability study, generalized video-sync guarantee, or patent conclusion has been established. Only authored synthetic fixtures are included.
