# MineGuard X presentation source

`presentation.html` (14 slides) is printed to the repository-root
`presentation.pdf` with headless Chrome or Chromium, from this directory so the
relative image paths resolve:

```bash
cd mineguard/docs
chromium --headless=new --no-pdf-header-footer --print-to-pdf=presentation.pdf "file://$PWD/presentation.html"
cp presentation.pdf ../../presentation.pdf
```

Slides: hook (Kostenko 2023) and title · three users and their questions · the
mine as 16 Ditto twins · Command Center · S1 methane release storyboard · S2
main fan failure · S3 roof fall on E03 · S4 sensor loss · energy (constraint-first
VOD) · how it works · safety rules · evidence · ten clicks on the Stand · limits
and closing.

Screenshots come from `final-browser/` and `final-scenario-evidence/`. Every
number comes from those runs (`report.json`, `browser-validation.json`), from
`GET /api/v1/vod/decision` after a reset, from `validation.md` or
`SUBMISSION.md`, or from a cited source. All model outputs are labelled
synthetic, and all actions simulated.
