# Material inventory intake

The operator entry point is **Material → Add Material** in `MaterialHandlingView`.
Catalog setup's **Add Material** still creates a material specification; it does not receive physical stock.

## Flow and business rules

1. Choose finished raw material or a raw component; neither is preselected.
2. Select an active material, or define a new one. Raw components first choose face, liner, adhesive, silicone, or coating. New finished materials require a family, name, and manufacturer; liner and adhesive are optional.
3. Choose the inventory source and receiving date. Dates default to the operator's local calendar. Supplier is optional; explicitly clearing it preserves an unknown supplier.
4. Enter an amount **per physical item**, count (1–500), and roll width. Width is required for face/liner/coated stock and any material measured in linear feet or rolls. Lot remains optional. Footage accepts two decimal places, other amounts three, matching the database.
5. Explicitly choose an active material location or rack. Notes are optional. Skid grouping happens in the existing Skids workspace after receipt.
6. Review the material, source, per-item amount, count, total, and destination before saving. Missing lot numbers are shown on review.

Every item in one entry has the same amount, width, lot, and destination. Split mixed deliveries into separate entries. Changing category/component/definition mode clears incompatible identity and quantity fields. Changing units clears the amount to avoid treating an old measurement as a new unit.

## Ownership

- `components/MaterialIntakeDialog.jsx`: step navigation, draft state, save lifecycle, confirmation, and accessible native modal.
- `components/IntakeSearchPicker.jsx`: keyboard/touch selection; free text never substitutes for a selected record ID.
- `intakeWorkflow.js`: validation, defaults, dependent-field resets, choices, and payload shaping.
- `components/MaterialIntakeDialog.css`: scoped responsive layout, subtle transitions, and reduced-motion support.
- `backend/materials/intake.py`: server validation, atomic receipt, and retry protection.

Submitting locks navigation and closes; failed requests retain the entry. An unchanged retry in the open dialog reuses its `Idempotency-Key`. The server scopes receipts to the authenticated user and returns the original result for an identical request. Changed payloads receive a new key; reopening or refreshing the page starts a new entry. Check inventory before recreating an entry after an interrupted save.

Material/type creation, every inventory item, movement history, and the idempotency receipt commit in one database transaction. A failure rolls back all of them. Deploy the backend migration `materials.0027_material_intake_receipt` before serving the new frontend. The backend build script already runs migrations.

## Verification

Run `npm run test:intake` and `npm run build` from `frontend`. Run the materials and production Django suites against an isolated test database; do not point test tooling at production. API tests cover validation, rollback, receipt replay/conflicts, and unit preservation. Browser checks should cover finished and all five raw categories, new and existing definitions, keyboard selection, phone touch, review/edit, required width, optional lot, error/retry, and pending-save locks.

## Separate workflow concern

The existing coater `CoaterRollTag._log_component_usage()` records produced roll footage as each assigned component's usage quantity. For gallon/pound chemical inventory this is not a valid conversion. Receiving preserves those units correctly, but production consumption needs its own rule (actual measured usage or a defined coating-rate calculation). Do not infer a feet-to-gallons/pounds conversion from the intake form.
