# MineGuard X presentation source

`presentation.html` (12 slides) is printed to the repository-root
`presentation.pdf` with headless Chrome:

```bash
chrome --headless --no-pdf-header-footer --print-to-pdf=presentation.pdf mineguard/docs/presentation.html
```

Slides: title · concept · mine model and twins · architecture (UI reads the
platform) · physics · risk and simulated safety · 3D visualization · S1 methane
release · S2 main-fan failure · energy module · evidence · run and limits.

The screenshots come from `final-browser/` and `final-scenario-evidence/`, and
every number comes from `validation.md`. All model outputs are labelled
synthetic, and all actions simulated.
