# Frontend Structure

The frontend is organized so layout, feature screens, reusable controls, and styling can be edited independently.

## App Shell

- `app/App.jsx` owns session state, resource selection, data mutations, and screen routing.
- `app/layout/AppShell.jsx` owns the main desktop/mobile frame around every page.
- `app/navigation/` owns sidebar, top bar, mobile menu, and navigation configuration.
- `app/auth/` owns sign-in, account, and user-admin UI.
- `app/resources/` owns app-level resource helpers, grouping rules, defaults, and lookup shaping.

## Features

Feature-owned screens live under `features/<domain>/components/`.

- `features/customers/`
- `features/imports/`
- `features/inventory/`
- `features/materials/`
- `features/messages/`
- `features/production/`
- `features/quotes/`
- `features/suppliers/`
- `features/tooling/`

Each feature has an `index.js` barrel so app-level imports stay short and movable.

## Shared UI

Reusable cross-feature pieces live under `shared/components/`.

- `shared/components/forms/RecordForm.jsx`
- `shared/components/tables/ResourceTable.jsx`
- `shared/components/scanning/ScanLinkScreen.jsx`
- `shared/components/FilePreview.jsx`
- `shared/components/AnimatedNumber.jsx`

Use `shared/components/index.js` for shared imports from app or feature code.

## Styles

- `App.css` is intentionally a tiny compatibility entry point.
- `styles/index.css` imports every stylesheet in cascade order.
- `styles/00-base.css` contains the original root/base styles.
- `styles/sections/` contains numbered CSS sections split from the original stylesheet.

Keep the numbered imports in order unless you are intentionally changing the cascade. For layout edits, start with the section whose file name matches the screen or workflow you are adjusting.
