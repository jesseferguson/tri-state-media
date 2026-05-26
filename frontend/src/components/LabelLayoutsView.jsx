import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Edit3, Plus, Trash2, Wrench } from "lucide-react";
import { choiceLists } from "../resourceConfig";
import { formatInches, getRecordTitle, labelize } from "../lib/format";

const GOOD_STATUSES = new Set(["active", "available", "in_stock", "in_use"]);
const BAD_STATUSES = new Set(["inactive", "missing", "needs_repair", "ordered", "out_for_repair", "out_for_retool", "retired"]);

const choiceLookup = Object.fromEntries(
  ["faceType", "linerType", "shapeType", "layoutShapeType", "cuttingType", "labelCutType", "toolRole", "toolType"].flatMap((listKey) =>
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
  if (type.includes("mag")) return [details.tooth_count ? `${details.tooth_count}T` : "", details.repeat ? `Repeat ${formatInches(details.repeat)}` : ""].filter(Boolean).join(" / ");
  if (type.includes("flex_die")) return [details.gear ? `${details.gear}T` : "", details.across && details.around ? `${details.across} x ${details.around}` : ""].filter(Boolean).join(" / ");
  if (type.includes("perf_cylinder")) return [details.gear ? `${details.gear}T` : "", details.max_blades ? `${details.max_blades} blades` : ""].filter(Boolean).join(" / ");
  if (type.includes("perf_blade_setup")) return [details.perf_cylinder, details.blade_count ? `${details.blade_count} blades` : ""].filter(Boolean).join(" / ");
  return tool?.manual_description || "";
}

function toolStatus(tool) {
  const details = toolDetails(tool);
  const status = normalized(details.status ?? tool?.status);
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

function toolsByRows(tools) {
  return [
    ["MAG", tools.filter((tool) => toolTypeKey(tool).includes("mag") && !toolTypeKey(tool).includes("perf"))],
    ["DIE", tools.filter((tool) => toolTypeKey(tool).includes("flex_die"))],
    ["PERF", tools.filter((tool) => toolTypeKey(tool).includes("perf"))],
    ["OTHER", tools.filter((tool) => ["manual_tooling", "other"].includes(toolTypeKey(tool)) || (!toolTypeKey(tool).includes("mag") && !toolTypeKey(tool).includes("flex_die") && !toolTypeKey(tool).includes("perf")))],
  ];
}

function optionReadiness(recipe, option, tools) {
  const problems = [];
  if (option.is_active === false) problems.push("Setup inactive");
  if (option.is_approved === false) problems.push("Setup not approved");
  if (option.can_run === false) problems.push("Press cannot run this setup");
  if (!tools.length) problems.push("No tooling assigned");

  const typeKeys = tools.map(toolTypeKey);
  const hasMag = typeKeys.some((type) => type.includes("mag") && !type.includes("perf"));
  const hasDie = typeKeys.some((type) => type.includes("flex_die"));
  const hasPerf = typeKeys.some((type) => type.includes("perf"));

  if (!hasMag) problems.push("Mag missing");
  if (!hasDie) problems.push("Flex die missing");
  if (recipe?.requires_external_perf && !hasPerf) problems.push("External perf tooling missing");

  if (problems.length) return { tone: option.can_run === false ? "bad" : "warn", label: problems[0], problems };
  return { tone: "ready", label: "Ready", problems };
}

function ToolChip({ tool, onEdit, onDelete }) {
  const status = toolStatus(tool);
  const type = choiceLabel("toolType", tool?.tool_type ?? toolTypeKey(tool), "Tool");

  return (
    <div className={`layout-tool-chip ${status}`}>
      <div>
        <span>{type}</span>
        <strong>{toolName(tool)}</strong>
        <em>{toolMeta(tool) || "Assigned"}</em>
      </div>
      <div className="layout-tool-actions">
        <button type="button" onClick={() => onEdit(tool)}><Edit3 size={12} /> Edit</button>
        <button type="button" className="danger-text" onClick={() => onDelete(tool)}><Trash2 size={12} /> Delete</button>
      </div>
    </div>
  );
}

function PressOptionCard({ recipe, option, toolRows, onEditPressOption, onDeletePressOption, onAddTooling, onEditTooling, onDeleteTooling }) {
  const tools = optionTools(option, toolRows, option.tools);
  const readiness = optionReadiness(recipe, option, tools);
  const toolRowsByType = toolsByRows(tools);

  return (
    <article className={`layout-press-card ${readiness.tone}`}>
      <header className="layout-press-head">
        <div>
          <span>{option.press_name || "No press"}</span>
          <strong>{option.name || "Auto setup name"}</strong>
        </div>
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

      {readiness.problems.length > 0 && (
        <div className="layout-helper-line">
          {readiness.problems.slice(0, 4).map((problem) => <span key={problem}>{problem}</span>)}
        </div>
      )}

      <div className="layout-tool-table">
        {toolRowsByType.map(([label, list]) => (
          <div className="layout-tool-table-row" key={label}>
            <strong>{label}</strong>
            <div>
              {list.length ? (
                list.map((tool) => (
                  <ToolChip
                    key={`${label}-${tool.id}-${tool.tool_type}`}
                    tool={tool}
                    onEdit={onEditTooling}
                    onDelete={onDeleteTooling}
                  />
                ))
              ) : (
                <button type="button" className="layout-empty-tool" onClick={() => onAddTooling(option, label)}>
                  <Plus size={12} /> Add {label.toLowerCase()}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
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

      <div className="layout-press-list" onClick={(event) => event.stopPropagation()}>
        {options.length ? (
          options.map((option) => (
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
          ))
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
