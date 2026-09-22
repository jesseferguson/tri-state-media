import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLineupPositions,
  buildPressScopes,
  compareLineupItems,
  createLineupItems,
  filterLineupItems,
  groupLineupItems,
  matchesPressScope,
} from "./scheduleLineup.js";

const product = (id, extra = {}) => ({ id, status: "scheduled", press: 1, press_name: "Press 1", job_name: `Job ${id}`, ...extra });
const material = (id, extra = {}) => ({ id, status: "scheduled", press: 1, press_name: "Press 1", log_inventory: false, source_schedule: null, name: `Stock ${id}`, ...extra });

test("active lineup includes unassigned and held work of both kinds, excludes completed work and physical rolls", () => {
  const items = createLineupItems([
    product(1, { status: "unscheduled", press: null }), product(2, { status: "on_hold" }),
    product(3, { status: "complete" }), product(4, { status: "cancelled" }),
  ], [
    material(1, { status: "on_hold" }), material(2, { status: "complete" }),
    material(3, { source_schedule: 1 }), material(4, { log_inventory: true }),
  ]);
  assert.deepEqual(new Set(items.map((item) => item.key)), new Set(["product-1", "product-2", "material-1"]));
  assert.equal(filterLineupItems(items).length, 3);
  assert.equal(filterLineupItems(items, { status: "on_hold" }).length, 2);
});

test("press scopes keep stable IDs for inactive and unknown presses with assigned work", () => {
  const items = createLineupItems([product(1, { press: 2, press_name: "Press 2" }), product(2, { press: 8, press_name: "Old Coater" })]);
  const scopes = buildPressScopes(items, [
    { id: 1, name: "Press 1", is_active: true }, { id: 2, name: "Press 2", is_active: false },
    { id: 3, name: "Unused retired press", is_active: false },
  ]);
  assert.deepEqual(scopes.map((scope) => scope.key), ["all", "unassigned", "press-8", "press-1", "press-2"]);
  assert.equal(scopes.find((scope) => scope.key === "press-2").isInactive, true);
  assert.equal(scopes.find((scope) => scope.key === "press-8").isOrphan, true);
  assert.equal(scopes.find((scope) => scope.key === "press-1").count, 0);
});

test("press matching is exact and never falls back to the job ticket or child roll press", () => {
  const items = createLineupItems([product(1, { press: null, job_press: 2 }), product(2, { press: 12 })], [material(1, { press: "2" })]);
  assert.equal(filterLineupItems(items, { scope: "press-2" }).length, 1);
  assert.equal(filterLineupItems(items, { scope: "unassigned" })[0].key, "product-1");
  assert.equal(matchesPressScope(items.find((item) => item.key === "product-2"), { key: "press-2", pressId: 2 }), false);
});

test("status, type and search narrow the selected press without hiding its holds by default", () => {
  const items = createLineupItems([
    product(1, { status: "on_hold", customer_name: "Acme" }), product(2, { status: "running", press: 2, press_name: "Press 2" }),
  ], [material(1, { status: "running" })]);
  assert.equal(filterLineupItems(items, { scope: "press-1" }).length, 2);
  assert.deepEqual(filterLineupItems(items, { scope: "press-1", status: "running", workType: "material" }).map((item) => item.key), ["material-1"]);
  assert.equal(filterLineupItems(items, { query: " PRESS 2 " })[0].key, "product-2");
  assert.equal(filterLineupItems(items, { query: "acme" })[0].key, "product-1");
  assert.equal(filterLineupItems(items, { scope: "press-2", status: "on_hold" }).length, 0);
});

test("mixed work sorts by sequence within each press and deterministic IDs resolve ties", () => {
  const items = createLineupItems([
    product(10, { press_sequence: 2, job_name: "Same" }), product(2, { press_sequence: 2, job_name: "Same" }),
    product(3, { press_sequence: null }), product(4, { press: 2, press_name: "Press 2", press_sequence: 1 }),
  ], [material(1, { press_sequence: 1 })]);
  assert.deepEqual(items.map((item) => item.key), ["material-1", "product-2", "product-10", "product-3", "product-4"]);
  assert.deepEqual([...items].reverse().sort(compareLineupItems).map((item) => item.key), items.map((item) => item.key));
});

test("grouping keeps full actual lineup positions even when a view filters out preceding work", () => {
  const items = createLineupItems([product(1, { status: "on_hold", press_sequence: 1 }), product(2, { press_sequence: 3 })], [material(1, { press_sequence: 2 })]);
  const positions = buildLineupPositions(items);
  assert.equal(positions.get("product-2"), 3);
  const visible = filterLineupItems(items, { workType: "product" });
  assert.equal(groupLineupItems(visible)[0].items.length, 2);
  assert.equal(positions.get(visible[1].key), 3);
});

test("scope counts include held products and held materials without double counting the all scope", () => {
  const items = createLineupItems([product(1, { status: "on_hold" })], [material(1, { status: "on_hold" })]);
  const scopes = buildPressScopes(items, [{ id: 1, name: "Press 1" }]);
  assert.equal(scopes.find((scope) => scope.key === "all").count, 2);
  assert.equal(scopes.find((scope) => scope.key === "press-1").heldCount, 2);
  assert.equal(groupLineupItems(items, scopes).length, 1);
});

test("helpers leave source arrays and records unchanged and deduplicate repeated API rows", () => {
  const row = Object.freeze(product(1));
  const rows = Object.freeze([row, row]);
  const items = createLineupItems(rows);
  assert.equal(items.length, 1);
  assert.equal(items[0].row, row);
  filterLineupItems(Object.freeze(items));
  assert.equal(rows.length, 2);
});
