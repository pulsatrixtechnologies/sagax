# iOS reliability: captures (2026-11-01)

Synthetic data only (made-up bots Scout, Juniper, Pip; DEBUG galleries). Taken
on a dedicated iPhone 17 Pro simulator (iOS 27.0), created for the run and
deleted after, status bar pinned to 9:41. Debug build of `fix/ios-reliability`.

| File | What it shows |
| --- | --- |
| `before-owl-frames.png` | The owl at about 50 fps over one state change, before. |
| `after-owl-frames.png` | The same sequence after `OwlPoseTransition`. The remaining one-frame jump from crouch to stretch is the success hop's own takeoff (the desktop art, kept on purpose). |
| `before-trombi-frames.png` | Trombi jumping to the new pose in one frame. Not changed: a cross-fade was tried and rejected because it showed two half-transparent paperclips. |
| `before-motion-10fps.png`, `after-motion-10fps.png` | Twelve characters at 64 pt, 10 frames a second over 4 s while the state cycles every 1.6 s. Every body stays assembled in every frame. |
| `after-motion-gallery.png` | The motion gallery: every character, plus the shape and owl at chat-header sizes (28, 36, 44, 52 pt). |
| `after-live-activity-gallery.png` | The Live Activity views at system sizes: compact (ask, working, stale), minimal, expanded (ask, working, done) and the lock-screen card. |
| `after-island-compact.png` | The real Dynamic Island with two activities (`-liveActivityPreview`). The ask outranks the working bot. |

How to reproduce:

```sh
cd ios && xcodegen generate
xcodebuild -project Sagax.xcodeproj -scheme Sagax -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
# then on a simulator you created:
xcrun simctl launch <udid> ca.pulsatrix.sagax -mascotGallery motion
xcrun simctl launch <udid> ca.pulsatrix.sagax -mascotGallery live-activity
xcrun simctl launch <udid> ca.pulsatrix.sagax -liveActivityPreview   # then open another app
```

What a simulator cannot show: the expanded island (it needs a long press),
the lock screen itself, and pushes arriving while the app is suspended. Those
need a check on a physical iPhone.
