# Assistant assets (public name UNO; internal folder / file names keep "vero")

The assistant is shown to users as **UNO** (UGREEN Product and Sales Assistant). File names and the
`assets/vero/` folder keep the internal VERO naming on purpose.

| File | Size | Source | Used for |
|---|---|---|---|
| vero-icon.webp | 192×192 | VERO-assets.zip (approved production art, 2026-10-05) — unchanged | Floating "Ask UNO" button (56px desktop / 52px mobile), drawer header (40px) |
| vero-default.webp | 128×128 | `vero-default-bust.png` (2026-10-11, UNO branding) | Normal answers (34px) |
| vero-happy.webp | 224×224 | `vero-wave-bust.png` (2026-10-11, UNO branding) | Greeting / welcome (58px) |
| vero-thinking.webp | 128×128 | `vero-thinking-bust.png` (2026-10-11, UNO branding) | Clarifying questions + no-result answers (34px); AI loading state |

The three bust avatars come from the approved 1254×1254 transparent PNGs in
`Deliverables/VERO-Video/assets-src/vero-hires/bust` (UGREEN chest icon + "UGREEN" wordmark), converted to lossless
WebP (alpha preserved, square, no crop, no background added) and downscaled for web.

To update: replace with same names. If a file fails to load, the UI shows a neutral
sparkle mark (no letter badge).
