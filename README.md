# Lapse

Timelapse yourself while you work. The screen stays pure black while it records, so it saves battery.

**Open it:** https://jeremychen24.github.io/lapse/. On iPhone, tap Share → **Add to Home Screen**. As a Home Screen app the black screen covers the whole display.

## How it works

1. Prop up your phone, pick how often to take a shot (every 2s to 1 min), and tap the red button.
2. After a 3-second countdown the screen goes black. Tap anywhere to check the time and frame count, and it goes dark again by itself.
3. Tap stop. Lapse builds an MP4 (30 fps) right on your phone, and **Save video** puts it in Photos.

At "every 5s", one hour of work becomes a 24-second video.

## Battery

iOS doesn't let any app use the camera with the screen truly off. On iPhones with an OLED screen (iPhone X and later, except the XR, 11 and SE), black pixels are unlit, so a pure-black screen costs almost nothing. The camera runs at a low frame rate, and a screen wake lock stops Auto-Lock from cutting the recording short.

## Safe by design

- Every shot is saved on the device the moment it's taken. If you switch apps, lock the phone or the app closes, the timelapse pauses, and next time you can resume or finish it.
- Nothing is uploaded. Lapse has no server, and your video never leaves your phone unless you share it.

Needs iOS 16.4+ (or a recent Chrome/Edge/Safari) for building the video.

## Development

Plain HTML/JS with no build step.

```sh
python -m http.server 8000   # then open http://localhost:8000/?interval=0.2 for fast test shots
npm test                     # unit tests for the timing and sizing logic
python tools/make_icons.py   # redraw the icons
```

MP4 muxing uses [mp4-muxer](https://github.com/Vanilagy/mp4-muxer) 5.2.1 (MIT, see `vendor/`).
