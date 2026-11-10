# Lapse

Timelapse yourself while you work. The screen stays pure black while it records, so it saves battery.

**Open it:** https://jeremychen24.github.io/lapse/. On iPhone, tap Share → **Add to Home Screen**. As a Home Screen app the black screen covers the whole display.

## How it works

1. Prop up your phone, pick how often to take a shot (every 2s to 1 min), and tap the red button.
2. After a 3-second countdown the screen goes black. Tap anywhere to check the time and frame count, and it goes dark again by itself.
3. Tap stop and the MP4 (30 fps) is ready right away. **Save video** puts it in Photos.

At "every 5s", one hour of work becomes a 24-second video.

## Stats, and Nook

Two tabs at the bottom, **Record** and **Stats**, like Nook. Stats is laid out like Nook's: today, this week, streak and total; a month heatmap; the last 7 days; the time of day you record most; 14 badges; and a history of past timelapses with thumbnails. The first time you open Stats in a new week, a "Your week" recap shows last week against the week before (it's also under **Last week**). Sessions shorter than a minute don't count.

**Send to Nook** copies your stats (times only, no photos or video) as a short text code. In [Nook](https://github.com/jeremychen24/nook), open Stats and tap **Paste from Lapse**. Home Screen apps on iPhone can't read each other's data, so this copy-paste is the bridge. Sending again is safe: sessions are matched by ID and never counted twice. The format lives in `js/timelog.js`, a file shared word-for-word with Nook.

## Battery

iOS doesn't let any app use the camera with the screen truly off. On iPhones with an OLED screen (iPhone X and later, except the XR, 11 and SE), black pixels are unlit, so a pure-black screen costs almost nothing. The camera runs at a low frame rate, and a screen wake lock stops Auto-Lock from cutting the recording short.

## Safe by design

- Each shot goes straight into the video as it's taken, and only those small video pieces are kept (about 25–30 MB per hour at "every 5s", not a pile of photos). If you switch apps, lock the phone or the app closes, the timelapse pauses, and next time you can resume or finish it.
- As soon as you save the video, Lapse deletes its own copy. Only your stats (times and a tiny thumbnail) stay.
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
