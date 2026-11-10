// Turns the stored JPEG shots into an H.264 MP4 with WebCodecs + mp4-muxer.

import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.mjs';
import { FPS, KEY_EVERY, codecCandidates, bitrateFor, frameTimestamp, frameDuration } from './lapse.js';

async function pickConfig(width, height) {
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
