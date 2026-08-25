# Style Editing

`index.js` imports the section files directly in the same order the original stylesheet used. Avoid stylesheet import rules in `../App.css` because Vite/PostCSS can resolve those paths incorrectly on Windows.

Use the numbered files as editing zones:

- Early files contain older/global structure and base record layouts.
- Middle files contain quote, job ticket, tooling, material, and production workflow sections.
- Later files contain phone/mobile overrides and final screen-specific polish.

When editing a screen, change the matching section first. Add a new section at the end only when you need a deliberate final override.
