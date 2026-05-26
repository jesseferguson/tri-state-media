import { useEffect, useMemo, useState } from "react";
import { Edit3, MapPin, Save, X } from "lucide-react";
import { choiceLists } from "../resourceConfig";
import { formatInches, getRecordTitle, labelize } from "../lib/format";

function normalized(value) {
  return String(value ?? "").trim().toLowerCase().replaceAll(" ", "_").replaceAll("-", "_");
}

function valueText(value) {
  if (value === null || value === undefined || value === "") return "--";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? getRecordTitle(item) : item).join(", ") : "--";
  return String(value);
}

function pick(item, ...keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return "";
}

function inches(item, ...keys) {
  const value = pick(item, ...keys);
  return value === "" ? "" : formatInches(value);
}

function statusTone(status) {
  const value = normalized(status);
  if (["in_stock", "in_use", "available", "active"].includes(value)) return "ready";
  if (["ordered", "needs_ordered", "needs_repair", "out_for_retool", "out_for_repair", "missing", "inactive", "retired"].includes(value)) return "bad";
  return value ? "warn" : "neutral";
}

function statusLabel(status) {
  const match = (choiceLists.toolStatus ?? []).find(([value]) => String(value) === String(status));
  return match?.[1] ?? labelize(status) ?? "Selected";
}

function serials(item) {
  const list = Array.isArray(item?.serial_number_list) ? item.serial_number_list : String(item?.serial_numbers ?? "").split(/\r?\n/);
  return list.map((line) => String(line).trim()).filter(Boolean);
}

function detailRows(resourceKey, item) {
  if (resourceKey === "flex-dies") {
    return [
      ["Size", `${inches(item, "label_width_inches", "width")} x ${inches(item, "label_length_inches", "length")}`],
      ["Repeat", inches(item, "repeat_inches", "repeat")],
      ["Around", pick(item, "number_around", "around")],
      ["Gear", pick(item, "gear", "tooth_count") ? `${pick(item, "gear", "tooth_count")}T` : ""],
      ["Web", inches(item, "web_width_inches", "web_width")],
      ["Gap Across", inches(item, "gap_across_inches", "gap_across")],
      ["Face", labelize(pick(item, "face_type"))],
      ["Liner", labelize(pick(item, "liner_type"))],
      ["Cut", labelize(pick(item, "cutting_type"))],
      ["Location", pick(item, "current_location_full_path", "location", "current_location_name", "location_name")],
      ["Original Serial", pick(item, "original_serial_number")],
      ["Active / Target", `${pick(item, "active_die_count") || 0} / ${pick(item, "target_die_count") || 0}`],
    ];
  }

  if (resourceKey === "mags") {
    return [
      ["Tooth", pick(item, "tooth_count") ? `${pick(item, "tooth_count")}T` : ""],
      ["Repeat", inches(item, "repeat_inches", "repeat")],
      ["Face Width", inches(item, "face_width_inches", "face_width")],
      ["Location", pick(item, "current_location_full_path", "location", "current_location_name", "location_name")],
      ["Supplier", pick(item, "supplier_name")],
      ["Compatible Presses", pick(item, "compatible_press_names", "press_name")],
      ["Notes", pick(item, "notes")],
    ];
  }

  if (resourceKey === "perf-cylinders") {
    return [
      ["Gear Tooth", pick(item, "gear_tooth_count", "gear") ? `${pick(item, "gear_tooth_count", "gear")}T` : ""],
      ["Cylinder Width", inches(item, "cylinder_width_inches", "width")],
      ["Max Blades", pick(item, "max_blade_count", "max_blades")],
      ["Location", pick(item, "current_location_full_path", "location", "current_location_name", "location_name")],
      ["Supplier", pick(item, "supplier_name")],
      ["Compatible Presses", pick(item, "compatible_press_names", "press_name")],
      ["Notes", pick(item, "notes")],
    ];
  }

  return [
    ["Perf Cylinder", pick(item, "perf_cylinder_name", "perf_cylinder")],
    ["Blade Count", pick(item, "blade_count")],
    ["Repeat", inches(item, "standard_repeat_inches", "repeat")],
    ["Offset Blades", pick(item, "has_offset_blades")],
    ["Active", pick(item, "is_active")],
    ["Notes", pick(item, "notes")],
  ];
}

function primaryMetric(resourceKey, item) {
  if (resourceKey === "flex-dies") return { label: "Across", value: pick(item, "number_across", "across") || "--", suffix: "wide" };
  if (resourceKey === "mags") return { label: "Tooth", value: pick(item, "tooth_count") || "--", suffix: "T" };
  if (resourceKey === "perf-cylinders") return { label: "Gear", value: pick(item, "gear_tooth_count", "gear") || "--", suffix: "T" };
  return { label: "Blades", value: pick(item, "blade_count") || "--", suffix: "" };
}

export default function ToolingItemDetailPanel({
  item,
  resourceKey,
  assignment,
  onClose,
  onEdit,
  onEditAssignment,
  onUpdateStatus,
  updating = false,
}) {
  const hasStatus = item && Object.prototype.hasOwnProperty.call(item, "status");
  const hasActive = !hasStatus && item && Object.prototype.hasOwnProperty.call(item, "is_active");
  const [statusValue, setStatusValue] = useState(item?.status ?? "");
  const [activeValue, setActiveValue] = useState(item?.is_active !== false);
  const [error, setError] = useState("");
  const metric = primaryMetric(resourceKey, item ?? {});
  const rows = useMemo(() => detailRows(resourceKey, item ?? {}).filter(([, value]) => value !== "" && value !== null && value !== undefined), [resourceKey, item]);
  const serialList = serials(item);
  const tone = statusTone(hasStatus ? statusValue : activeValue ? "active" : "inactive");

  useEffect(() => {
    setStatusValue(item?.status ?? "");
    setActiveValue(item?.is_active !== false);
    setError("");
  }, [item?.id, item?.status, item?.is_active]);

  async function saveStatus(event) {
    event.preventDefault();
    if (!onUpdateStatus) return;
    setError("");
    try {
      const payload = hasStatus ? { status: statusValue } : { is_active: activeValue };
      await onUpdateStatus(payload);
    } catch (err) {
      setError(err.message || "Could not update status.");
    }
  }

  if (!item) return null;

  return (
    <section className={`tooling-item-detail-panel ${resourceKey || ""}`}>
      <header className="tooling-item-detail-head">
        <div>
          <p className="eyebrow">{labelize(resourceKey)}</p>
          <h3>{getRecordTitle(item)}</h3>
          <span className={`tooling-item-status ${tone}`}>{hasStatus ? statusLabel(statusValue) : activeValue ? "Active" : "Inactive"}</span>
        </div>
        {onClose && <button className="ghost-btn xs" type="button" onClick={onClose}><X size={14} /> Close</button>}
      </header>

      <div className="tooling-item-hero">
        <div className={`tooling-primary-metric ${resourceKey === "flex-dies" ? "across" : ""}`}>
          <span>{metric.label}</span>
          <strong>{metric.value}</strong>
          {metric.suffix && <em>{metric.suffix}</em>}
        </div>
        <div className="tooling-item-location">
          <MapPin size={15} />
          <span>{pick(item, "current_location_full_path", "location", "current_location_name", "location_name") || "No location set"}</span>
        </div>
      </div>

      {(hasStatus || hasActive) && (
        <form className="tooling-status-form" onSubmit={saveStatus}>
          <label>
            <span>{hasStatus ? "Status" : "Active"}</span>
            {hasStatus ? (
              <select value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>
                {(choiceLists.toolStatus ?? []).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            ) : (
              <select value={activeValue ? "true" : "false"} onChange={(event) => setActiveValue(event.target.value === "true")}>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            )}
          </label>
          <button className="primary-btn xs" type="submit" disabled={updating}>
            <Save size={13} /> {updating ? "Saving..." : "Save"}
          </button>
        </form>
      )}

      <div className="tooling-readable-grid">
        {rows.map(([label, value]) => (
          <div key={label}>
            <span>{label}</span>
            <strong>{valueText(value)}</strong>
          </div>
        ))}
      </div>

      {assignment && (
        <section className="tooling-assignment-summary">
          <strong>Used On This Setup</strong>
          <div>
            <span>{[assignment.recipe_name, assignment.press_name].filter(Boolean).join(" / ") || "Press setup assignment"}</span>
            <em>{[labelize(assignment.tool_role), assignment.station_number ? `Station ${assignment.station_number}` : "", assignment.is_required === false ? "Optional" : "Required"].filter(Boolean).join(" / ")}</em>
          </div>
        </section>
      )}

      {serialList.length > 0 && (
        <section className="tooling-serial-strip">
          <strong>Serial Numbers</strong>
          <div>{serialList.map((serial) => <span key={serial}>{serial}</span>)}</div>
        </section>
      )}

      <div className="tooling-item-actions">
        {onEdit && <button className="primary-btn" type="button" onClick={() => onEdit(item)}><Edit3 size={14} /> Edit Tool</button>}
        {onEditAssignment && <button className="ghost-btn" type="button" onClick={() => onEditAssignment(assignment)}><Edit3 size={14} /> Edit Assignment</button>}
      </div>

      {error && <p className="tooling-item-error">{error}</p>}
    </section>
  );
}
