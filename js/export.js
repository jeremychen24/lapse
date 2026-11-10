// Video: shots are encoded to H.264 as they're taken (LiveEncoder), and Stop just
// stitches the stored pieces into an MP4 (muxChunks). buildVideo is only for sessions
// recorded as JPEG shots before that.

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { FPS, KEY_EVERY, codecCandidates, bitrateFor, frameTimestamp, frameDuration } from './lapse.js';

export async function pickConfig(width, height) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) throw new Error('unsupported');
  const base = { width, height, bitrate: bitrateFor(width, height), framerate: FPS, avc: { format: 'avc' } };
  for (const codec of codecCandidates(width, height)) {
    try {
      const { supported } = await VideoEncoder.isConfigSupported({ ...base, codec });
      if (supported) return { ...base, codec };
    } catch {
      /* try the next profile */
    }
  }
  throw new Error('unsupported');
}

const tick = () => new Promise((r) => setTimeout(r, 4));

// One hardware encoder for a recording. If iOS takes it away (or it errors), the next
// shot opens a fresh one, starting on a keyframe so the video stays playable.
export class LiveEncoder {
  constructor(config, onChunk) {
    this.config = config;
    this.onChunk = onChunk;
    this.enc = null;
    this.needKey = true;
  }

  get ready() {
    return this.enc?.state === 'configured';
  }

  open() {
    this.close();
    this.enc = new VideoEncoder({
      output: (chunk, meta) => this.onChunk(chunk, meta),
      error: () => this.close(),
    });
    this.enc.configure(this.config);
    this.needKey = true;
  }

  // source: a canvas holding the shot; i: the shot's index in the whole video.
  encode(source, i) {
    if (!this.ready) this.open();
    const frame = new VideoFrame(source, { timestamp: frameTimestamp(i), duration: frameDuration(i) });
    this.enc.encode(frame, { keyFrame: this.needKey || i % KEY_EVERY === 0 });
    this.needKey = false;
    frame.close();
  }

  async flush() {
    if (this.ready) await this.enc.flush().catch(() => {});
  }

  close() {
    if (this.enc && this.enc.state !== 'closed') this.enc.close();
    this.enc = null;
  }
}

// Stitches stored pieces ({ ts, dur, key, data }) into an MP4. No re-encoding, so it's quick.
export async function muxChunks({ keys, getChunk, width, height, codec, description, onProgress }) {
  if (!description) throw new Error('no-config');
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: FPS },
    fastStart: false,
    firstTimestampBehavior: 'offset',
  });
  let started = false;
  let lastTs = -1;
  for (let i = 0; i < keys.length; i++) {
    const c = await getChunk(keys[i]);
    if (!c || (!started && !c.key) || c.ts <= lastTs) continue; // open on a keyframe, never step back
    const meta = started ? undefined : { decoderConfig: { codec, codedWidth: width, codedHeight: height, description } };
    muxer.addVideoChunkRaw(new Uint8Array(c.data), c.key ? 'key' : 'delta', c.ts, c.dur, meta);
    started = true;
    lastTs = c.ts;
    if (i % 20 === 0) onProgress?.((i + 1) / keys.length);
  }
  if (!started) throw new Error('empty');
  muxer.finalize();
  onProgress?.(1);
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

export async function buildVideo({ keys, getFrame, width, height, onProgress }) {
  if (!('VideoEncoder' in window) || !('VideoFrame' in window)) throw new Error('unsupported');
  const config = await pickConfig(width, height);

  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: { codec: 'avc', width, height, frameRate: FPS },
    fastStart: false, // write as we go: lower peak memory on the phone
    firstTimestampBehavior: 'offset',
  });

  let failure = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (failure = e),
  });
  encoder.configure(config);

  for (let i = 0; i < keys.length; i++) {
    if (failure) throw failure;
    const buf = await getFrame(keys[i]);
    if (!buf) continue;
    const bitmap = await createImageBitmap(new Blob([buf], { type: 'image/jpeg' }));
    const frame = new VideoFrame(bitmap, { timestamp: frameTimestamp(i), duration: frameDuration(i) });
    encoder.encode(frame, { keyFrame: i % KEY_EVERY === 0 });
    frame.close();
    bitmap.close();
    while (encoder.encodeQueueSize > 4) await tick();
    onProgress?.((i + 1) / keys.length);
  }

  await encoder.flush();
  if (failure) throw failure;
  encoder.close();
  muxer.finalize();
  return new Blob([muxer.target.buffer], { type: 'video/mp4' });
}

// iOS: the share sheet has "Save Video" (to Photos). Elsewhere: a download.
// Must be called straight from a tap, with the File already built.
export async function saveVideo(file, url) {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (e) {
      if (e.name === 'AbortError') return 'cancelled';
    }
  }
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.append(a);
  a.click();
  a.remove();
  return 'downloaded';
}
