function currentInventoryQuantity(roll) {
  return Number(roll?.length_feet ?? roll?.quantity ?? 0) || 0;
}

function compactScanValue(value) {
  return String(value ?? "").trim().toLowerCase();
}

function findScannedLocation(locations, value) {
  const scan = compactScanValue(value);
  if (!scan) return null;
  return (locations ?? []).find((row) => [
    row.id,
    row.code,
    row.name,
    row.full_path,
    row.location_full_path,
  ].some((field) => compactScanValue(field) === scan));
}

function locationCodeFromScan(value) {
  const clean = String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 46);
  return clean || `LOC-${Date.now()}`;
}

function rollUsagePayload(roll, overrides = {}) {
  return {
    inventory: roll.id,
    material: roll.material,
    unit: roll.unit || "lf",
    used_date: new Date().toISOString().slice(0, 10),
    ...overrides,
  };
}

function activeInventoryFeet(rows) {
  return (rows ?? []).reduce((sum, row) => {
    if (row.is_active === false || ["depleted", "scrapped", "in_use"].includes(row.status)) return sum;
    const qty = Number(row.length_feet ?? row.quantity ?? 0);
    return sum + (Number.isFinite(qty) ? qty : 0);
  }, 0);
}

function inventoryTotalFeetForMaterial(row, inventoryRows) {
  if (row.inventory_total_feet !== null && row.inventory_total_feet !== undefined && row.inventory_total_feet !== "") {
    return row.inventory_total_feet;
  }
  return activeInventoryFeet(inventoryRows.filter((inventory) => String(inventory.material) === String(row.id)));
}

function firstMaterialComponentId(material, preferredKey, allowedKey) {
  if (material?.[preferredKey]) return material[preferredKey];
  const allowed = Array.isArray(material?.[allowedKey]) ? material[allowedKey] : [];
  return allowed[0] || null;
}

export { currentInventoryQuantity, findScannedLocation, firstMaterialComponentId, inventoryTotalFeetForMaterial, locationCodeFromScan, rollUsagePayload };
