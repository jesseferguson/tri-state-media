import { Fragment, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Edit3, Plus, Trash2, Wrench } from "lucide-react";
import { choiceLists } from "../resourceConfig";
import { formatInches, getRecordTitle, labelize } from "../lib/format";

const GOOD_STATUSES = new Set(["active", "available", "in_stock", "in_use"]);
const BAD_STATUSES = new Set(["inactive", "missing", "needs_ordered", "needs_repair", "ordered", "out_for_repair", "out_for_retool", "out_of_stock", "retired"]);

const choiceLookup = Object.fromEntries(
  ["faceType", "linerType", "shapeType", "layoutShapeType", "cuttingType", "labelCutType", "toolRole", "toolType", "toolStatus"].flatMap((listKey) =>
    (choiceLists[listKey] ?? []).map(([value, label]) => [`${listKey}:${value}`, label])
  )
);

function normalized(value) {
  return String(value ?? "").trim().toLowerCase();
}

function groupKey(value) {
  return normalized(value) || "unspecified";
}

function choiceLabel(listKey, value, fallback = "Unspecified") {
  if (value === null || value === undefined || value === "") return fallback;
  return choiceLookup[`${listKey}:${value}`] ?? labelize(value);
}

function sizeText(value) {
  return formatInches(value).replace(/"$/g, "");
}

function layoutGroupLabel(row) {
  return [
    choiceLabel("faceType", row.face_type, "No Face"),
    choiceLabel("linerType", row.liner_type, "No Liner"),
    sizeText(row.label_width_inches),
    sizeText(row.repeat_inches),
  ].join(" - ");
}

function layoutGroupKey(row) {
  return [
    groupKey(row.face_type),
    groupKey(row.liner_type),
    row.label_width_inches ?? "",
    row.repeat_inches ?? "",
  ].join("|");
}

function buildGroups(rows, optionsByRecipe) {
  const groups = new Map();

  (rows ?? []).forEach((row) => {
    const key = layoutGroupKey(row);
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        label: layoutGroupLabel(row),
        rows: [],
        optionCount: 0,
      });
    }
    const group = groups.get(key);
    group.rows.push(row);
    group.optionCount += (optionsByRecipe.get(String(row.id)) ?? []).length;
  });

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      rows: [...group.rows].sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { numeric: true })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
}

function perfText(row) {
  const external = row.perf_option === "perf"
    ? `External ${row.tpi ? `${row.tpi} TPI` : "Perf"}`
    : "No External Perf";
  const internal = row.internal_perf_option === "perf"
    ? `Internal ${row.internal_perf_tpi ? `${row.internal_perf_tpi} TPI` : "Perf"}`
    : "";
  return [external, internal].filter(Boolean).join(" / ");
}

function toolDetails(tool) {
  return tool?.tool_details ?? tool?.flex_die_details ?? tool?.mag_details ?? tool?.perf_cylinder_details ?? tool?.perf_blade_setup_details ?? {};
}

function toolType(tool) {
  return String(tool?.tool_type ?? toolDetails(tool).type ?? "").trim();
}

function toolTypeKey(tool) {
  return normalized(toolType(tool)).replaceAll(" ", "_").replaceAll("-", "_");
}

function toolRoleKey(tool) {
  return normalized(tool?.tool_role ?? tool?.role ?? "top").replaceAll(" ", "_").replaceAll("-", "_");
}

function toothText(tool) {
  const details = toolDetails(tool);
  const value = details.tooth_count ?? details.gear ?? details.gear_tooth_count ?? tool?.tooth_count ?? tool?.gear;
  return value || value === 0 ? `${value}T` : "";
}

function toolName(tool) {
  const details = toolDetails(tool);
  return (
    tool?.tool_name ??
    tool?.mag_name ??
    tool?.flex_die_name ??
    tool?.perf_cylinder_name ??
    tool?.perf_blade_setup_name ??
    details.name ??
    tool?.manual_description ??
    getRecordTitle(details) ??
    "Selected tool"
  );
}

function toolMeta(tool) {
  const details = toolDetails(tool);
  const type = toolTypeKey(tool);
  if (type.includes("mag")) return "";
  if (type.includes("flex_die")) {
    return [
      choiceLabel("faceType", details.face_type, ""),
      toothText(tool),
    ].filter(Boolean).join(" / ");
  }
  if (type.includes("perf_cylinder")) return [details.gear ? `${details.gear}T` : "", details.max_blades ? `${details.max_blades} blades` : ""].filter(Boolean).join(" / ");
  if (type.includes("perf_blade_setup")) return [details.perf_cylinder, details.blade_count ? `${details.blade_count} blades` : ""].filter(Boolean).join(" / ");
  return tool?.manual_description || "";
}

function toolStatusValue(tool) {
  const details = toolDetails(tool);
  return normalized(details.status ?? tool?.status);
}

function toolStateText(tool) {
  const status = toolStatusValue(tool);
  if (status) return choiceLabel("toolStatus", status, labelize(status));
  const details = toolDetails(tool);
  if (details.is_active === false || tool?.is_active === false) return "Inactive";
  if (details.is_active === true || tool?.is_active === true) return "Active";
  return "Selected";
}

function toolStatus(tool) {
  const details = toolDetails(tool);
  const status = toolStatusValue(tool);
  if (BAD_STATUSES.has(status)) return "bad";
  if (GOOD_STATUSES.has(status) || details.is_active === true || tool?.is_active === true) return "ready";
  if (tool?.is_required === false) return "neutral";
  return status ? "neutral" : "ready";
}

function optionTools(option, toolRows, nestedTools) {
  const fullRows = (toolRows ?? []).filter((tool) => String(tool.recipe_option) === String(option.id));
  if (fullRows.length) return fullRows;
  return nestedTools ?? option.tools ?? option.recipe_tools ?? [];
}

function isMagTool(tool) {
  const type = toolTypeKey(tool);
  const detailType = normalized(toolDetails(tool).type);
  return (type.includes("mag") || detailType === "mag") && !type.includes("perf");
}

function isFlexDieTool(tool) {
  const type = toolTypeKey(tool);
  const detailType = normalized(toolDetails(tool).type);
  return type.includes("flex_die") || detailType === "flex die";
}

function isPerfTool(tool) {
  const type = toolTypeKey(tool);
  const detailType = normalized(toolDetails(tool).type);
  return type.includes("perf") || detailType.includes("perf");
}

function isMainTool(tool) {
  const role = toolRoleKey(tool);
  return role !== "undercut" && role !== "perf" && role !== "other";
}

function isUndercutTool(tool) {
  return toolRoleKey(tool) === "undercut";
}

function isPerfRoleTool(tool) {
  return toolRoleKey(tool) === "perf" || isPerfTool(tool);
}

function sortedTools(tools) {
  return [...(tools ?? [])].sort((a, b) => {
    const aStation = Number(a.station_number ?? 9999);
    const bStation = Number(b.station_number ?? 9999);
    return aStation - bStation || Number(a.id ?? 0) - Number(b.id ?? 0);
  });
}

function recipeNeedsPerf(recipe, option) {
  const source = recipe ?? option?.recipe_details ?? {};
  return (
    source.requires_perf === true ||
    source.requires_external_perf === true ||
    source.requires_internal_perf === true ||
    normalized(source.perf_option ?? option?.perf_option) === "perf" ||
    normalized(source.internal_perf_option ?? option?.internal_perf_option) === "perf"
  );
}

function optionNeedsUndercut(option, tools) {
  return option?.requires_undercut === true || normalized(option?.setup_type) === "undercut" || (tools ?? []).some(isUndercutTool);
}

function buildToolSlots(recipe, option, tools) {
  const assigned = sortedTools(tools);
  const mags = assigned.filter(isMagTool);
  const dies = assigned.filter(isFlexDieTool);
  const perfTools = assigned.filter(isPerfRoleTool);

  const needsUndercut = optionNeedsUndercut(option, assigned);
  const needsPerf = recipeNeedsPerf(recipe, option) || perfTools.length > 0;
  const mainMags = mags.filter(isMainTool);
  const mainDies = dies.filter(isMainTool);
  const undercutMags = mags.filter(isUndercutTool);
  const undercutDies = dies.filter(isUndercutTool);

  const mag1 = mainMags[0] ?? (!needsUndercut ? mags[0] : mags.find((tool) => !isUndercutTool(tool))) ?? null;
  const die1 = mainDies[0] ?? (!needsUndercut ? dies[0] : dies.find((tool) => !isUndercutTool(tool))) ?? null;
  const mag2 = needsUndercut ? (undercutMags[0] ?? mags.find((tool) => tool !== mag1) ?? null) : null;
  const die2 = needsUndercut ? (undercutDies[0] ?? dies.find((tool) => tool !== die1) ?? null) : null;
  const perf = needsPerf ? (perfTools[0] ?? null) : null;

  const slots = [
    { key: "mag1", label: "MAG1", missing: "Mag missing", requestGroup: "MAG1", tool: mag1 },
    { key: "die1", label: "Die1", missing: "Flex die missing", requestGroup: "DIE1", tool: die1 },
  ];

  if (needsUndercut) {
    slots.push(
      { key: "mag2", label: "MAG2", missing: "Undercut mag missing", requestGroup: "MAG2", tool: mag2 },
      { key: "die2", label: "Die2", missing: "Undercut die missing", requestGroup: "DIE2", tool: die2 }
    );
  }

  if (needsPerf) {
    slots.push({ key: "perf", label: "Perf", missing: "Perf tooling missing", requestGroup: "PERF", tool: perf });
  }

  return { slots, needsUndercut, needsPerf };
}

function optionReadiness(recipe, option, tools) {
  const problems = [];
  let blocking = false;
  if (option.is_active === false) problems.push("Setup inactive");
  if (option.is_approved === false) problems.push("Setup not approved");
  if (option.can_run === false) problems.push("Press cannot run this setup");
  if (!tools.length) {
    problems.push("No tooling assigned");
    blocking = true;
  }
  if (option.is_active === false || option.is_approved === false || option.can_run === false) blocking = true;

  const toolPlan = buildToolSlots(recipe, option, tools);
  const mainMag = toolPlan.slots.find((slot) => slot.key === "mag1");
  const mainDie = toolPlan.slots.find((slot) => slot.key === "die1");
  const undercutMag = toolPlan.slots.find((slot) => slot.key === "mag2");
  const undercutDie = toolPlan.slots.find((slot) => slot.key === "die2");
  const perf = toolPlan.slots.find((slot) => slot.key === "perf");

  const requiredSlots = [
    mainMag,
    mainDie,
    toolPlan.needsUndercut ? undercutMag : null,
    toolPlan.needsUndercut ? undercutDie : null,
    toolPlan.needsPerf ? perf : null,
  ].filter(Boolean);

  requiredSlots.forEach((slot) => {
    if (!slot.tool) {
      problems.push(slot.missing);
      blocking = true;
      return;
    }

    const status = toolStatus(slot.tool);
    if (status === "bad") {
      problems.push(`${toolName(slot.tool)} is ${toolStateText(slot.tool)}`);
      blocking = true;
    } else if (status === "neutral") {
      problems.push(`${toolName(slot.tool)} status is ${toolStateText(slot.tool)}`);
    }
  });

  if (problems.length) return { tone: blocking ? "bad" : "warn", label: blocking ? "Not Ready" : problems[0], problems };
  return { tone: "ready", label: "Ready", problems };
}

function dieAcrossText(tool) {
  const details = toolDetails(tool);
  const across = details.across ?? details.number_across;
  return across || across === 0 ? `${across} across` : "";
}

function ChainToolCard({ slot, option, onAddTooling, onEdit, onDelete }) {
  if (!slot.tool) {
    return (
      <button type="button" className="layout-chain-card missing" onClick={() => onAddTooling(option, slot.requestGroup)}>
        <strong>{slot.missing}</strong>
        <em><Plus size={11} /> Add</em>
      </button>
    );
  }

  const status = toolStatus(slot.tool);
  const meta = toolMeta(slot.tool);
  const dieAcross = isFlexDieTool(slot.tool) ? dieAcrossText(slot.tool) : "";

  return (
    <div className={`layout-chain-card ${status}`}>
      <div>
        <strong>{toolName(slot.tool)}</strong>
        {dieAcross && <em className="layout-die-across">{dieAcross}</em>}
        {meta && <small className="layout-chain-meta">{meta}</small>}
        <small className={`layout-chain-state ${status}`}>{toolStateText(slot.tool)}</small>
      </div>
      <div className="layout-tool-actions">
        <button type="button" onClick={() => onEdit(slot.tool)}><Edit3 size={12} /> Edit</button>
        <button type="button" className="danger-text" onClick={() => onDelete(slot.tool)}><Trash2 size={12} /> Delete</button>
      </div>
    </div>
  );
}

function perfSummary(recipe, option, plan) {
  return plan.needsPerf || recipeNeedsPerf(recipe, option) ? "Perf" : "No Perf";
}

function PressOptionCard({ recipe, option, toolRows, onEditPressOption, onDeletePressOption, onAddTooling, onEditTooling, onDeleteTooling }) {
  const [open, setOpen] = useState(false);
  const tools = optionTools(option, toolRows, option.tools);
  const readiness = optionReadiness(recipe, option, tools);
  const plan = buildToolSlots(recipe, option, tools);
  const { slots } = plan;
  const perfLabel = perfSummary(recipe, option, plan);

  return (
    <article className={`layout-press-card ${readiness.tone} ${open ? "open" : ""}`}>
      <header className="layout-press-head">
        <button type="button" className="layout-press-title-button" onClick={() => setOpen((value) => !value)}>
          {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
          <div>
            <strong>{option.press_name || "No press"}</strong>
            <span>{option.name || "Auto setup name"}</span>
          </div>
        </button>
        <span className={`layout-perf-pill ${perfLabel === "Perf" ? "perf" : "none"}`}>{perfLabel}</span>
        <span className={`layout-ready-pill ${readiness.tone}`}>
          {readiness.tone === "ready" ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
          {readiness.label}
        </span>
        <div className="layout-inline-actions">
          <button type="button" onClick={() => onEditPressOption(option)}><Edit3 size={12} /> Edit</button>
          <button type="button" onClick={() => onAddTooling(option)}><Wrench size={12} /> Add Tooling</button>
          <button type="button" className="danger-text" onClick={() => onDeletePressOption(option)}><Trash2 size={12} /> Delete</button>
        </div>
      </header>

      {open && readiness.problems.length > 0 && (
        <div className="layout-helper-line">
          {readiness.problems.slice(0, 4).map((problem) => <span key={problem}>{problem}</span>)}
        </div>
      )}

      {open && (
        <div className="layout-tool-chain">
          {slots.map((slot, index) => (
            <Fragment key={slot.key}>
              {index > 0 && <span className="layout-chain-arrow">-&gt;</span>}
              <ChainToolCard
                slot={slot}
                option={option}
                onAddTooling={onAddTooling}
                onEdit={onEditTooling}
                onDelete={onDeleteTooling}
              />
            </Fragment>
          ))}
        </div>
      )}
    </article>
  );
}

function LayoutCard({
  row,
  options,
  toolRows,
  selected,
  onSelect,
  onEdit,
  onDelete,
  onAddPressOption,
  onEditPressOption,
  onDeletePressOption,
  onAddTooling,
  onEditTooling,
  onDeleteTooling,
}) {
  return (
    <article className={`layout-design-card ${selected ? "selected" : ""} ${row.is_active === false ? "inactive" : ""}`} onClick={() => onSelect(row)}>
      <header className="layout-design-head">
        <div>
          <strong>{row.name || "Unnamed label layout"}</strong>
          <span>{perfText(row)}</span>
        </div>
        <div className="layout-design-metrics">
          <span>{formatInches(row.label_width_inches)} x {formatInches(row.label_length_inches)}</span>
          <span>Repeat {formatInches(row.repeat_inches)}</span>
          <span>{choiceLabel("layoutShapeType", row.shape_type, "Shape")} / {choiceLabel("labelCutType", row.cutting_type, "Cut")}</span>
        </div>
        <div className="layout-inline-actions" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => onEdit(row)}><Edit3 size={12} /> Edit</button>
          <button type="button" onClick={() => onAddPressOption(row)}><Plus size={12} /> Add Press Option</button>
          <button type="button" className="danger-text" onClick={() => onDelete(row)}><Trash2 size={12} /> Delete</button>
        </div>
      </header>

      <div className="layout-press-section" onClick={(event) => event.stopPropagation()}>
        {options.length ? (
          <div className="layout-press-list">
            {options.map((option) => (
              <PressOptionCard
                key={option.id}
                recipe={row}
                option={option}
                toolRows={toolRows}
                onEditPressOption={onEditPressOption}
                onDeletePressOption={onDeletePressOption}
                onAddTooling={onAddTooling}
                onEditTooling={onEditTooling}
                onDeleteTooling={onDeleteTooling}
              />
            ))}
          </div>
        ) : (
          <div className="layout-no-options">
            <span>No press setup options yet.</span>
            <button type="button" onClick={() => onAddPressOption(row)}><Plus size={12} /> Add Press Option</button>
          </div>
        )}
      </div>
    </article>
  );
}

function LayoutGroup({
  group,
  optionsByRecipe,
  toolRows,
  selectedId,
  openKeys,
  toggleOpen,
  actions,
}) {
  const open = openKeys.has(group.key);

  return (
    <section className="layout-group combined">
      <button type="button" className="layout-group-head combined" onClick={() => toggleOpen(group.key)}>
        <span className="layout-group-toggle">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
        <span className="layout-group-title">
          <em>Face - Liner - Width - Repeat</em>
          <strong>{group.label}</strong>
        </span>
        <span className="layout-group-count">{group.rows.length} layout{group.rows.length === 1 ? "" : "s"} / {group.optionCount} setup{group.optionCount === 1 ? "" : "s"}</span>
      </button>

      {open && (
        <div className="layout-group-body combined">
          {group.rows.map((row) => (
            <LayoutCard
              key={row.id}
              row={row}
              options={optionsByRecipe.get(String(row.id)) ?? []}
              toolRows={toolRows}
              selected={selectedId === row.id}
              {...actions}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function LabelLayoutsView({
  rows,
  recipeOptions = [],
  recipeTools = [],
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onAddPressOption,
  onEditPressOption,
  onDeletePressOption,
  onAddTooling,
  onEditTooling,
  onDeleteTooling,
}) {
  const [openKeys, setOpenKeys] = useState(() => new Set());

  const optionsByRecipe = useMemo(() => {
    const map = new Map();
    (recipeOptions ?? []).forEach((option) => {
      const recipeId = String(option.recipe ?? option.recipe_details?.id ?? "");
      if (!recipeId) return;
      if (!map.has(recipeId)) map.set(recipeId, []);
      map.get(recipeId).push(option);
    });
    map.forEach((list) => list.sort((a, b) => String(a.press_name ?? "").localeCompare(String(b.press_name ?? ""), undefined, { numeric: true })));
    return map;
  }, [recipeOptions]);

  const groups = useMemo(() => buildGroups(rows ?? [], optionsByRecipe), [rows, optionsByRecipe]);

  function toggleOpen(id) {
    setOpenKeys((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!rows?.length) return <p className="label-layout-empty">No label layouts match this view.</p>;

  return (
    <div className="label-layout-view tooling-hub-view">
      {groups.map((group) => (
        <LayoutGroup
          key={group.key}
          group={group}
          optionsByRecipe={optionsByRecipe}
          toolRows={recipeTools}
          selectedId={selectedId}
          openKeys={openKeys}
          toggleOpen={toggleOpen}
          actions={{
            onSelect,
            onEdit,
            onDelete,
            onAddPressOption,
            onEditPressOption,
            onDeletePressOption,
            onAddTooling,
            onEditTooling,
            onDeleteTooling,
          }}
        />
      ))}
    </div>
  );
}
