import test from "node:test";
import assert from "node:assert/strict";
import { initialIntake, intakeChoices, intakeFromRollTag, intakePayload, intakeRequestKey, needsWidth, resetMaterial, validateIntakeStep } from "./intakeWorkflow.js";

const data = {
  materials: [{ id: 1, material_type: "coated_stock", is_active: true }, { id: 2, material_type: "adhesive", is_active: true }, { id: 3, material_type: "liner", is_active: false }],
  masterTypes: [{ id: 1, code: "PM" }], suppliers: [{ id: 1, name: "Supplier" }],
  locations: [{ id: 1, name: "Floor", is_active: true }, { id: 2, inventory_scope: "finished_product" }, { id: 3, is_active: false }],
  racks: [{ id: 1, status: "active" }, { id: 2, status: "inactive" }, { id: 3, status: "active", location_inventory_scope: "finished_product" }],
};
const validForm = () => ({ ...initialIntake(), category: "finished", material_type: "coated_stock", material: "1", inventory_origin: "purchased", amount: "5000.25", roll_count: "3", width_inches: "13.5", location: "1" });

test("intake starts with deliberate category, source, and destination choices", () => {
  const form = initialIntake(new Date(2026, 8, 21, 23, 30));
  assert.equal(form.received_date, "2026-09-21");
  assert.ok(validateIntakeStep(0, form, data).category);
  assert.ok(validateIntakeStep(2, form, data).inventory_origin);
  assert.ok(validateIntakeStep(4, form, data).location);
});

test("valid finished inventory passes all steps; lot stays optional", () => {
  for (let step = 0; step < 5; step += 1) assert.deepEqual(validateIntakeStep(step, validForm(), data), {});
});

test("roll width is required for roll material and roll units", () => {
  for (const material_type of ["coated_stock", "face", "liner"]) {
    assert.ok(validateIntakeStep(3, { ...validForm(), material_type, width_inches: "" }, data).width_inches);
  }
  assert.equal(needsWidth({ material_type: "adhesive", unit: "lf" }), true);
  assert.equal(needsWidth({ material_type: "adhesive", unit: "gal" }), false);
});

test("rejects fractional counts, invalid amounts, and unsupported footage precision", () => {
  for (const roll_count of ["0", "501", "1.5", "1e2", "NaN", ""]) assert.ok(validateIntakeStep(3, { ...validForm(), roll_count }, data).roll_count);
  for (const amount of ["0", "-1", "Infinity", "NaN", "1e3", "1.001", "1000000000"]) assert.ok(validateIntakeStep(3, { ...validForm(), amount }, data).amount);
  assert.ok(validateIntakeStep(3, { ...validForm(), width_inches: "-1" }, data).width_inches);
});

test("liquid amounts retain their unit and three decimal precision without footage", () => {
  const form = { ...validForm(), category: "raw", material_type: "adhesive", material: "2", unit: "gal", amount: "55.125", width_inches: "" };
  assert.deepEqual(validateIntakeStep(3, form, data), {});
  const payload = intakePayload(form);
  assert.equal(payload.quantity, "55.125");
  assert.equal(payload.length_feet, null);
  assert.equal(payload.width_inches, null);
  assert.equal(payload.unit, "gal");
});

test("search selections must be real IDs of active materials in the chosen branch", () => {
  assert.ok(validateIntakeStep(1, { ...validForm(), material: "typed search" }, data).material);
  assert.ok(validateIntakeStep(1, { ...validForm(), material: "2" }, data).material);
  assert.ok(validateIntakeStep(1, { ...validForm(), category: "raw", material_type: "liner", material: "3" }, data).material);
  assert.ok(validateIntakeStep(1, validForm(), { ...data, materials: [] }).material);
});

test("storage excludes inactive and finished-product destinations", () => {
  const choices = intakeChoices(data, validForm());
  assert.deepEqual(choices.locations.map((row) => row.id), [1]);
  assert.deepEqual(choices.racks.map((row) => row.id), [1]);
  assert.ok(validateIntakeStep(4, { ...validForm(), storageMode: "rack", direct_rack: "2" }, data).direct_rack);
  assert.ok(validateIntakeStep(4, { ...validForm(), location: "2" }, data).location);
});

test("changing material branch clears dependent identity and physical values", () => {
  const changed = resetMaterial({ ...validForm(), liner_material: "3", supplier: "1", name: "Previous", master_type: "1" }, { category: "raw", material_type: "adhesive", unit: "gal" });
  for (const field of ["material", "name", "supplier", "master_type", "liner_material", "amount", "width_inches"]) assert.equal(changed[field], "");
  assert.equal(changed.roll_count, "1");
  assert.equal(changed.unit, "gal");
  assert.equal(changed.location, "1");
});

test("new finished material requires a family, company and complete name", () => {
  const form = { ...validForm(), definitionMode: "new", name: " ", company: " ", master_type: "__new__" };
  const errors = validateIntakeStep(1, form, data);
  assert.ok(errors.name);
  assert.ok(errors.company);
  assert.ok(errors.master_type_code);
  assert.deepEqual(validateIntakeStep(1, { ...form, name: "PMDT", company: "Maker", master_type_code: "PMDT" }, data), {});
});

test("payload uses only the selected storage and material mode with exact quantities", () => {
  const form = { ...validForm(), storageMode: "rack", direct_rack: "1", name: "Stale name", lot_number: " LOT-1 ", notes: " Handle carefully " };
  const payload = intakePayload(form);
  assert.equal(payload.location, null);
  assert.equal(payload.direct_rack, "1");
  assert.equal(payload.create_material, null);
  assert.equal(payload.supplier, null);
  assert.equal(payload.length_feet, "5000.25");
  assert.equal(payload.quantity, "5000.25");
  assert.equal(payload.roll_count, 3);
  assert.equal(payload.lot_number, "LOT-1");
});

test("raw creation never sends stale finished components or family", () => {
  const payload = intakePayload({ ...validForm(), category: "raw", material_type: "face", definitionMode: "new", name: " Face ", master_type: "1", liner_material: "3", adhesive_material: "2" });
  assert.equal(payload.material, null);
  assert.equal(payload.create_material.name, "Face");
  assert.equal(payload.create_material.master_type, null);
  assert.equal(payload.create_material.liner_material, null);
  assert.equal(payload.create_material.adhesive_material, null);
});

test("invalid receiving dates and stale supplier selections are rejected", () => {
  assert.ok(validateIntakeStep(2, { ...validForm(), received_date: "2026-02-31" }, data).received_date);
  assert.ok(validateIntakeStep(2, { ...validForm(), supplier: "42" }, data).supplier);
});

test("request keys are distinct valid UUIDs", () => {
  const first = intakeRequestKey();
  assert.match(first, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.notEqual(first, intakeRequestKey());
});

test("scanned production tag pre-fills identity and measurements, but needs storage confirmation", () => {
  const form = intakeFromRollTag({ kind: "pending_tag", material: { id: 1 }, roll_tag: { id: 52, tag_number: "CRT-000052", width_inches: "13.500", length_feet: "6000.25", result_lot_number: "LOT-52", run_date: "2026-09-20" } });
  assert.equal(form.source_roll_tag, 52);
  assert.equal(form.category, "finished");
  assert.equal(form.material, "1");
  assert.equal(form.inventory_origin, "tri_state");
  assert.equal(form.received_date, "2026-09-20");
  assert.equal(form.roll_count, "1");
  assert.equal(form.unit, "lf");
  assert.deepEqual(validateIntakeStep(3, form, data), {});
  assert.ok(validateIntakeStep(4, form, data).location);
});

test("missing scanned width and footage still require validation", () => {
  const form = intakeFromRollTag({ kind: "pending_tag", material: { id: 1 }, roll_tag: { id: 52 } });
  assert.ok(validateIntakeStep(3, form, data).width_inches);
  assert.ok(validateIntakeStep(3, form, data).amount);
  assert.throws(() => intakeFromRollTag({ kind: "inventory", inventory: { id: 1 } }));
  assert.throws(() => intakeFromRollTag({ kind: "pending_tag", roll_tag: { id: 1 } }));
});

test("tagged receipt payload cannot duplicate its material or create a batch", () => {
  const form = { ...validForm(), source_roll_tag: 52, storageMode: "rack", direct_rack: "1", lot_number: "LOT-52", notes: " Keep upright " };
  const payload = intakePayload(form);
  assert.deepEqual(Object.keys(payload).sort(), ["source_roll_tag", "width_inches", "length_feet", "lot_number", "received_date", "location", "direct_rack", "notes"].sort());
  assert.equal(payload.source_roll_tag, 52);
  assert.equal(payload.length_feet, "5000.25");
  assert.equal(payload.location, null);
  assert.equal(payload.direct_rack, "1");
  assert.equal(payload.notes, "Keep upright");
  assert.equal(intakePayload({ ...form, lot_number: " " }).lot_number, undefined);
  assert.equal(resetMaterial(form, {}).source_roll_tag, "");
});
