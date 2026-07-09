import { BrowserMultiFormatReader } from "@zxing/browser";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarDays, Camera, CheckCircle2, ChevronRight, Factory, Layers3, PackageCheck, Play, Printer, RefreshCcw, Save, Search, Settings2, Trash2, X } from "lucide-react";
import { fetchCollection, postRecordAction, updateRecord } from "../api";
import { formatInches, getRecordTitle, labelize } from "../lib/format";
import { canDeleteMaterialRoll } from "../lib/localAuth";
import DeleteMaterialRollDialog from "./DeleteMaterialRollDialog";

const activeMaterialStatuses = new Set(["scheduled", "running", "on_hold"]);
const activeProductStatuses = new Set(["scheduled", "ready", "running", "on_hold"]);
const componentSlots = [
  { key: "face", preferredKey: "face_material", label: "Face", type: "face", supplierKey: "face_supplier_option", allowedKey: "allowed_face_materials" },
  { key: "liner", preferredKey: "liner_material", label: "Liner", type: "liner", supplierKey: "liner_supplier_option", allowedKey: "allowed_liner_materials" },
  { key: "adhesive", preferredKey: "adhesive_material", label: "Adhesive", type: "adhesive", supplierKey: "adhesive_supplier_option", allowedKey: "allowed_adhesive_materials" },
  { key: "silicone", preferredKey: "silicone_material", label: "Silicone", type: "silicone", supplierKey: "silicone_supplier_option", allowedKey: "allowed_silicone_materials" },
  { key: "coating", preferredKey: "coating_material", label: "Coating", type: "coating", supplierKey: "coating_supplier_option", allowedKey: "allowed_coating_materials", optional: true },
];
const commonCoaterWidths = ["8.75", "9", "12.75"];

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined || a === "" || b === "") return false;
  return String(a) === String(b);
}

function userHeaders(user) {
  return {
    "X-Company-User-Id": String(user?.id || ""),
    "X-Company-Username": String(user?.username || ""),
  };
}

function apiErrorMessage(error) {
  const message = String(error?.message || "");
  try {
    const payload = JSON.parse(message);
    return payload.detail || Object.values(payload).flat().filter(Boolean).join(" ") || message;
  } catch {
    return message;
  }
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

function minimalLot(row) {
  const value = String(row?.result_lot_number || row?.tag_number || "").trim();
  return value.replace(/^LOT-/i, "").replace(/^CRT-/i, "") || "--";
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

function skidSearchText(skid) {
  return [
    skid?.skid_number,
    skid?.qr_token,
    skid?.current_rack_code,
    skid?.current_location_display,
    skid?.other_location,
    skid?.notes,
  ].filter(Boolean).join(" ").toLowerCase();
}

function extractSkidScanCandidates(value) {
  const text = String(value || "").trim();
  if (!text) return [];
  const candidates = [text];
  try {
    const parsed = new URL(text, window.location.origin);
    const token = parsed.searchParams.get("skidToken");
    if (token) candidates.push(token);
    const lastPath = parsed.pathname.split("/").filter(Boolean).pop();
    if (lastPath) candidates.push(lastPath);
  } catch {
    // Plain scanner values are handled by the original text candidate.
  }
  return [...new Set(candidates.map((candidate) => String(candidate || "").trim()).filter(Boolean))];
}

function findSkidByScan(skids, value) {
  const candidates = extractSkidScanCandidates(value).map((candidate) => candidate.toLowerCase());
  if (!candidates.length) return null;
  return (skids ?? []).find((skid) => candidates.some((candidate) => (
    String(skid.id) === candidate
    || String(skid.skid_number || "").toLowerCase() === candidate
    || String(skid.qr_token || "").toLowerCase() === candidate
  ))) || null;
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
  const rows = (locations ?? []).filter((row) => row.inventory_scope !== "finished_product");
  return rows.find((row) => {
    const path = String(row.full_path || row.name || "").trim().toLowerCase();
    return path === "wilmington ohio > plant floor";
  }) ?? rows.find((row) => (
    /wilmington\s*ohio/i.test(String(row.full_path || ""))
    && /plant\s*floor/i.test(`${row.full_path || ""} ${row.name || ""}`)
  )) ?? null;
}

function componentFamilyKey(row) {
  return String(row?.material_family || row?.material_name || row?.name || row?.material_code || row?.code || "")
    .trim()
    .toLowerCase();
}

function partToken(row, coated = false) {
  const value = row?.master_type_code
    || row?.material_family
    || (coated ? String(row?.name || row?.code || "").split(/[-/]/)[0] : "")
    || row?.name
    || row?.code
    || "";
  return String(value).toUpperCase().replace(/[^A-Z0-9]+/g, "");
}

function rollPartNumber(schedule, form, materials) {
  const material = (materials ?? []).find((row) => sameId(row.id, schedule?.scheduled_material || schedule?.produced_material));
  const liner = (materials ?? []).find((row) => sameId(row.id, form?.liner || schedule?.liner));
  const adhesive = (materials ?? []).find((row) => sameId(row.id, form?.adhesive || schedule?.adhesive));
  return [partToken(material, true), partToken(liner), partToken(adhesive)].filter(Boolean).join("-");
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
  const location = plantFloorLocation(data.locations)?.id || "";
  const loggedInOperator = currentUser?.name || currentUser?.username || "";
  const printerPress = (data.presses ?? []).find((press) => sameId(press.id, tag?.press))
    || (data.presses ?? []).find((press) => press.printer_ip)
    || (data.presses ?? [])[0];
  const form = {
    liner: defaultComponentId(material, tag, componentSlots.find((slot) => slot.key === "liner")),
    face: defaultComponentId(material, tag, componentSlots.find((slot) => slot.key === "face")),
    adhesive: defaultComponentId(material, tag, componentSlots.find((slot) => slot.key === "adhesive")),
    silicone: defaultComponentId(material, tag, componentSlots.find((slot) => slot.key === "silicone")),
    coating: defaultComponentId(material, tag, componentSlots.find((slot) => slot.key === "coating")),
    width_inches: tag?.width_inches || "",
    length_feet: tag?.is_schedule ? "" : (tag?.length_feet || ""),
    weight_lbs: tag?.weight_lbs || "",
    result_lot_number: tag?.is_schedule ? "" : (tag?.result_lot_number || ""),
    skid: "",
    location,
    operator_notes: "",
    operator: loggedInOperator,
    printer_press: printerPress?.id ? String(printerPress.id) : "",
    print_copies: "1",
    ...printerSettingsFor(printerPress),
  };
  componentSlots.forEach((slot) => {
    form[slot.supplierKey] = "";
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
  if (!numberOrNull(form.width_inches) || numberOrNull(form.width_inches) <= 0) missing.push("finished width");
  if (!numberOrNull(form.length_feet) || numberOrNull(form.length_feet) <= 0) missing.push("actual roll length");
  if (!String(form.result_lot_number || "").trim()) missing.push("lot number");
  if (!form.skid) missing.push("skid");
  if (!String(form.operator || "").trim()) missing.push("operator");
  if (!form.location && !form.skid) missing.push("plant location");
  if (!form.printer_press) {
    missing.push("Roll tag printer");
  } else if (!String(form.printer_ip || "").trim()) {
    missing.push("Printer IP setup");
  }
  return missing;
}

function CoaterSkidCamera({ onResult, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const resultRef = useRef(onResult);
  const [error, setError] = useState("");

  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let active = true;

    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          setError("Camera scanning requires HTTPS or localhost. Use the scan field instead.");
          return;
        }
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 100,
          delayBetweenScanSuccess: 300,
        });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result, _scanError, currentControls) => {
            const value = result?.getText?.();
            if (value && active) {
              currentControls?.stop?.();
              resultRef.current(value);
            }
          },
        );
        if (!active) controls?.stop?.();
        else controlsRef.current = controls;
      } catch (scanError) {
        setError(scanError?.name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access or use the scan field."
          : "Could not open the camera. Use the scan field or a USB scanner.");
      }
    }

    start();
    return () => {
      active = false;
      controlsRef.current?.stop?.();
      controlsRef.current = null;
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div className="coater-skid-camera">
      <video ref={videoRef} playsInline muted />
      <button type="button" onClick={onClose}><X size={16} /> Close Camera</button>
      {error && <p>{error}</p>}
    </div>
  );
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

function UnifiedJobCard({ item, onSelect }) {
  const isMaterial = item.kind === "material";
  const row = item.row;
  const title = isMaterial
    ? row.scheduled_material_name || row.name
    : row.job_name || row.job_product_code || getRecordTitle(row);
  const identifier = isMaterial ? row.tag_number : row.job_ticket_number || "Production Job";
  const date = isMaterial ? row.run_date : row.scheduled_date || row.due_date;
  const detail = isMaterial
    ? [
        row.cut_description || "No cutting notes",
        row.schedule_target_footage || row.length_feet ? `${qty(row.schedule_target_footage || row.length_feet, " ft")} scheduled` : "",
      ]
    : [
        row.customer_name,
        row.customer_po ? `PO ${row.customer_po}` : "",
        `${qty(Number(row.quantity_to_ship || 0) + Number(row.quantity_to_stock || 0))} total`,
      ];

  return (
    <button className={`coater-lineup-row ${isMaterial ? "material" : "product"}`} type="button" onClick={onSelect}>
      <span className="coater-lineup-kind">
        {isMaterial ? <Layers3 size={17} /> : <PackageCheck size={17} />}
        {isMaterial ? "Material" : "Finished Product"}
      </span>
      <div className="coater-lineup-title">
        <span>{identifier}</span>
        <strong>{title}</strong>
        <em>{detail.filter(Boolean).join(" / ")}</em>
      </div>
      <div className="coater-lineup-meta">
        <strong>{row.press_name || "No press"}</strong>
        <span><CalendarDays size={13} /> {shortDate(date)}</span>
      </div>
      <span className={`coater-lineup-status ${row.status}`}>{labelize(row.status)}</span>
      <ChevronRight size={20} className="coater-lineup-arrow" />
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
        <span>{slot.optional ? "Optional" : familyLabels.join(" / ") || "Type not configured"}</span>
      </header>
      <label>
        <span>Supplier Material</span>
        <select value={form[slot.supplierKey] || ""} onChange={(event) => updateSupplier(event.target.value)} required={!slot.optional}>
          <option value="">{selectedSupplierOptions.length ? `Select ${slot.label.toLowerCase()} supplier` : "No suppliers linked"}</option>
          {selectedSupplierOptions.map((option) => (
            <option value={option.id} key={option.id}>{supplierChoiceLabel(option)}</option>
          ))}
        </select>
      </label>
      {selectedSupplier && supplierOptionMeta(selectedSupplier) ? (
        <div className="coater-component-spec">{supplierOptionMeta(selectedSupplier)}</div>
      ) : null}
      {!selectedSupplier && materialOptions.length > 0 ? (
        <p className={`coater-component-help ${selectedSupplierOptions.length ? "" : "warning"}`}>
          {selectedSupplierOptions.length
            ? `${selectedSupplierOptions.length} compatible supplier option${selectedSupplierOptions.length === 1 ? "" : "s"}`
            : `No suppliers are linked to this ${slot.label.toLowerCase()} type.`}
        </p>
      ) : null}
    </section>
  );
}

function RollRunForm({ tag, data, currentUser, saving, error, createdRollId, setupSectionId, rollSectionId, onSave }) {
  const [form, setForm] = useState(() => defaultRollForm(tag, data, currentUser));
  const [printerSettingsOpen, setPrinterSettingsOpen] = useState(false);
  const [skidSearch, setSkidSearch] = useState("");
  const [skidError, setSkidError] = useState("");
  const [skidCameraOpen, setSkidCameraOpen] = useState(false);
  const missing = validateRollForm(form, data);
  const scheduledMaterial = (data.materials ?? []).find((row) => sameId(row.id, tag?.scheduled_material));
  const selectedPrinter = (data.presses ?? []).find((press) => sameId(press.id, form.printer_press));
  const activeSkids = (data.skids ?? []).filter((skid) => skid.status === "active");
  const selectedSkid = activeSkids.find((skid) => sameId(skid.id, form.skid));
  const skidMatches = activeSkids
    .filter((skid) => !skidSearch.trim() || skidSearchText(skid).includes(skidSearch.trim().toLowerCase()))
    .slice(0, 5);
  const partNumber = rollPartNumber(tag, form, data.materials);

  useEffect(() => {
    setForm(defaultRollForm(tag, data, currentUser));
  }, [tag?.id]);

  useEffect(() => {
    if (!createdRollId) return;
    setForm((current) => ({
      ...current,
      result_lot_number: "",
      length_feet: "",
      weight_lbs: "",
    }));
  }, [createdRollId]);

  function update(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  function selectSkid(skid) {
    setSkidError("");
    setForm((prev) => ({ ...prev, skid: skid?.id ? String(skid.id) : "" }));
    setSkidSearch(skid ? skid.skid_number : "");
  }

  function applySkidScan(value = skidSearch) {
    const match = findSkidByScan(activeSkids, value);
    if (!match) {
      setSkidError("No active skid matched that scan or search.");
      return;
    }
    selectSkid(match);
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
    <form className="coater-roll-form" id={setupSectionId} onSubmit={submit}>
      <header>
        <div>
          <span>Material Setup</span>
          <strong>Select What Is Running</strong>
          <em>{[partNumber ? `Part ${partNumber}` : "", tag.scheduled_material_name || tag.name].filter(Boolean).join(" / ")}</em>
        </div>
        <span className="coater-roll-id">Schedule {tag.tag_number}</span>
      </header>

      <div className="coater-component-grid">
        {componentSlots.filter((slot) => slot.key !== "coating").map((slot) => (
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

      <section className="coater-roll-print-step" id={rollSectionId}>
        <header>
          <div>
            <span>New Physical Roll</span>
            <strong>Enter the finished roll and print its tag</strong>
          </div>
          <Printer size={20} />
        </header>
        <div className="coater-roll-details-grid">
          <label className="coater-roll-lot-field">
            <span>Lot Number</span>
            <input value={form.result_lot_number} onChange={(event) => update("result_lot_number", event.target.value)} placeholder="Operator-entered lot" required />
          </label>
          <label className="coater-width-field coater-roll-width-field">
            <span>Finished Width</span>
            <div className="coater-width-options" role="group" aria-label="Common finished widths">
              {commonCoaterWidths.map((width) => (
                <button
                  className={String(form.width_inches) === width ? "active" : ""}
                  type="button"
                  key={width}
                  onClick={() => update("width_inches", width)}
                >
                  {width}"
                </button>
              ))}
            </div>
            <input type="number" min="0.001" step="0.001" value={form.width_inches} onChange={(event) => update("width_inches", event.target.value)} placeholder="Custom width" required />
          </label>
          <label className="coater-roll-length-field">
            <span>Actual Roll Length</span>
            <input type="number" min="0.01" step="0.01" value={form.length_feet} onChange={(event) => update("length_feet", event.target.value)} placeholder="Feet on this roll" required />
          </label>
          <label className="coater-roll-operator-field">
            <span>Operator</span>
            <input className="coater-operator-locked" value={form.operator} readOnly aria-readonly="true" required />
          </label>
          <div className="coater-skid-picker">
            <div className="coater-skid-panel-title">
              <span>Skid Destination</span>
              <small>Search, select, or scan where this roll will land.</small>
            </div>
            <div className={`coater-selected-skid ${selectedSkid ? "ready" : ""}`}>
              <strong>{selectedSkid?.skid_number || "No skid selected"}</strong>
              <small>{selectedSkid ? (selectedSkid.current_location_display || "Plant floor") : "Search or scan the skid QR code"}</small>
            </div>
            <div className="coater-skid-search-row">
              <Search size={15} />
              <input
                value={skidSearch}
                onChange={(event) => {
                  setSkidSearch(event.target.value);
                  setSkidError("");
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    applySkidScan(event.currentTarget.value);
                  }
                }}
                placeholder="Search skid or scan QR"
              />
              <button type="button" onClick={() => applySkidScan()}>
                Select
              </button>
              <button type="button" onClick={() => setSkidCameraOpen(true)} aria-label="Scan skid QR with camera" title="Scan skid QR">
                <Camera size={16} />
              </button>
            </div>
            {skidMatches.length > 0 && (
              <div className="coater-skid-results">
                {skidMatches.map((skid) => (
                  <button className={sameId(skid.id, form.skid) ? "active" : ""} type="button" key={skid.id} onClick={() => selectSkid(skid)}>
                    <strong>{skid.skid_number}</strong>
                    <span>{skid.current_location_display || "Plant floor"}</span>
                  </button>
                ))}
              </div>
            )}
            {skidError && <small className="coater-skid-error">{skidError}</small>}
            {skidCameraOpen && (
              <CoaterSkidCamera
                onClose={() => setSkidCameraOpen(false)}
                onResult={(value) => {
                  setSkidCameraOpen(false);
                  setSkidSearch(value);
                  applySkidScan(value);
                }}
              />
            )}
          </div>
          <label className="field-wide coater-roll-notes-field">
            <span>Operator Notes</span>
            <textarea value={form.operator_notes} onChange={(event) => update("operator_notes", event.target.value)} />
          </label>
        </div>
      </section>

      <section className="coater-print-setup active">
        <header>
          <span className="coater-print-icon"><Printer size={18} /></span>
          <div>
            <strong>Roll Tag Printer</strong>
            <span>The system creates the roll ID; the operator enters the lot number.</span>
          </div>
        </header>
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
      </section>

      {error && <p className="coater-error">{error}</p>}
      {missing.length ? <p className="coater-form-note">Missing: {missing.join(", ")}</p> : null}

      <div className="coater-roll-actions">
        <button className="primary-btn" type="submit" disabled={saving || missing.length > 0}>
          <Printer size={16} />
          {saving ? "Creating Roll..." : "Print Tag & Add Roll"}
        </button>
      </div>
    </form>
  );
}

function ScheduleProgress({ schedule, rolls, sectionId, onOpenRoll, onDeleteRoll }) {
  const documented = rolls.filter((roll) => roll.status === "complete");
  const pending = rolls.filter((roll) => roll.status === "tag_printed");
  const target = Number(schedule?.schedule_target_footage ?? schedule?.length_feet ?? 0);
  const footage = documented.reduce((sum, roll) => sum + Number(roll.length_feet || 0), 0);
  const remaining = Math.max(0, target - footage);
  const percent = target > 0 ? Math.min(100, (footage / target) * 100) : 0;

  return (
    <section className="coater-schedule-dashboard" id={sectionId}>
      <header>
        <div>
          <span>Run Progress</span>
          <strong>{schedule?.scheduled_material_name || schedule?.name}</strong>
        </div>
        <b>{percent.toFixed(percent >= 10 ? 0 : 1)}%</b>
      </header>
      <div className="coater-progress-metrics">
        <article><span>Scheduled</span><strong>{qty(target, " ft")}</strong></article>
        <article><span>Ran</span><strong>{qty(footage, " ft")}</strong></article>
        <article><span>Remaining</span><strong>{qty(remaining, " ft")}</strong></article>
        <article><span>Finished Rolls</span><strong>{documented.length}</strong></article>
      </div>
      {schedule?.cut_description && (
        <div className="coater-cutting-data">
          <span>Cutting Data</span>
          <strong>{schedule.cut_description}</strong>
        </div>
      )}
      <div className="coater-footage-progress" role="progressbar" aria-valuemin="0" aria-valuemax={target || 100} aria-valuenow={footage}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="coater-ran-rolls">
        <header>
          <div>
            <span>Rolls From This Run</span>
            <strong>{rolls.length} roll{rolls.length === 1 ? "" : "s"}</strong>
          </div>
          {pending.length > 0 && <em><AlertTriangle size={14} /> {pending.length} print attempt{pending.length === 1 ? "" : "s"} need attention</em>}
        </header>
        {rolls.length > 0 && (
          <div className="coater-ran-roll-head" aria-hidden="true">
            <span>Roll</span>
            <span>Operator</span>
            <span>Date</span>
            <span>Lot</span>
            <span>Length</span>
            <span />
          </div>
        )}
        <div className="coater-ran-roll-list">
          {rolls.map((roll) => (
            <article className={roll.status === "complete" ? "" : "pending"} key={roll.id}>
              <button type="button" onClick={() => onOpenRoll?.(roll.id)}>
                <strong>{roll.tag_number}</strong>
                <small>{roll.status === "complete" ? "In inventory" : "Print incomplete"}</small>
              </button>
              <span data-label="Operator">{roll.operator || "--"}</span>
              <span data-label="Date">{shortDate(roll.run_date || roll.created_at)}</span>
              <span data-label="Lot">{minimalLot(roll)}</span>
              <strong data-label="Length">{roll.length_feet ? qty(roll.length_feet, " ft") : "--"}</strong>
              {onDeleteRoll && (
                <button className="coater-roll-delete" type="button" title={`Remove ${roll.tag_number} from inventory`} onClick={() => onDeleteRoll(roll)}>
                  <Trash2 size={16} />
                </button>
              )}
            </article>
          ))}
          {!rolls.length && <p>No rolls have been printed for this run yet.</p>}
        </div>
      </div>
    </section>
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

function MaterialJobDialog({
  tag,
  rolls,
  data,
  currentUser,
  notice,
  creating,
  createError,
  createdRollId,
  finishing,
  onClose,
  onCreateRoll,
  onFinish,
  onOpenRoll,
  onDeleteRoll,
}) {
  if (!tag) return null;
  const sectionPrefix = `coater-run-${tag.id}`;
  const progressSectionId = `${sectionPrefix}-progress`;
  const setupSectionId = `${sectionPrefix}-setup`;
  const rollSectionId = `${sectionPrefix}-new-roll`;

  return (
    <section className="coater-job-overlay" role="dialog" aria-modal="true" aria-label={`Material run ${tag.tag_number}`}>
      <div className="coater-material-window">
        <header className="coater-job-window-head">
          <div>
            <span className="coater-window-type material"><Layers3 size={16} /> Material Run</span>
            <h2>{tag.scheduled_material_name || tag.name}</h2>
            <p>{[tag.tag_number, tag.press_name || "No press"].filter(Boolean).join(" / ")}</p>
          </div>
          <div>
            <button
              className="ghost-btn"
              type="button"
              disabled={creating || finishing}
              onClick={() => {
                const message = `Finish ${tag.tag_number}? The schedule will leave the active lineup and all ${rolls.length} physical roll records will remain.`;
                if (window.confirm(message)) onFinish?.(tag);
              }}
            >
              <CheckCircle2 size={16} /> {finishing ? "Finishing..." : "Finish Run"}
            </button>
            <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
          </div>
        </header>

        <main className="coater-material-window-body">
          {notice && <div className="coater-print-success"><CheckCircle2 size={16} /><span>{notice}</span></div>}
          <ScheduleProgress
            schedule={tag}
            rolls={rolls}
            sectionId={progressSectionId}
            onOpenRoll={onOpenRoll}
            onDeleteRoll={onDeleteRoll}
          />
          <RollRunForm
            tag={tag}
            data={data}
            currentUser={currentUser}
            saving={creating}
            error={createError}
            createdRollId={createdRollId}
            setupSectionId={setupSectionId}
            rollSectionId={rollSectionId}
            onSave={onCreateRoll}
          />
        </main>
      </div>
    </section>
  );
}

function ProductJobDialog({ row, forms, setForms, updating, onClose, onStart, onComplete }) {
  if (!row) return null;
  return (
    <section className="coater-job-overlay" role="dialog" aria-modal="true" aria-label={`Finished product job ${row.job_ticket_number}`}>
      <div className="coater-product-window">
        <header className="coater-job-window-head">
          <div>
            <span className="coater-window-type product"><PackageCheck size={16} /> Finished Product</span>
            <h2>{row.job_name || row.job_product_code || getRecordTitle(row)}</h2>
            <p>{[row.job_ticket_number, row.customer_name, row.customer_po ? `PO ${row.customer_po}` : "", row.press_name].filter(Boolean).join(" / ")}</p>
          </div>
          <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
        </header>
        <main>
          <ProductJobCard
            row={row}
            form={forms}
            setForm={setForms}
            updating={updating}
            onStart={onStart}
            onComplete={onComplete}
          />
        </main>
      </div>
    </section>
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
                {(data.locations ?? []).filter((location) => location.inventory_scope !== "finished_product").map((location) => <option value={location.id} key={location.id}>{location.full_path || location.name}</option>)}
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
  const [lineupType, setLineupType] = useState("all");
  const [lineupSearch, setLineupSearch] = useState("");
  const [selectedTagId, setSelectedTagId] = useState("");
  const [selectedProductId, setSelectedProductId] = useState("");
  const [deleteRollCandidate, setDeleteRollCandidate] = useState(null);
  const [productForms, setProductForms] = useState({});
  const [rollTagNotice, setRollTagNotice] = useState("");
  const [lastCreatedRollId, setLastCreatedRollId] = useState("");

  const dataQuery = useQuery({
    queryKey: ["coater-operator-data"],
    queryFn: async () => {
      const [tags, schedule, materials, supplierOptions, presses, locations, rawMaterials, skids] = await Promise.all([
        fetchCollection("coater-roll-tags", { ordering: "-run_date,tag_number", pageSize: 500, fetchAll: true }),
        fetchCollection("production-schedule", { ordering: "scheduled_date,press_sequence", pageSize: 500, fetchAll: true }),
        fetchCollection("materials", { ordering: "material_type,name", pageSize: 500, fetchAll: true }),
        fetchCollection("material-supplier-options", { ordering: "material__material_type,material__name,supplier_name", pageSize: 1000, fetchAll: true }),
        fetchCollection("presses", { ordering: "name", pageSize: 250, fetchAll: true }),
        fetchCollection("locations", { ordering: "name", pageSize: 500, fetchAll: true }),
        fetchCollection("raw-materials", { ordering: "-received_date,-id", filters: { material_type: "coated_stock" }, pageSize: 1000, fetchAll: true }),
        fetchCollection("skids", { ordering: "-created_at", pageSize: 1000, fetchAll: true }),
      ]);
      return {
        tags: tags.results ?? [],
        schedule: schedule.results ?? [],
        materials: materials.results ?? [],
        supplierOptions: supplierOptions.results ?? [],
        presses: presses.results ?? [],
        locations: locations.results ?? [],
        rawMaterials: rawMaterials.results ?? [],
        skids: skids.results ?? [],
      };
    },
    staleTime: 20_000,
    refetchInterval: 60_000,
  });

  const data = dataQuery.data ?? { tags: [], schedule: [], materials: [], supplierOptions: [], presses: [], locations: [], rawMaterials: [], skids: [] };
  const operatorName = currentUser?.name || "";
  const canDeleteRoll = canDeleteMaterialRoll(currentUser);
  const preferredPresses = useMemo(() => {
    const coater = data.presses.filter(isCoaterPress);
    return coater.length ? coater : data.presses;
  }, [data.presses]);
  const preferredPressIds = useMemo(
    () => new Set(preferredPresses.map((press) => String(press.id))),
    [preferredPresses]
  );

  const materialJobs = useMemo(() => data.tags
    .filter((tag) => !tag.source_schedule)
    .filter((tag) => activeMaterialStatuses.has(tag.status))
    .filter((tag) => selectedPress === "all"
      ? (!tag.press || preferredPressIds.has(String(tag.press)))
      : sameId(tag.press, selectedPress))
    .sort((a, b) => String(a.run_date || "").localeCompare(String(b.run_date || "")) || String(a.tag_number || "").localeCompare(String(b.tag_number || ""))),
  [data.tags, selectedPress, preferredPressIds]);

  const productJobs = useMemo(() => data.schedule
    .filter((row) => activeProductStatuses.has(row.status))
    .filter((row) => selectedPress === "all"
      ? preferredPressIds.has(String(row.press || ""))
      : sameId(row.press, selectedPress))
    .sort((a, b) => Number(a.press_sequence || 9999) - Number(b.press_sequence || 9999) || String(a.scheduled_date || a.due_date || "").localeCompare(String(b.scheduled_date || b.due_date || ""))),
  [data.schedule, selectedPress, preferredPressIds]);

  const selectedTag = useMemo(() => {
    if (!selectedTagId) return null;
    return materialJobs.find((tag) => sameId(tag.id, selectedTagId)) ?? null;
  }, [materialJobs, selectedTagId]);
  const selectedProduct = useMemo(
    () => selectedProductId ? productJobs.find((row) => sameId(row.id, selectedProductId)) ?? null : null,
    [productJobs, selectedProductId]
  );
  const lineupJobs = useMemo(() => [
    ...materialJobs.map((row) => ({ kind: "material", row })),
    ...productJobs.map((row) => ({ kind: "product", row })),
  ].sort((left, right) => {
    const leftSequence = Number(left.row.press_sequence || 9999);
    const rightSequence = Number(right.row.press_sequence || 9999);
    if (leftSequence !== rightSequence) return leftSequence - rightSequence;
    const leftDate = String(left.row.scheduled_date || left.row.run_date || left.row.due_date || "");
    const rightDate = String(right.row.scheduled_date || right.row.run_date || right.row.due_date || "");
    return leftDate.localeCompare(rightDate);
  }), [materialJobs, productJobs]);
  const visibleLineupJobs = useMemo(() => {
    const query = lineupSearch.trim().toLowerCase();
    return lineupJobs.filter((item) => {
      if (lineupType !== "all" && item.kind !== lineupType) return false;
      if (!query) return true;
      const row = item.row;
      return [
        item.kind,
        row.tag_number,
        row.scheduled_material_name,
        row.name,
        row.job_ticket_number,
        row.job_name,
        row.job_product_code,
        row.customer_name,
        row.customer_po,
        row.press_name,
        row.cut_description,
        row.status,
      ].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }, [lineupJobs, lineupSearch, lineupType]);
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
          auto_document: true,
        });
        let skidResult = null;
        if (form.skid) {
          const rollScanValue = printResult.roll?.result_serial_number
            || printResult.roll?.tag_number
            || printResult.roll?.result_lot_number
            || saved.result_serial_number
            || saved.tag_number
            || saved.result_lot_number;
          skidResult = await postRecordAction("skids", form.skid, "add-roll", {
            scan_value: rollScanValue,
            performed_by: form.operator || operatorName,
            confirm_move: true,
          }, {
            headers: userHeaders(currentUser),
          });
        }
        return { saved: printResult.roll || saved, printResult, skidResult };
      } catch (printError) {
        throw new Error(`Roll ${saved.tag_number} was created, but the print job could not be queued. ${printError.message || ""}`.trim());
      }
    },
    onSuccess: ({ saved, printResult, skidResult }) => {
      setSelectedTagId(String(saved.source_schedule || selectedTagId));
      setLastCreatedRollId(String(saved.id));
      setRollTagNotice([
        `${saved.tag_number} was printed, documented at ${qty(saved.length_feet, " ft")}, and added to inventory.`,
        skidResult?.skid?.skid_number ? `Placed on ${skidResult.skid.skid_number}.` : "",
      ].filter(Boolean).join(" "));
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "skids"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "skids"] });
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

  const deleteRollMutation = useMutation({
    mutationFn: (roll) => postRecordAction("coater-roll-tags", roll.id, "delete-roll", {
      confirm_delete: true,
    }, {
      headers: userHeaders(currentUser),
    }),
    onSuccess: (result, deletedRoll) => {
      setDeleteRollCandidate(null);
      setRollTagNotice(`${result.tagNumber} and its linked inventory information were permanently deleted.`);
      if (sameId(linkedRollTagId, deletedRoll.id)) onLinkedRollTagClose?.();
      queryClient.invalidateQueries({ queryKey: ["coater-operator-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "coater-roll-tags"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
      queryClient.invalidateQueries({ queryKey: ["production-material-assignments"] });
      queryClient.invalidateQueries({ queryKey: ["lookups"] });
    },
  });

  const productMutation = useMutation({
    mutationFn: ({ row, payload }) => updateRecord("production-schedule", row.id, {
      ...payload,
      operator: operatorName || row.operator,
      last_updated_by: operatorName || row.last_updated_by,
    }),
    onSuccess: (_saved, variables) => {
      if (variables?.payload?.status === "complete") setSelectedProductId("");
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

      <section className="coater-panel coater-unified-panel">
        <header>
          <div>
            <span><Factory size={14} /> Scheduled Work</span>
            <strong>{lineupJobs.length} active job{lineupJobs.length === 1 ? "" : "s"}</strong>
          </div>
          <div className="coater-lineup-legend">
            <span className="material"><Layers3 size={13} /> {materialJobs.length} Material</span>
            <span className="product"><PackageCheck size={13} /> {productJobs.length} Finished Product</span>
          </div>
        </header>
        <div className="coater-lineup-tools">
          <label className="coater-lineup-search">
            <Search size={17} aria-hidden="true" />
            <input
              type="search"
              value={lineupSearch}
              onChange={(event) => setLineupSearch(event.target.value)}
              placeholder="Search job, material, customer, PO..."
              aria-label="Search scheduled coater work"
            />
            {lineupSearch && (
              <button type="button" onClick={() => setLineupSearch("")} title="Clear search" aria-label="Clear lineup search">
                <X size={15} />
              </button>
            )}
          </label>
          <div className="coater-lineup-type-filter" role="tablist" aria-label="Scheduled work type">
            <button className={lineupType === "all" ? "active" : ""} type="button" role="tab" aria-selected={lineupType === "all"} onClick={() => setLineupType("all")}>
              All <span>{lineupJobs.length}</span>
            </button>
            <button className={lineupType === "material" ? "active material" : "material"} type="button" role="tab" aria-selected={lineupType === "material"} onClick={() => setLineupType("material")}>
              Material <span>{materialJobs.length}</span>
            </button>
            <button className={lineupType === "product" ? "active product" : "product"} type="button" role="tab" aria-selected={lineupType === "product"} onClick={() => setLineupType("product")}>
              Finished <span>{productJobs.length}</span>
            </button>
          </div>
        </div>
        {rollTagNotice && !selectedTag && <div className="coater-print-success"><CheckCircle2 size={16} /><span>{rollTagNotice}</span></div>}
        <div className="coater-lineup-result-count" aria-live="polite">
          Showing <strong>{visibleLineupJobs.length}</strong> of {lineupJobs.length} scheduled job{lineupJobs.length === 1 ? "" : "s"}
        </div>
        <div className="coater-unified-list" tabIndex="0" aria-label="Scheduled coater jobs">
          {visibleLineupJobs.map((item) => (
            <UnifiedJobCard
              item={item}
              key={`${item.kind}-${item.row.id}`}
              onSelect={() => {
                setRollTagNotice("");
                if (item.kind === "material") {
                  setSelectedProductId("");
                  setSelectedTagId(String(item.row.id));
                } else {
                  setSelectedTagId("");
                  setSelectedProductId(String(item.row.id));
                }
              }}
            />
          ))}
          {!visibleLineupJobs.length && (
            <div className="coater-lineup-empty">
              <Search size={22} />
              <strong>{lineupJobs.length ? "No matching jobs" : "No scheduled work"}</strong>
              <span>{lineupJobs.length ? "Try another search or show all work types." : "No material or finished-product jobs are scheduled for this press."}</span>
              {lineupJobs.length ? <button className="ghost-btn" type="button" onClick={() => { setLineupSearch(""); setLineupType("all"); }}>Clear filters</button> : null}
            </div>
          )}
        </div>
      </section>

      <MaterialJobDialog
        tag={selectedTag}
        rolls={selectedScheduleRolls}
        data={data}
        currentUser={currentUser}
        notice={rollTagNotice}
        creating={createRollMutation.isPending}
        createError={createRollMutation.error?.message}
        createdRollId={lastCreatedRollId}
        finishing={finishScheduleMutation.isPending}
        onClose={() => {
          setSelectedTagId("");
          setRollTagNotice("");
        }}
        onCreateRoll={(form) => {
          setRollTagNotice("");
          createRollMutation.mutate({ tag: selectedTag, form });
        }}
        onFinish={finishScheduleMutation.mutate}
        onOpenRoll={onLinkedRollTagChange}
        onDeleteRoll={canDeleteRoll ? setDeleteRollCandidate : undefined}
      />

      <ProductJobDialog
        row={selectedProduct}
        forms={productForms}
        setForms={setProductForms}
        updating={productMutation.isPending}
        onClose={() => setSelectedProductId("")}
        onStart={startProductJob}
        onComplete={completeProductJob}
      />

      <DeleteMaterialRollDialog
        roll={deleteRollCandidate}
        deleting={deleteRollMutation.isPending}
        error={apiErrorMessage(deleteRollMutation.error)}
        detail="This permanently removes the printed roll, its inventory record, usage history, and job assignment."
        onCancel={() => {
          if (!deleteRollMutation.isPending) {
            setDeleteRollCandidate(null);
            deleteRollMutation.reset();
          }
        }}
        onConfirm={() => deleteRollMutation.mutate(deleteRollCandidate)}
      />

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
