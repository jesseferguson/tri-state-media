# Customers Feature

The Customers tab is split by workflow:

- `components/CustomerWorkspace.jsx` coordinates selected customer state and chooses the active customer page.
- `components/customerCards.jsx` contains reusable display rows, metrics, facts, and search cards.
- `components/CustomerFollowUpForm.jsx` creates and edits follow-ups, including job/quote multi-linking.
- `components/CustomerFollowUps.jsx` manages the selected customer's follow-up list, detail, and history view.
- `components/OpenLogsSheet.jsx` manages the all-customer open follow-up grid.
- `components/TeamNotifyPanel.jsx` handles customer-linked team notifications.
- `utils/customerChoices.js` contains CRM choices, tabs, and type icons.
- `utils/customerUtils.js` contains formatting, matching, sorting, relation, and audit helpers.

Customer styling currently lives in the numbered global style sections, mostly `styles/sections/28-phone-first-roll-scanner.css`, preserving the existing cascade.
