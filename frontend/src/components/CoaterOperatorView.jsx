import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Factory, PackageCheck, Play, Printer, RefreshCcw, Ruler, Save, Settings2, X } from "lucide-react";
import { fetchCollection, postRecordAction, updateRecord } from "../api";
import { formatInches, getRecordTitle, labelize } from "../lib/format";

const activeMaterialStatuses = new Set(["scheduled", "running", "on_hold"]);
const activeProductStatuses = new Set(["scheduled", "ready", "running", "on_hold"]);
const componentSlots = [
  { key: "liner", preferredKey: "liner_material", label: "Liner", type: "liner", supplierKey: "liner_supplier_option", allowedKey: "allowed_liner_materials" },
  { key: "face", preferredKey: "face_material", label: "Face", type: "face", supplierKey: "face_supplier_option", allowedKey: "allowed_face_materials" },
  { key: "adhesive", preferredKey: "adhesive_material", label: "Adhesive", type: "adhesive", supplierKey: "adhesive_supplier_option", allowedKey: "allowed_adhesive_materials" },
  { key: "silicone", preferredKey: "silicone_material", label: "Silicone", type: "silicone", supplierKey: "silicone_supplier_option", allowedKey: "allowed_silicone_materials" },
  { key: "coating", preferredKey: "coating_material", label: "Coating", type: "coating", supplierKey: "coating_supplier_option", allowedKey: "allowed_coating_materials", optional: true },
];

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || a === "" || b === "") return false;
  return String(a) === String(b);
}

function numberOrNull(value) {
  if (value === "" || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function isCoaterPress(press) {
  const name = String(press?.name || "").toLowerCase();
  return name.includes("eti") || name.includes("coater");
}

function qty(value, suffix = "") {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number)) return "--";
  return `${number.toLocaleString(undefined, { maximumFractionDigits: 2 })}${suffix}`;
}

function shortDate(value) {
  if (!value) return "--";
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function supplierOptionTitle(option) {
  return [
    option.supplier_name || option.supplier_lookup_name || "Supplier",
    option.option_name,
    option.supplier_item_number ? `Item # ${option.supplier_item_number}` : "",
  ].filter(Boolean).join(" / ");
}

function supplierOptionMeta(option) {
  return [
    option.thickness_mil ? `${qty(option.thickness_mil, " mil")}` : "",
    option.width_inches ? `${formatInches(option.width_inches)} wide` : "",
    option.length_feet ? `${qty(option.length_feet, " ft")}` : "",
  ].filter(Boolean).join(" / ");
}

function supplierChoiceLabel(option) {
  return [
    option.material_family || option.material_name,
    supplierOptionTitle(option),
  ].filter(Boolean).join(" / ");
}

function allowedComponentIds(material, slot) {
  const ids = [];
  if (material?.[slot.preferredKey]) ids.push(material[slot.preferredKey]);
  const allowed = Array.isArray(material?.[slot.allowedKey]) ? material[slot.allowedKey] : [];
  allowed.forEach((id) => {
    if (id && !ids.some((existing) => sameId(existing, id))) ids.push(id);
  });
  return ids;
}

function defaultComponentId(material, tag, slot) {
  if (tag?.[slot.key]) return tag[slot.key];
  const ids = allowedComponentIds(material, slot);
  return ids[0] || "";
}

function plantFloorLocation(locations) {
  return (locations ?? []).find((row) => /plant\s*floor/i.test(`${row.full_path || ""} ${row.name || ""}`)) ?? null;
}

function componentFamilyKey(row) {
  return String(row?.material_family || row?.material_name || row?.name || row?.material_code || row?.code || "")
    .trim()
    .toLowerCase();
}

function supplierChoices(supplierOptions, materialId, materials = []) {
  const active = (supplierOptions ?? []).filter((option) => option.is_active !== false);
  const exact = active.filter((option) => sameId(option.material, materialId));
  if (exact.length) {
    return exact.sort((a, b) => supplierOptionTitle(a).localeCompare(supplierOptionTitle(b), undefined, { numeric: true }));
  }
  const material = (materials ?? []).find((row) => sameId(row.id, materialId));
  const family = componentFamilyKey(material);
  if (!family) return [];
  return active
    .filter((option) => option.material_type === material?.material_type && componentFamilyKey(option) === family)
    .sort((a, b) => supplierOptionTitle(a).localeCompare(supplierOptionTitle(b), undefined, { numeric: true }));
}

function defaultSupplierSelection(tag, finishedMaterial, slot, supplierOptions, materials) {
  if (tag?.[slot.supplierKey]) {
    return { supplierId: tag[slot.supplierKey], materialId: tag[slot.key] || "" };
  }
  const materialIds = allowedComponentIds(finishedMaterial, slot);
  const options = new Map();
  materialIds.forEach((materialId) => {
    supplierChoices(supplierOptions, materialId, materials).forEach((option) => options.set(String(option.id), option));
  });
  if (options.size !== 1) return { supplierId: "", materialId: materialIds[0] || "" };
  const option = Array.from(options.values())[0];
  const matchingMaterial = (materials ?? []).find((row) => (
    materialIds.some((id) => sameId(id, row.id))
    && (sameId(row.id, option.material) || componentFamilyKey(row) === componentFamilyKey(option))
  ));
  return { supplierId: option.id, materialId: matchingMaterial?.id || materialIds[0] || "" };
}

function printerSettingsFor(press) {
  return {
    printer_ip: press?.printer_ip || "",
    printer_port: String(press?.printer_port || 9100),
    printer_speed: String(press?.printer_speed || 5),
    printer_darkness: String(press?.printer_darkness || 11),
  };
}

function noteBlock(tag, form, supplierOptions) {
  const lines = [
    tag.cut_description ? `Cutting Notes: ${tag.cut_description}` : "",
    form.operator_notes ? `Operator Notes: ${form.operator_notes}` : "",
    ...componentSlots.map((slot) => {
      const option = (supplierOptions ?? []).find((row) => sameId(row.id, form[slot.supplierKey]));
      return option ? `${slot.label} Supplier: ${supplierOptionTitle(option)}${supplierOptionMeta(option) ? ` / ${supplierOptionMeta(option)}` : ""}` : "";
    }),
  ];
  return lines.filter(Boolean).join("\n");
}

function defaultRollForm(tag, data, currentUser) {
  const material = (data.materials ?? []).find((row) => sameId(row.id, tag?.scheduled_material));
  const location = tag?.location || plantFloorLocation(data.locations)?.id || "";
  const printerPress = (data.presses ?? []).find((press) => sameId(press.id, tag?.press))
    || (data.presses ?? []).find((press) => press.printer_ip)
    || (data.presses ?? [])[0];
  const form = {
    liner: defaultComponentId(material, tag, componentSlots[0]),
    face: defaultComponentId(material, tag, componentSlots[1]),
    adhesive: defaultComponentId(material, tag, componentSlots[2]),
    silicone: defaultComponentId(material, tag, componentSlots[3]),
    coating: defaultComponentId(material, tag, componentSlots[4]),
    width_inches: tag?.width_inches || "",
    length_feet: tag?.is_schedule ? "" : (tag?.length_feet || ""),
    weight_lbs: tag?.weight_lbs || "",
    result_lot_number: tag?.is_schedule ? "" : (tag?.result_lot_number || ""),
    location,
    operator_notes: tag?.operator_notes || "",
    operator: currentUser?.name || tag?.operator || "",
    print_roll_tag: true,
    printer_press: printerPress?.id ? String(printerPress.id) : "",
    print_copies: "1",
    ...printerSettingsFor(printerPress),
  };
  componentSlots.forEach((slot) => {
    const selection = defaultSupplierSelection(tag, material, slot, data.supplierOptions, data.materials);
    form[slot.key] = selection.materialId || form[slot.key];
    form[slot.supplierKey] = selection.supplierId;
  });
  return form;
}

function validateRollForm(form, data = {}) {
  const missing = [];
  componentSlots.forEach((slot) => {
    if (slot.optional) return;
    if (!form[slot.key]) missing.push(`${slot.label} type`);
    if (!form[slot.supplierKey]) missing.push(`${slot.label} supplier`);
  });
  if (!numberOrNull(form.length_feet) || numberOrNull(form.length_feet) <= 0) missing.push("Run feet");
  if (form.print_roll_tag && !form.printer_press) {
    missing.push("Roll tag printer");
  } else if (form.print_roll_tag && !String(form.printer_ip || "").trim()) {
    missing.push("Printer IP setup");
  }
  return missing;
}

function PressFilter({ presses, selectedPress, onSelect }) {
  return (
    <div className="coater-press-tabs" role="tablist" aria-label="Coater press filter">
      <button className={selectedPress === "all" ? "active" : ""} type="button" onClick={() => onSelect("all")}>All</button>
      {presses.map((press) => (
        <button className={String(selectedPress) === String(press.id) ? "active" : ""} type="button" key={press.id} onClick={() => onSelect(String(press.id))}>
          {press.name}
        </button>
      ))}
    </div>
  );
}

function MaterialJobCard({ tag, selected, onSelect }) {
  return (
    <button className={`coater-job-card ${selected ? "active" : ""}`} type="button" onClick={onSelect}>
      <div>
        <span>{tag.tag_number || "Scheduled Run"}</span>
        <strong>{tag.scheduled_material_name || tag.name}</strong>
      </div>
      <em>{[
        tag.press_name || "No press",
        tag.cut_description || "No cutting notes",
        tag.length_feet ? `Target ${qty(tag.length_feet, " ft")}` : "",
      ].filter(Boolean).join(" / ")}</em>
      <footer>
        <span>{labelize(tag.status)}</span>
        <strong>{tag.schedule_roll_count || 0} roll{Number(tag.schedule_roll_count || 0) === 1 ? "" : "s"}</strong>
      </footer>
    </button>
  );
}

function ComponentPicker({ slot, form, setForm, materials, supplierOptions, allowedIds = [] }) {
  const materialOptions = materials.filter((row) => (
    row.material_type === slot.type
    && row.is_active !== false
    && (allowedIds.some((id) => sameId(id, row.id)) || sameId(row.id, form[slot.key]))
  ));
  const supplierMap = new Map();
  materialOptions.forEach((material) => {
    supplierChoices(supplierOptions, material.id, materials).forEach((option) => supplierMap.set(String(option.id), option));
  });
  const selectedSupplierOptions = Array.from(supplierMap.values())
    .sort((a, b) => supplierChoiceLabel(a).localeCompare(supplierChoiceLabel(b), undefined, { numeric: true }));
  const selectedSupplier = selectedSupplierOptions.find((option) => sameId(option.id, form[slot.supplierKey]));
  const familyLabels = materialOptions
    .map((row) => row.material_family || row.name || row.code)
    .filter((value, index, values) => value && values.indexOf(value) === index);

  function updateSupplier(value) {
    const option = selectedSupplierOptions.find((row) => sameId(row.id, value));
    const matchingMaterial = option
      ? materialOptions.find((row) => sameId(row.id, option.material))
        || materialOptions.find((row) => componentFamilyKey(row) === componentFamilyKey(option))
      : null;
    setForm((prev) => ({
      ...prev,
      [slot.key]: matchingMaterial?.id || prev[slot.key] || "",
      [slot.supplierKey]: value,
    }));
  }

  return (
    <section className="coater-component-card">
      <header>
        <strong>{slot.label}</strong>
        {slot.optional && <span>Optional</span>}
      </header>
      <div className="coater-required-family">
        <span>Compatible Type</span>
        <strong>{familyLabels.join(" / ") || "Not configured"}</strong>
      </div>
      <label>
        <span>{slot.label} Supplier</span>
        <select value={form[slot.supplierKey] || ""} onChange={(event) => updateSupplier(event.target.value)} required={!slot.optional}>
          <option value="">{selectedSupplierOptions.length ? "Select supplier material" : "No suppliers linked"}</option>
          {selectedSupplierOptions.map((option) => (
            <option value={option.id} key={option.id}>{supplierChoiceLabel(option)}</option>
          ))}
        </select>
      </label>
      {materialOptions.length > 0 && (
        <div className="coater-supplier-options">
          <span>Compatible Supplier Material</span>
          {selectedSupplier ? (
            <div className="coater-supplier-option selected">
              <strong>{supplierOptionTitle(selectedSupplier)}</strong>
              {supplierOptionMeta(selectedSupplier) && <em>{supplierOptionMeta(selectedSupplier)}</em>}
            </div>
          ) : selectedSupplierOptions.length ? (
            <em>{selectedSupplierOptions.length} compatible option{selectedSupplierOptions.length === 1 ? "" : "s"} available</em>
          ) : (
            <em>No suppliers are linked to this {slot.label.toLowerCase()} type.</em>
          )}
        </div>
      )}
    </section>
  );
}

function RollRunForm({ tag, data, currentUser, saving, error, createdRollId, onSave }) {
  const [form, setForm] = useState(() => defaultRollForm(tag, data, currentUser));
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const missing = validateRollForm(form, data);
  const scheduledMaterial = (data.materials ?? []).find((row) => sameId(row.id, tag?.scheduled_material));
  const selectedPrinter = (data.presses ?? []).find((press) => sameId(press.id, form.printer_press));

  useEffect(() => {
    setForm(defaultRollForm(tag, data, currentUser));
  }, [tag?.id]);

  useEffect(() => {
    if (!createdRollId) return;
    setForm((current) => ({ ...current, result_lot_number: "" }));
  }, [createdRollId]);

  function update(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function selectPrinter(pressId) {
    const press = (data.presses ?? []).find((row) => sameId(row.id, pressId));
    setForm((prev) => ({
      ...prev,
      printer_press: pressId,
      ...printerSettingsFor(press),
    }));
  }

  function submit(event) {
    event.preventDefault();
    const requiredMissing = validateRollForm(form, data);
    if (requiredMissing.length) return;
    onSave(form);
  }

  return (
    <form className="coater-roll-form" onSubmit={submit}>
      <header>
        <div>
          <span>Material Roll</span>
          <strong>{tag.scheduled_material_name || tag.name}</strong>
          <em>{tag.cut_description || "No cutting notes"}</em>
        </div>
        <span className="coater-roll-id">{tag.tag_number}</span>
      </header>

      <div className="coater-component-grid">
        {componentSlots.map((slot) => (
          <ComponentPicker
            key={slot.key}
            slot={slot}
            form={form}
            setForm={setForm}
            materials={data.materials}
            supplierOptions={data.supplierOptions}
            allowedIds={allowedComponentIds(scheduledMaterial, slot)}
          />
        ))}
      </div>

      <div className="coater-roll-details-grid">
        <label>
          <span>Cutting Notes</span>
          <input value={tag.cut_description || ""} readOnly />
        </label>
        <label>
          <span>Width</span>
          <input type="number" step="0.001" value={form.width_inches} onChange={(event) => update("width_inches", event.target.value)} />
        </label>
        <label>
          <span>Run Feet</span>
          <input type="number" step="0.01" value={form.length_feet} onChange={(event) => update("length_feet", event.target.value)} required />
        </label>
        <label>
          <span>Weight</span>
          <input type="number" step="0.01" value={form.weight_lbs} onChange={(event) => update("weight_lbs", event.target.value)} />
        </label>
        <label>
          <span>Roll Lot Number</span>
          <input value={form.result_lot_number} onChange={(event) => update("result_lot_number", event.target.value)} placeholder="Automatic if left blank" />
        </label>
        <label>
          <span>Plant Location</span>
          <select value={form.location || ""} onChange={(event) => update("location", event.target.value)}>
            <option value="">No location</option>
            {data.locations.map((row) => (
              <option value={row.id} key={row.id}>{row.full_path || row.name}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Operator</span>
          <input value={form.operator} onChange={(event) => update("operator", event.target.value)} />
        </label>
        <label className="field-wide">
          <span>Operator Notes</span>
          <textarea value={form.operator_notes} onChange={(event) => update("operator_notes", event.target.value)} />
        </label>
      </div>

      <section className={`coater-print-setup ${form.print_roll_tag ? "active" : ""}`}>
        <header>
          <span className="coater-print-icon"><Printer size={18} /></span>
          <div>
            <strong>Print New Roll Tag</strong>
            <span>The roll ID and manufacturing selections above will be printed automatically.</span>
          </div>
          <label className="coater-print-toggle">
            <input
              type="checkbox"
              checked={Boolean(form.print_roll_tag)}
              onChange={(event) => update("print_roll_tag", event.target.checked)}
            />
            <span>{form.print_roll_tag ? "Print" : "Save Only"}</span>
          </label>
        </header>
        {form.print_roll_tag && (
          <div className="coater-print-controls">
            <label>
              <span>Roll Tag Printer</span>
              <select value={form.printer_press} onChange={(event) => selectPrinter(event.target.value)} required>
                <option value="">Select printer</option>
                {(data.presses ?? []).map((press) => (
                  <option value={press.id} key={press.id}>
                    {press.name}{press.printer_ip ? ` / ${press.printer_ip}` : " / setup needed"}
                  </option>
                ))}
              </select>
            </label>
            <div className={`coater-printer-ready ${form.printer_ip ? "ready" : "needs-setup"}`}>
              <Printer size={16} />
              <span>
                <strong>{selectedPrinter?.name || "No printer selected"}</strong>
                <small>
                  {form.printer_ip
                    ? `${form.printer_ip}:${form.printer_port || 9100} / Speed ${form.printer_speed || 5} / Darkness ${form.printer_darkness || 11}`
                    : "Add the printer IP below"}
                </small>
              </span>
            </div>
            <div className="coater-printer-settings-row">
              <button className="ghost-btn xs" type="button" onClick={() => setPrinterSettingsOpen((open) => !open)}>
                <Settings2 size={15} /> {printerSettingsOpen ? "Hide Printer Settings" : "Edit Printer Settings"}
              </button>
              {printerSettingsOpen && (
                <div className="coater-inline-printer-grid">
                  <label>
                    <span>Printer IP</span>
                    <input value={form.printer_ip} onChange={(event) => update("printer_ip", event.target.value)} placeholder="192.168.1.100" />
                  </label>
                  <label>
                    <span>Port</span>
                    <input type="number" min="1" max="65535" value={form.printer_port} onChange={(event) => update("printer_port", event.target.value)} />
                  </label>
                  <label>
                    <span>Speed</span>
                    <input type="number" min="1" max="14" value={form.printer_speed} onChange={(event) => update("printer_speed", event.target.value)} />
                  </label>
                  <label>
                    <span>Darkness</span>
                    <input type="number" min="0" max="30" step="1" value={form.printer_darkness} onChange={(event) => update("printer_darkness", event.target.value)} />
                  </label>
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      {error && <p className="coater-error">{error}</p>}
      {missing.length ? <p className="coater-form-note">Missing: {missing.join(", ")}</p> : null}

      <div className="coater-roll-actions">
        <button className="primary-btn" type="submit" disabled={saving || missing.length > 0}>
          {form.print_roll_tag ? <Printer size={16} /> : <CheckCircle2 size={16} />}
          {saving ? "Creating Roll..." : form.print_roll_tag ? "Create & Print New Roll" : "Create New Roll"}
        </button>
      </div>
    </form>
  );
}

function ProductJobCard({ row, form, setForm, updating, onStart, onComplete }) {
  const formValue = form[row.id] ?? { actual_footage: row.actual_footage || "", footage_report: row.footage_report || "" };

  function update(name, value) {
    setForm((prev) => ({ ...prev, [row.id]: { ...formValue, [name]: value } }));
  }

  return (
    <article className="coater-product-card">
      <div>
        <span>{row.job_ticket_number || "Job"}</span>
        <strong>{row.job_name || row.job_product_code || getRecordTitle(row)}</strong>
        <em>{[row.customer_name, row.customer_po ? `PO ${row.customer_po}` : "", row.press_name].filter(Boolean).join(" / ")}</em>
      </div>
      <div className="coater-product-specs">
        <span>{formatInches(row.job_label_width_inches)} x {formatInches(row.job_label_length_inches)}</span>
        <span>{labelize(row.status)}</span>
        <span>{row.quantity_to_ship ? `${qty(row.quantity_to_ship)} ship` : `${qty(row.quantity_to_stock)} stock`}</span>
      </div>
      <div className="coater-product-controls">
        <button className="ghost-btn xs" type="button" onClick={() => onStart(row)} disabled={updating || row.status === "running"}>
          <Play size={13} /> Start
        </button>
        <input type="number" step="0.01" placeholder="Footage" value={formValue.actual_footage} onChange={(event) => update("actual_footage", event.target.value)} />
        <input placeholder="Report note" value={formValue.footage_report} onChange={(event) => update("footage_report", event.target.value)} />
        <button className="primary-btn xs" type="button" onClick={() => onComplete(row, formValue)} disabled={updating}>
          Complete
        </button>
      </div>
    </article>
  );
}

function RollTagDetailDialog({ tag, schedule, relatedRolls = [], inventoryRows = [], data, currentUser, onClose, onOpenRoll, onSaved }) {
  const tagPress = (data.presses ?? []).find((press) => sameId(press.id, tag.press));
  const [form, setForm] = useState(() => ({
    result_lot_number: tag.result_lot_number || "",
    width_inches: tag.width_inches || "",
    length_feet: tag.length_feet || "",
    weight_lbs: tag.weight_lbs || "",
    operator: tag.operator || currentUser?.name || "",
    operator_notes: tag.operator_notes || "",
    location: tag.location || "",
    press: tag.press || "",
    copies: "1",
    ...printerSettingsFor(tagPress),
    liner_supplier_option: tag.liner_supplier_option || "",
    face_supplier_option: tag.face_supplier_option || "",
    adhesive_supplier_option: tag.adhesive_supplier_option || "",
    silicone_supplier_option: tag.silicone_supplier_option || "",
    coating_supplier_option: tag.coating_supplier_option || "",
  }));
  const [busyAction, setBusyAction] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);

  useEffect(() => {
    setForm({
      result_lot_number: tag.result_lot_number || "",
      width_inches: tag.width_inches || "",
      length_feet: tag.length_feet || "",
      weight_lbs: tag.weight_lbs || "",
      operator: tag.operator || currentUser?.name || "",
      operator_notes: tag.operator_notes || "",
      location: tag.location || "",
      press: tag.press || "",
      copies: "1",
      ...printerSettingsFor((data.presses ?? []).find((press) => sameId(press.id, tag.press))),
      liner_supplier_option: tag.liner_supplier_option || "",
      face_supplier_option: tag.face_supplier_option || "",
      adhesive_supplier_option: tag.adhesive_supplier_option || "",
      silicone_supplier_option: tag.silicone_supplier_option || "",
      coating_supplier_option: tag.coating_supplier_option || "",
    });
    setError("");
    setNotice("");
    setPrinterSettingsOpen(false);
  }, [tag.id]);

  function update(name, value) {
    setError("");
    setNotice("");
    setForm((current) => ({ ...current, [name]: value }));
  }

  function selectPrinter(pressId) {
    const press = (data.presses ?? []).find((row) => sameId(row.id, pressId));
    setError("");
    setNotice("");
    setForm((current) => ({
      ...current,
      press: pressId,
      ...printerSettingsFor(press),
    }));
  }

  function editPayload() {
    return {
      result_lot_number: form.result_lot_number.trim(),
      width_inches: numberOrNull(form.width_inches),
      length_feet: numberOrNull(form.length_feet),
      weight_lbs: numberOrNull(form.weight_lbs),
      operator: form.operator.trim(),
      operator_notes: form.operator_notes.trim(),
      location: numberOrNull(form.location),
      press: numberOrNull(form.press),
      liner_supplier_option: numberOrNull(form.liner_supplier_option),
      face_supplier_option: numberOrNull(form.face_supplier_option),
      adhesive_supplier_option: numberOrNull(form.adhesive_supplier_option),
      silicone_supplier_option: numberOrNull(form.silicone_supplier_option),
      coating_supplier_option: numberOrNull(form.coating_supplier_option),
    };
  }

  async function run(action) {
    if (!form.result_lot_number.trim()) {
      setError("Enter the unique lot number.");
      return;
    }
    if (action === "reprint" && !String(form.printer_ip || "").trim()) {
      setError("Enter the printer IP before reprinting.");
      return;
    }
    setBusyAction(action);
    setError("");
    setNotice("");
    try {
      if (form.press) {
        await updateRecord("presses", form.press, {
          printer_ip: String(form.printer_ip || "").trim(),
          printer_port: numberOrNull(form.printer_port) || 9100,
          printer_speed: String(form.printer_speed || 5),
          printer_darkness: String(form.printer_darkness || 11),
        });
      }
      const saved = await updateRecord("coater-roll-tags", tag.id, editPayload());
      if (action === "reprint") {
        await postRecordAction("coater-roll-tags", saved.id, "queue-print-label", {
          press: numberOrNull(form.press),
          printer_ip: String(form.printer_ip || "").trim(),
          printer_port: numberOrNull(form.printer_port) || 9100,
          speed: String(form.printer_speed || 5),
          darkness: String(form.printer_darkness || 11),
          save_printer_settings: true,
          copies: numberOrNull(form.copies) || 1,
          operator: form.operator || currentUser?.name || "",
          performed_by: currentUser?.name || form.operator || "",
          frontend_url: window.location.origin,
        });
        setNotice(`${saved.tag_number} was saved and queued for reprint.`);
      } else {
        setNotice(`${saved.tag_number} was saved.`);
      }
      onSaved?.(saved);
    } catch (actionError) {
      setError(actionError.message || "The roll tag could not be saved.");
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section className="roll-tag-link-overlay" role="dialog" aria-modal="true" aria-label={`Roll tag ${tag.tag_number}`}>
      <div className="roll-tag-link-window">
        <header>
          <div>
            <p className="eyebrow">Material Roll Tag</p>
            <h2>{tag.tag_number}</h2>
            <span>{tag.result_code || tag.produced_material_name || tag.scheduled_material_name || tag.name} / Schedule {tag.schedule_tag_number || schedule?.tag_number || "--"}</span>
          </div>
          <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
        </header>

        <div className="roll-tag-link-body">
          <section className="roll-tag-link-summary">
            <div><span>Status</span><strong>{labelize(tag.status)}</strong></div>
            <div><span>Print Status</span><strong>{labelize(tag.print_status)}</strong></div>
            <div><span>Schedule ID</span><strong>{tag.schedule_tag_number || schedule?.tag_number || "--"}</strong></div>
            <div><span>Schedule Rolls</span><strong>{relatedRolls.length.toLocaleString()}</strong></div>
          </section>

          <section className="roll-tag-link-components">
            {componentSlots.map((slot) => {
              const material = (data.materials ?? []).find((row) => sameId(row.id, tag[slot.key]));
              const options = supplierChoices(data.supplierOptions, tag[slot.key], data.materials);
              return (
                <label key={slot.key}>
                  <span>{slot.label}</span>
                  <strong>{material?.material_family || tag[`${slot.key}_name`] || material?.name || "--"}</strong>
                  <select value={form[slot.supplierKey] || ""} onChange={(event) => update(slot.supplierKey, event.target.value)} required={!slot.optional}>
                    <option value="">{options.length ? "Select supplier material" : "No suppliers linked"}</option>
                    {options.map((option) => <option value={option.id} key={option.id}>{supplierChoiceLabel(option)}</option>)}
                  </select>
                </label>
              );
            })}
          </section>

          <section className="roll-tag-link-edit">
            <label>
              <span>Unique Lot Number</span>
              <input value={form.result_lot_number} onChange={(event) => update("result_lot_number", event.target.value)} required />
            </label>
            <label>
              <span>Cut Width</span>
              <input type="number" min="0" step="0.001" value={form.width_inches} onChange={(event) => update("width_inches", event.target.value)} />
            </label>
            <label>
              <span>Length</span>
              <input type="number" min="0" step="0.01" value={form.length_feet} onChange={(event) => update("length_feet", event.target.value)} />
            </label>
            <label>
              <span>Weight</span>
              <input type="number" min="0" step="0.01" value={form.weight_lbs} onChange={(event) => update("weight_lbs", event.target.value)} />
            </label>
            <label>
              <span>Operator</span>
              <input value={form.operator} onChange={(event) => update("operator", event.target.value)} />
            </label>
            <label>
              <span>Plant Location</span>
              <select value={form.location || ""} onChange={(event) => update("location", event.target.value)}>
                <option value="">No location</option>
                {(data.locations ?? []).map((location) => <option value={location.id} key={location.id}>{location.full_path || location.name}</option>)}
              </select>
            </label>
            <label className="wide">
              <span>Operator Notes</span>
              <textarea value={form.operator_notes} onChange={(event) => update("operator_notes", event.target.value)} rows={2} />
            </label>
          </section>

          <section className="roll-tag-family">
            <header>
              <div>
                <span>Related Rolls</span>
                <strong>{schedule?.name || tag.name}</strong>
              </div>
              <b>{relatedRolls.length} produced</b>
            </header>
            <div className="roll-tag-family-list">
              {relatedRolls.map((roll) => (
                <button className={sameId(roll.id, tag.id) ? "active" : ""} type="button" key={roll.id} onClick={() => onOpenRoll?.(roll.id)}>
                  <span>{roll.tag_number}</span>
                  <strong>{roll.result_lot_number || "--"}</strong>
                  <small>{[roll.width_inches ? `${roll.width_inches}"` : "", roll.length_feet ? `${qty(roll.length_feet)} ft` : "", shortDate(roll.run_date)].filter(Boolean).join(" / ")}</small>
                </button>
              ))}
              {!relatedRolls.length && <p>No rolls have been created from this schedule yet.</p>}
            </div>
          </section>

          <section className="roll-tag-inventory">
            <header>
              <div>
                <span>Material Inventory</span>
                <strong>{tag.result_code || tag.produced_material_name || tag.name}</strong>
              </div>
              <b>{inventoryRows.length} on record</b>
            </header>
            <div className="roll-tag-inventory-list">
              {inventoryRows.map((inventory) => (
                <article className={sameId(inventory.source_roll_tag, tag.id) ? "current" : ""} key={inventory.id}>
                  <div>
                    <strong>{inventory.serial_number || inventory.code || inventory.name}</strong>
                    <span>{inventory.lot_number || "No lot number"}</span>
                  </div>
                  <span>{inventory.width_inches ? `${inventory.width_inches}" wide` : "Width --"}</span>
                  <span>{inventory.length_feet ? `${qty(inventory.length_feet)} ft` : `${qty(inventory.quantity)} ${inventory.unit || ""}`}</span>
                  <span>{inventory.location_full_path || inventory.location_name || "No location"}</span>
                  <b>{labelize(inventory.status)}</b>
                </article>
              ))}
              {!inventoryRows.length && <p>No inventory records are linked to this material yet.</p>}
            </div>
          </section>

          <section className="roll-tag-link-printer">
            <label>
              <span>Reprint To</span>
              <select value={form.press || ""} onChange={(event) => selectPrinter(event.target.value)}>
                <option value="">Select printer</option>
                {(data.presses ?? []).map((press) => (
                  <option value={press.id} key={press.id}>{press.name}{press.printer_ip ? ` / ${press.printer_ip}` : " / setup needed"}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Copies</span>
              <input type="number" min="1" max="20" value={form.copies} onChange={(event) => update("copies", event.target.value)} />
            </label>
            <div className={form.printer_ip ? "ready" : ""}>
              <Printer size={16} />
              <span>
                {form.printer_ip
                  ? `${form.printer_ip}:${form.printer_port || 9100} / Speed ${form.printer_speed || 5} / Darkness ${form.printer_darkness || 11}`
                  : "Printer setup required"}
              </span>
            </div>
            <button className="ghost-btn xs roll-tag-printer-settings-toggle" type="button" onClick={() => setPrinterSettingsOpen((open) => !open)}>
              <Settings2 size={15} /> {printerSettingsOpen ? "Hide Printer Settings" : "Edit Printer Settings"}
            </button>
            {printerSettingsOpen && (
              <section className="roll-tag-printer-settings" aria-label="Printer settings">
                <label>
                  <span>Printer IP</span>
                  <input value={form.printer_ip} onChange={(event) => update("printer_ip", event.target.value)} placeholder="192.168.1.100" />
                </label>
                <label>
                  <span>Port</span>
                  <input type="number" min="1" max="65535" value={form.printer_port} onChange={(event) => update("printer_port", event.target.value)} />
                </label>
                <label>
                  <span>Speed</span>
                  <input type="number" min="1" max="14" value={form.printer_speed} onChange={(event) => update("printer_speed", event.target.value)} />
                </label>
                <label>
                  <span>Darkness</span>
                  <input type="number" min="0" max="30" step="1" value={form.printer_darkness} onChange={(event) => update("printer_darkness", event.target.value)} />
                </label>
              </section>
            )}
          </section>

          {error && <div className="coater-error">{error}</div>}
          {notice && <div className="coater-print-success"><CheckCircle2 size={16} /><span>{notice}</span></div>}

          <footer>
            <button className="ghost-btn" type="button" onClick={() => run("save")} disabled={Boolean(busyAction)}>
              <Save size={16} /> {busyAction === "save" ? "Saving..." : "Save Changes"}
            </button>
            <button className="primary-btn" type="button" onClick={() => run("reprint")} disabled={Boolean(busyAction) || !form.printer_ip}>
              <Printer size={16} /> {busyAction === "reprint" ? "Queueing..." : "Save & Reprint"}
            </button>
          </footer>
        </div>
      </div>
    </section>
  );
}

export default function CoaterOperatorView({ currentUser, linkedRollTagId = "", onLinkedRollTagChange, onLinkedRollTagClose }) {
  const queryClient = useQueryClient();
  const [selectedPress, setSelectedPress] = useState("all");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [productForms, setProductForms] = useState({});
  const [rollTagNotice, setRollTagNotice] = useState("");
  const [lastCreatedRollId, setLastCreatedRollId] = useState("");

  const dataQuery = useQuery({
    queryKey: ["coater-operator-data"],
    queryFn: async () => {
      const [tags, schedule, materials, supplierOptions, presses, locations, rawMaterials] = await Promise.all([
        fetchCollection("coater-roll-tags", { ordering: "-run_date,tag_number", pageSize: 500, fetchAll: true }),
        fetchCollection("production-schedule", { ordering: "scheduled_date,press_sequence", pageSize: 500, fetchAll: true }),
        fetchCollection("materials", { ordering: "material_type,name", pageSize: 500, fetchAll: true }),
        fetchCollection("material-supplier-options", { ordering: "material__material_type,material__name,supplier_name", pageSize: 1000, fetchAll: true }),
        fetchCollection("presses", { ordering: "name", pageSize: 250, fetchAll: true }),
        fetchCollection("locations", { ordering: "name", pageSize: 500, fetchAll: true }),
        fetchCollection("raw-materials", { ordering: "-received_date,-id", filters: { material_type: "coated_stock" }, pageSize: 1000, fetchAll: true }),
      ]);
      return {
        tags: tags.results ?? [],
        schedule: schedule.results ?? [],
        materials: materials.results ?? [],
        supplierOptions: supplierOptions.results ?? [],
        presses: presses.results ?? [],
        locations: locations.results ?? [],
        rawMaterials: rawMaterials.results ?? [],
      };
    },
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const data = dataQuery.data ?? { tags: [], schedule: [], materials: [], supplierOptions: [], presses: [], locations: [], rawMaterials: [] };
  const operatorName = currentUser?.name || "";
  const preferredPresses = useMemo(() => {
    const coater = data.presses.filter(isCoaterPress);
    return coater.length ? coater : data.presses;
  }, [data.presses]);

  const materialJobs = useMemo(() => data.tags
    .filter((tag) => !tag.source_schedule)
    .filter((tag) => activeMaterialStatuses.has(tag.status))
    .filter((tag) => selectedPress === "all" || sameId(tag.press, selectedPress))
    .sort((a, b) => String(a.run_date || "").localeCompare(String(b.run_date || "")) || String(a.tag_number || "").localeCompare(String(b.tag_number || ""))),
  [data.tags, selectedPress]);

  const productJobs = useMemo(() => data.schedule
    .filter((row) => activeProductStatuses.has(row.status))
    .filter((row) => selectedPress === "all" || sameId(row.press, selectedPress))
    .sort((a, b) => Number(a.press_sequence || 9999) - Number(b.press_sequence || 9999) || String(a.scheduled_date || a.due_date || "").localeCompare(String(b.scheduled_date || b.due_date || ""))),
  [data.schedule, selectedPress]);

  const selectedTag = useMemo(() => {
    if (selectedTagId) return materialJobs.find((tag) => sameId(tag.id, selectedTagId)) ?? materialJobs[0] ?? null;
    return materialJobs[0] ?? null;
  }, [materialJobs, selectedTagId]);
  const selectedScheduleRolls = useMemo(() => {
    if (!selectedTag) return [];
    return data.tags
      .filter((tag) => sameId(tag.source_schedule, selectedTag.id) && tag.status !== "void")
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [data.tags, selectedTag]);
  const linkedRollTag = useMemo(
    () => data.tags.find((tag) => sameId(tag.id, linkedRollTagId)) ?? null,
    [data.tags, linkedRollTagId]
  );
  const linkedSchedule = useMemo(() => {
    if (!linkedRollTag) return null;
    const scheduleId = linkedRollTag.source_schedule || linkedRollTag.id;
    return data.tags.find((tag) => sameId(tag.id, scheduleId)) ?? null;
  }, [data.tags, linkedRollTag]);
  const linkedScheduleRolls = useMemo(() => {
    if (!linkedSchedule) return [];
    return data.tags
      .filter((tag) => sameId(tag.source_schedule, linkedSchedule.id) && tag.status !== "void")
      .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
  }, [data.tags, linkedSchedule]);
  const linkedMaterialInventory = useMemo(() => {
    if (!linkedRollTag) return [];
    const materialId = linkedRollTag.produced_material || linkedRollTag.scheduled_material || linkedSchedule?.produced_material || linkedSchedule?.scheduled_material;
    const rollIds = new Set(linkedScheduleRolls.map((roll) => String(roll.id)));
    return data.rawMaterials
      .filter((inventory) => sameId(inventory.material, materialId) || rollIds.has(String(inventory.source_roll_tag || "")))
      .sort((a, b) => Number(b.status === "available") - Number(a.status === "available") || String(b.received_date || "").localeCompare(String(a.received_date || "")));
  }, [data.rawMaterials, linkedRollTag, linkedSchedule, linkedScheduleRolls]);

  useEffect(() => {
    if (!selectedTag?.id) {
      setSelectedTagId("");
      return;
    }
    if (!selectedTagId || !materialJobs.some((tag) => sameId(tag.id, selectedTagId))) {
      setSelectedTagId(String(selectedTag.id));
    }
  }, [materialJobs, selectedTag?.id, selectedTagId]);

  const createRollMutation = useMutation({
    mutationFn: async ({ tag, form }) => {
      const missing = validateRollForm(form, data);
      if (missing.length) throw new Error(`Missing: ${missing.join(", ")}`);
      const saved = await postRecordAction("coater-roll-tags", tag.id, "create-roll", {
        liner: numberOrNull(form.liner),
        face: numberOrNull(form.face),
        adhesive: numberOrNull(form.adhesive),
        silicone: numberOrNull(form.silicone),
        coating: numberOrNull(form.coating),
        liner_supplier_option: numberOrNull(form.liner_supplier_option),
        face_supplier_option: numberOrNull(form.face_supplier_option),
        adhesive_supplier_option: numberOrNull(form.adhesive_supplier_option),
        silicone_supplier_option: numberOrNull(form.silicone_supplier_option),
        coating_supplier_option: numberOrNull(form.coating_supplier_option),
        result_lot_number: String(form.result_lot_number || "").trim(),
        width_inches: numberOrNull(form.width_inches),
        length_feet: numberOrNull(form.length_feet),
        weight_lbs: numberOrNull(form.weight_lbs),
        operator: form.operator || operatorName,
        run_date: today(),
        location: numberOrNull(form.location),
        operator_notes: form.operator_notes || tag.operator_notes || "",
        notes: noteBlock(tag, form, data.supplierOptions),
      });
      if (!form.print_roll_tag) return { saved, printResult: null };

      try {
        const printResult = await postRecordAction("coater-roll-tags", saved.id, "queue-print-label", {
          press: numberOrNull(form.printer_press),
          copies: 1,
          printer_ip: String(form.printer_ip || "").trim(),
          printer_port: numberOrNull(form.printer_port) || 9100,
          speed: String(form.printer_speed || 5),
          darkness: String(form.printer_darkness || 11),
          save_printer_settings: true,
          operator: form.operator || operatorName,
          performed_by: form.operator || operatorName,
          frontend_url: window.location.origin,
        });
        return { saved, printResult };
      } catch (printError) {
        throw new Error(`Roll ${saved.tag_number} was created, but the print job could not be queued. ${printError.message || ""}`.trim());
      }
    },
    onSuccess: ({ saved, printResult }) => {
      setSelectedTagId(String(saved.source_schedule || selectedTagId));
      setLastCreatedRollId(String(saved.id));
      setRollTagNotice(
        printResult
          ? `${saved.tag_number} was added to inventory and queued to ${printResult.queueKey}. The schedule is still running.`
          : `${saved.tag_number} was added to inventory. The schedule is still running.`
      );
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
    },
  });

  const finishScheduleMutation = useMutation({
    mutationFn: (schedule) => updateRecord("coater-roll-tags", schedule.id, {
      status: "complete",
      operator: operatorName || schedule.operator,
    }),
    onSuccess: (saved) => {
      setRollTagNotice(`${saved.tag_number} was finished and removed from the active lineup.`);
      setSelectedTagId("");
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const productMutation = useMutation({
    mutationFn: ({ row, payload }) => updateRecord("production-schedule", row.id, {
      ...payload,
      operator: operatorName || row.operator,
      last_updated_by: operatorName || row.last_updated_by,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "production-schedule"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "customer-orders"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  function startProductJob(row) {
    productMutation.mutate({ row, payload: { status: "running" } });
  }

  function completeProductJob(row, formValue) {
    productMutation.mutate({
      row,
      payload: {
        status: "complete",
        actual_footage: numberOrNull(formValue.actual_footage),
        footage_report: formValue.footage_report || row.footage_report || "",
      },
    });
  }

  return (
    <section className="coater-operator-view">
      <header className="coater-hero">
        <div>
          <p className="eyebrow">Coater Operator</p>
          <h2>Coater Lineup</h2>
          <span>{operatorName || "Operator"} / {materialJobs.length} material run{materialJobs.length === 1 ? "" : "s"} / {productJobs.length} product job{productJobs.length === 1 ? "" : "s"}</span>
        </div>
        <button className="ghost-btn" type="button" onClick={() => dataQuery.refetch()} disabled={dataQuery.isFetching}>
          <RefreshCcw size={15} /> {dataQuery.isFetching ? "Refreshing" : "Refresh"}
        </button>
      </header>

      <PressFilter presses={preferredPresses} selectedPress={selectedPress} onSelect={setSelectedPress} />

      {dataQuery.isLoading && <p className="coater-empty">Loading the coater lineup...</p>}
      {dataQuery.error && <p className="coater-error">The coater lineup could not load: {dataQuery.error.message}</p>}

      <div className="coater-work-grid">
        <section className="coater-panel">
          <header>
            <div>
              <span><Ruler size={14} /> Material Jobs</span>
              <strong>{materialJobs.length} scheduled</strong>
            </div>
          </header>
          <div className="coater-job-list">
            {materialJobs.map((tag) => (
              <MaterialJobCard
                tag={tag}
                selected={sameId(tag.id, selectedTag?.id)}
                key={tag.id}
                onSelect={() => setSelectedTagId(String(tag.id))}
              />
            ))}
            {!materialJobs.length && <p className="coater-empty">No material jobs are scheduled for this press.</p>}
          </div>
        </section>

        <section className="coater-panel coater-run-panel">
          <header>
            <div>
              <span><Factory size={14} /> Run Material</span>
              <strong>{selectedTag?.tag_number || "No run selected"}</strong>
            </div>
            {selectedTag && (
              <button
                className="ghost-btn xs"
                type="button"
                disabled={createRollMutation.isPending || finishScheduleMutation.isPending}
                onClick={() => {
                  const message = `Finish ${selectedTag.tag_number}? It will leave the active lineup, but all ${selectedScheduleRolls.length} roll records will remain in inventory.`;
                  if (window.confirm(message)) finishScheduleMutation.mutate(selectedTag);
                }}
              >
                <CheckCircle2 size={14} /> {finishScheduleMutation.isPending ? "Finishing..." : "Finish Schedule"}
              </button>
            )}
          </header>
          {rollTagNotice && <div className="coater-print-success"><CheckCircle2 size={16} /><span>{rollTagNotice}</span></div>}
          {selectedTag ? (
            <RollRunForm
              tag={selectedTag}
              data={data}
              currentUser={currentUser}
              saving={createRollMutation.isPending}
              error={createRollMutation.error?.message}
              createdRollId={lastCreatedRollId}
              onSave={(form) => { setRollTagNotice(""); createRollMutation.mutate({ tag: selectedTag, form }); }}
            />
          ) : (
            <p className="coater-empty">Select a scheduled material run.</p>
          )}
          {selectedTag && (
            <section className="coater-produced-rolls">
              <header>
                <div><span>Produced Rolls</span><strong>{selectedScheduleRolls.length} from this schedule</strong></div>
              </header>
              <div>
                {selectedScheduleRolls.slice(0, 12).map((roll) => (
                  <button type="button" key={roll.id} onClick={() => onLinkedRollTagChange?.(roll.id)}>
                    <strong>{roll.tag_number}</strong>
                    <span>{roll.result_lot_number}</span>
                    <b>{roll.length_feet ? `${qty(roll.length_feet)} ft` : "--"}</b>
                  </button>
                ))}
                {!selectedScheduleRolls.length && <p>Each new roll will appear here with its own ID.</p>}
              </div>
            </section>
          )}
        </section>
      </div>

      <section className="coater-panel coater-product-panel">
        <header>
          <div>
            <span><PackageCheck size={14} /> Finished Product Jobs</span>
            <strong>{productJobs.length} scheduled</strong>
          </div>
        </header>
        <div className="coater-product-list">
          {productJobs.map((row) => (
            <ProductJobCard
              row={row}
              key={row.id}
              form={productForms}
              setForm={setProductForms}
              updating={productMutation.isPending}
              onStart={startProductJob}
              onComplete={completeProductJob}
            />
          ))}
          {!productJobs.length && <p className="coater-empty">No finished product jobs are scheduled for this press.</p>}
        </div>
      </section>

      {linkedRollTag && (
        <RollTagDetailDialog
          tag={linkedRollTag}
          schedule={linkedSchedule}
          relatedRolls={linkedScheduleRolls}
          inventoryRows={linkedMaterialInventory}
          data={data}
          currentUser={currentUser}
          onClose={onLinkedRollTagClose}
          onOpenRoll={onLinkedRollTagChange}
          onSaved={() => {
            queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
            queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
            queryClient.invalidateQueries({ queryKey: ["lookups"] });
          }}
        />
      )}
      {linkedRollTagId && !linkedRollTag && !dataQuery.isLoading && (
        <section className="roll-tag-link-overlay" role="dialog" aria-modal="true" aria-label="Roll tag not found">
          <div className="roll-tag-link-window not-found">
            <h2>Roll Tag Not Found</h2>
            <p>This roll tag may have been removed or the barcode link is incomplete.</p>
            <button className="primary-btn" type="button" onClick={onLinkedRollTagClose}>Close</button>
          </div>
        </section>
      )}
    </section>
  );
}
