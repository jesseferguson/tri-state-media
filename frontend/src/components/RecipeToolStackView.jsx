import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Edit3 } from "lucide-react";
import { formatInches, getRecordTitle, groupBy, labelize } from "../lib/format";

const GOOD_STATUSES = new Set(["active", "available", "in_stock", "in_use"]);
const BAD_STATUSES = new Set(["inactive", "missing", "needs_repair", "ordered", "out_for_repair", "out_for_retool", "retired"]);

function normalize(value) {
  return String(value ?? "").trim().toLowerCase();
}

function title(value) {
  return labelize(value);
}

function getToolDetails(row) {
  return (
    row.flex_die_details ??
    row.mag_details ??
    row.perf_cylinder_details ??
    row.perf_blade_setup_details ??
    row.tool_details ??
    {}
  );
}

function getToolName(row) {
  const details = getToolDetails(row);
  return (
    row.tool_name ??
    row.flex_die_name ??
    row.mag_name ??
    row.perf_cylinder_name ??
    row.perf_blade_setup_name ??
    row.manual_description ??
    getRecordTitle(details)
  );
}

function getStatus(row) {
  const details = getToolDetails(row);
  const status = normalize(row.status ?? details.status);

  if (BAD_STATUSES.has(status)) return { tone: "bad", label: title(status) };
  if (GOOD_STATUSES.has(status)) return { tone: "ready", label: title(status) };
  if (row.is_required === false) return { tone: "neutral", label: "Optional" };
  if (row.tool_type === "manual_tooling") return { tone: "neutral", label: "Manual" };
  return { tone: "neutral", label: status ? title(status) : "Selected" };
}

function getSpecs(row) {
  const details = getToolDetails(row);

  if (row.tool_type === "flex_die") {
    return [
      ["Across", details.number_across ?? details.across],
      ["Around", details.number_around ?? details.around],
      ["Gear", details.gear],
      ["Width", formatInches(details.label_width_inches)],
      ["Repeat", formatInches(details.repeat_inches)],
    ];
  }

  if (row.tool_type === "mag") {
    return [
      ["Tooth", details.tooth_count],
      ["Repeat", formatInches(details.repeat_inches)],
      ["Face", formatInches(details.face_width_inches)],
      ["Press", details.press_name ?? row.press_name],
    ];
  }

  if (row.tool_type === "perf_cylinder") {
    return [
      ["Gear", details.gear_tooth_count],
      ["Width", formatInches(details.cylinder_width_inches)],
      ["Blades", details.max_blade_count],
      ["Location", details.current_location_name],
    ];
  }

  if (row.tool_type === "perf_blade_setup") {
    return [
      ["Cylinder", details.perf_cylinder_name],
      ["Blades", details.blade_count],
      ["Repeat", formatInches(details.standard_repeat_inches)],
      ["Offset", details.has_offset_blades ? "Yes" : "No"],
    ];
  }

  return [
    ["Type", title(row.tool_type)],
    ["Required", row.is_required === false ? "No" : "Yes"],
  ];
}

function StackRow({ row, selected, onSelect, onEdit }) {
  const status = getStatus(row);
  const details = getToolDetails(row);
  const location =
    details.current_location_name ??
    details.current_location_full_path ??
    row.current_location_name ??
    row.current_location_full_path ??
    "--";

  return (
    <article className={`tool-stack-row ${status.tone} ${selected ? "selected" : ""}`} onClick={() => onSelect(row)}>
      <div className="tool-stack-row-main">
        <div className="tool-stack-main-cell">
          <span>Tool</span>
          <strong>{getToolName(row)}</strong>
        </div>
        <div className="tool-stack-role-cell">
          <span>Role</span>
          <strong>{title(row.tool_role)}</strong>
        </div>
        <div className="tool-stack-role-cell">
          <span>Type</span>
          <strong>{title(row.tool_type)}</strong>
        </div>
        <div className="tool-stack-station-cell">
          <span>Station</span>
          <strong>{row.station_number ?? "--"}</strong>
        </div>
        <div className="tool-stack-status-cell">
          <span>Status</span>
          <strong className={`tool-stack-status ${status.tone}`}>{status.label}</strong>
        </div>
        <button
          className="tool-stack-edit"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            onEdit(row);
          }}
        >
          <Edit3 size={13} /> Edit
        </button>
      </div>
      <div className="tool-stack-flex-specs">
        {getSpecs(row).map(([label, value]) => (
          <div className="tool-stack-stat" key={label}>
            <em>{label}</em>
            <strong title={String(value ?? "--")}>{value ?? "--"}</strong>
          </div>
        ))}
      </div>
      <p className="tool-stack-location">{location}</p>
    </article>
  );
}

function PressGroup({ name, rows, selectedId, onSelect, onEdit }) {
  const [open, setOpen] = useState(true);
  const required = rows.filter((row) => row.is_required !== false).length;

  return (
    <section className="tool-stack-press">
      <button className="tool-stack-press-head" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="tool-stack-toggle">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
        <strong>{name}</strong>
        <span>{rows.length} tools</span>
        <span>{required} required</span>
      </button>
      {open && (
        <div className="tool-stack-row-list">
          {rows.map((row) => (
            <StackRow
              key={row.id}
              row={row}
              selected={selectedId === row.id}
              onSelect={onSelect}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function RecipeGroup({ name, rows, selectedId, onSelect, onEdit }) {
  const [open, setOpen] = useState(true);
  const byPress = useMemo(() => groupBy(rows, (row) => row.press_name ?? "No press"), [rows]);

  return (
    <section className="tool-stack-recipe">
      <button className="tool-stack-recipe-head" type="button" onClick={() => setOpen((value) => !value)}>
        <span className="tool-stack-toggle">{open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</span>
        <strong>{name}</strong>
        <span>{rows.length} assignments</span>
        <small>{Object.keys(byPress).length} presses</small>
      </button>
      {open && (
        <div className="tool-stack-press-list">
          {Object.entries(byPress).map(([pressName, list]) => (
            <PressGroup
              key={pressName}
              name={pressName}
              rows={list}
              selectedId={selectedId}
              onSelect={onSelect}
              onEdit={onEdit}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function RecipeToolStackView({ rows, selectedId, onSelect, onEdit }) {
  const byRecipe = useMemo(() => groupBy(rows ?? [], (row) => row.recipe_name ?? "No recipe"), [rows]);

  if (!rows?.length) return <p className="tool-stack-empty">No recipe tool assignments match this view.</p>;

  return (
    <div className="tool-stack-view">
      {Object.entries(byRecipe).map(([recipeName, list]) => (
        <RecipeGroup
          key={recipeName}
          name={recipeName}
          rows={list}
          selectedId={selectedId}
          onSelect={onSelect}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
}
