# Optional Azan audio

Drop an `azan.mp3` in this folder to make it the default sound for everyone
using this deployment. Then add `'./audio/azan.mp3'` to the `ASSETS` array in
`../sw.js` and bump the `CACHE` version so it is cached for offline use.

No audio is committed here: Azan recordings are licensed works, and which
muezzin/recitation to use is a personal choice.

Alternatively, each user can load their own file from Settings → Azan audio →
"Choose audio file…", which stores it on that device only.
