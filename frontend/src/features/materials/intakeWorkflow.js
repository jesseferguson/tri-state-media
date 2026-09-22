// Keep intake rules independent of rendering so every step and the final save agree.
export const INTAKE_STEPS = ["Category", "Material", "Source", "Quantity", "Storage", "Review"];
export const COMPONENTS = [["face", "Face"], ["liner", "Liner"], ["adhesive", "Adhesive"], ["silicone", "Silicone"], ["coating", "Coating"]];
export const UNITS = [["lf", "Linear feet (ft)"], ["gal", "Gallons (gal)"], ["lbs", "Pounds (lb)"], ["roll", "Rolls"], ["each", "Each"]];
export const ORIGINS = [["purchased", "Purchased / outsourced"], ["tri_state", "Made by Tri-State"], ["legacy", "Existing stock / no QR"]];
export const sameId = (a, b) => a != null && b != null && String(a) === String(b);
export const isLiquid = (type) => ["adhesive", "silicone", "coating"].includes(type);
export const needsWidth = (form) => !isLiquid(form.material_type) || ["lf", "roll"].includes(form.unit);
export const findById = (rows, id) => rows.find((row) => sameId(row.id, id));
export const locationLabel = (row) => row?.full_path || row?.location_full_path || row?.name || row?.code || "";
export const rackLabel = (row) => [row?.rack_code, row?.storage_location_display || row?.location_detail].filter(Boolean).join(" / ");
export const materialLabel = (row) => {
  const base = row?.master_type_code || row?.material_family || row?.name || "Material";
  const parts = row?.material_type === "coated_stock" ? [base, row?.liner_material_family || row?.liner_material_name, row?.adhesive_material_family || row?.adhesive_material_name] : [base];
  return [...new Set(parts.filter(Boolean)), row?.company, row?.code].filter(Boolean).join(" / ");
};
export const formatAmount = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });

export function initialIntake(now = new Date()) {
  // Receiving dates follow the operator's local calendar, including late evenings.
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    category: "", definitionMode: "existing", material_type: "", material: "", source_roll_tag: "",
    master_type: "", master_type_code: "", name: "", company: "", liner_material: "", adhesive_material: "",
    supplier: "", inventory_origin: "", received_date: date, lot_number: "", width_inches: "",
    amount: "", roll_count: "1", unit: "lf", storageMode: "floor", location: "", direct_rack: "", notes: "",
  };
}

export function intakeChoices(data, form) {
  const active = (rows) => (rows || []).filter((row) => row.is_active !== false);
  return {
    materials: active(data.materials).filter((row) => row.material_type === (form.category === "finished" ? "coated_stock" : form.material_type)),
    masterTypes: active(data.masterTypes), suppliers: active(data.suppliers),
    liners: active(data.materials).filter((row) => row.material_type === "liner"),
    adhesives: active(data.materials).filter((row) => row.material_type === "adhesive"),
    locations: active(data.locations).filter((row) => row.inventory_scope !== "finished_product"),
    racks: (data.racks || []).filter((row) => {
      const location = findById(data.locations || [], row.location);
      return row.status === "active" && row.location_inventory_scope !== "finished_product" && row.location_is_active !== false
        && location?.is_active !== false && location?.inventory_scope !== "finished_product";
    }),
  };
}

export function resetMaterial(form, changes) {
  return {
    ...form, material: "", source_roll_tag: "", master_type: "", master_type_code: "", name: "", company: "",
    liner_material: "", adhesive_material: "", supplier: "", width_inches: "", amount: "", roll_count: "1",
    ...changes,
  };
}

function decimalValid(value, places, max) {
  const text = String(value);
  return /^\d+(?:\.\d+)?$/.test(text) && (text.split(".")[1]?.length || 0) <= places
    && Number(value) > 0 && Number(value) <= max;
}

export function validateIntakeStep(step, form, data) {
  const errors = {};
  const choices = intakeChoices(data, form);
  if (step === 0 && !["finished", "raw"].includes(form.category)) errors.category = "Choose what you are adding.";
  if (step === 1) {
    if (form.category === "raw" && !COMPONENTS.some(([value]) => value === form.material_type)) errors.material_type = "Choose a component.";
    if (form.definitionMode === "existing") {
      if (!findById(choices.materials, form.material)) errors.material = "Select a material from the results.";
    } else {
      if (!form.name.trim()) errors.name = "Enter a material name.";
      if (form.name.trim().length > 100) errors.name = "Use 100 characters or fewer for the material name.";
      if (form.category === "finished") {
        if (form.master_type === "__new__") {
          if (!form.master_type_code.trim()) errors.master_type_code = "Enter a type code.";
        } else if (!findById(choices.masterTypes, form.master_type)) errors.master_type = "Select a material family.";
        if (!form.company.trim()) errors.company = "Enter the company that makes this material.";
      }
      if (form.liner_material && !findById(choices.liners, form.liner_material)) errors.liner_material = "Select an active liner.";
      if (form.adhesive_material && !findById(choices.adhesives, form.adhesive_material)) errors.adhesive_material = "Select an active adhesive.";
    }
  }
  if (step === 2) {
    if (!ORIGINS.some(([value]) => value === form.inventory_origin)) errors.inventory_origin = "Choose where the material came from.";
    const received = new Date(`${form.received_date}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.received_date) || !Number.isFinite(received.getTime()) || received.toISOString().slice(0, 10) !== form.received_date) errors.received_date = "Enter a valid received date.";
    if (form.supplier && !findById(choices.suppliers, form.supplier)) errors.supplier = "Select an active supplier or leave it blank.";
  }
  if (step === 3) {
    if (!UNITS.some(([value]) => value === form.unit)) errors.unit = "Choose a unit.";
    if (!decimalValid(form.amount, form.unit === "lf" ? 2 : 3, 999999999.999)) errors.amount = `Enter an amount greater than zero, with up to ${form.unit === "lf" ? 2 : 3} decimal places (maximum 999,999,999).`;
    if (!/^\d+$/.test(String(form.roll_count)) || Number(form.roll_count) < 1 || Number(form.roll_count) > 500) errors.roll_count = "Enter a whole number from 1 to 500.";
    if (needsWidth(form) && !decimalValid(form.width_inches, 3, 99999.999)) errors.width_inches = "Enter the roll width in inches, greater than zero, with up to 3 decimal places.";
  }
  if (step === 4) {
    if (form.storageMode === "rack") {
      if (!findById(choices.racks, form.direct_rack)) errors.direct_rack = "Select an active rack from the results.";
    } else if (!findById(choices.locations, form.location)) errors.location = "Choose where this inventory will be stored.";
  }
  return errors;
}

export function intakeRequestKey() {
  if (globalThis.crypto.randomUUID) return globalThis.crypto.randomUUID();
  // getRandomValues also works on local HTTP phone previews where randomUUID is unavailable.
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function intakePayload(form) {
  // A scanned production tag must be finalized in place, never cloned as manual stock.
  if (form.source_roll_tag) {
    return {
      source_roll_tag: form.source_roll_tag,
      width_inches: form.width_inches || null, length_feet: form.amount,
      ...(form.lot_number.trim() ? { lot_number: form.lot_number.trim() } : {}), received_date: form.received_date,
      location: form.storageMode === "floor" ? form.location : null,
      direct_rack: form.storageMode === "rack" ? form.direct_rack : null,
      notes: form.notes.trim(),
    };
  }
  return {
    material: form.definitionMode === "existing" ? form.material : null,
    create_material: form.definitionMode === "new" ? {
      material_type: form.category === "finished" ? "coated_stock" : form.material_type,
      master_type: form.category === "finished" && form.master_type !== "__new__" ? form.master_type : null,
      master_type_code: form.category === "finished" && form.master_type === "__new__" ? form.master_type_code.trim() : "",
      name: form.name.trim(), material_family: form.name.trim(), company: form.company.trim(), supplier: form.supplier || null,
      liner_material: form.category === "finished" ? form.liner_material || null : null,
      adhesive_material: form.category === "finished" ? form.adhesive_material || null : null,
    } : null,
    supplier: form.supplier || null, inventory_origin: form.inventory_origin, received_date: form.received_date,
    lot_number: form.lot_number.trim(), width_inches: needsWidth(form) ? form.width_inches || null : null,
    length_feet: form.unit === "lf" ? form.amount : null, quantity: form.amount, unit: form.unit,
    roll_count: Number(form.roll_count), location: form.storageMode === "floor" ? form.location : null,
    direct_rack: form.storageMode === "rack" ? form.direct_rack : null, notes: form.notes.trim(),
  };
}

export function intakeFromRollTag(match) {
  const tag = match.roll_tag;
  const material = match.material;
  if (match.kind !== "pending_tag" || !tag?.id || !material?.id) throw new Error("This roll tag is missing its material details. Ask production to review the tag.");
  return {
    ...initialIntake(), source_roll_tag: tag.id,
    category: "finished", material_type: "coated_stock", material: String(material.id),
    inventory_origin: "tri_state", received_date: tag.run_date || initialIntake().received_date,
    width_inches: tag.width_inches == null ? "" : String(tag.width_inches),
    amount: tag.length_feet == null ? "" : String(tag.length_feet),
    lot_number: tag.result_lot_number || "", notes: tag.notes || "",
    // A tag identifies one roll. The operator still explicitly confirms its destination.
    roll_count: "1", unit: "lf", location: "", direct_rack: "",
  };
}

export function intakeErrorMessage(error) {
  try {
    const collect = (value) => Array.isArray(value) ? value.flatMap(collect) : value && typeof value === "object" ? Object.entries(value).flatMap(([key, detail]) => collect(detail).map((text) => key === "detail" || key === "non_field_errors" ? text : `${key.replaceAll("_", " ")}: ${text}`)) : [String(value)];
    return collect(JSON.parse(error?.message || "")).join(" ");
  } catch {
    return error?.message || "The request could not be completed. Your entries are still here.";
  }
}
