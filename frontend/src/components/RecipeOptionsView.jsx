import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Edit3, X } from "lucide-react";
import { getRecordTitle, groupBy, labelize } from "../lib/format";

const GOOD_STATUSES = new Set(["in_stock", "in_use", "available", "active"]);

const BAD_STATUSES = new Set(["ordered", "needs_repair", "out_for_retool", "out_for_repair", "retired", "missing", "inactive"]);

function norm(value) {
  return String(value ?? "").trim().toLowerCase();
}

function key(value) {
  return norm(value).replaceAll(" ", "_").replaceAll("-", "_");
}

function title(value) {
  const text = String(value ?? "").replaceAll("_", " ").replaceAll("-", " ").trim();
  if (!text) return "--";
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

function uniq(values) {
  return [...new Set(values.filter(Boolean))];
}

function tools(option) {
  return option.tools ?? option.recipe_tools ?? option.tool_assignments ?? [];
}

function details(tool) {
  return tool?.tool_details ?? tool?.flex_die_details ?? tool?.mag_details ?? tool?.perf_cylinder_details ?? tool?.perf_blade_setup_details ?? {};
}

function toolType(tool) {
  const d = details(tool);
  return key(tool?.tool_type ?? d.type ?? "");
}

function toolRole(tool) {
  return key(tool?.tool_role ?? tool?.role ?? "top");
}

function isRequired(tool) {
  return tool?.is_required !== false;
}

function isFlexDie(tool) {
  const type = toolType(tool);
  return type.includes("flex_die") || norm(details(tool).type) === "flex die";
}

function isMag(tool) {
  const type = toolType(tool);
  return type.includes("mag") || norm(details(tool).type) === "mag";
}

function isPerfTool(tool) {
  const type = toolType(tool);
  const label = norm(details(tool).type);
  return type.includes("perf_cylinder") || type.includes("perf_blade_setup") || label.includes("perf cylinder") || label.includes("perf blade");
}

function isTopTool(tool) {
  const role = toolRole(tool);
  return role !== "undercut" && role !== "perf" && role !== "other";
}

function isUndercutTool(tool) {
  return toolRole(tool) === "undercut";
}

function isPerfRoleTool(tool) {
  return toolRole(tool) === "perf" || isPerfTool(tool);
}

function toolName(tool) {
  const d = details(tool);
  return tool?.tool_name ?? getRecordTitle(d) ?? tool?.manual_description ?? d.name ?? "--";
}

function toolStatus(tool) {
  const d = details(tool);
  if (!tool) return "missing";
  if (d.status ?? tool.status) return key(d.status ?? tool.status);
  if (d.is_active === true || tool.is_active === true) return "active";
  if (d.is_active === false || tool.is_active === false) return "inactive";
  return "";
}

function canUseTool(tool) {
  if (!tool) return false;
  const status = toolStatus(tool);
  if (BAD_STATUSES.has(status)) return false;
  if (GOOD_STATUSES.has(status)) return true;
  // Some records, especially perf blade setups, may only come through as selected tooling without a status.
  return status === "" && toolType(tool) === "perf_blade_setup";
}

function statusText(tool) {
  if (!tool) return "Missing";
  const status = toolStatus(tool);
  return status ? title(status) : "Selected";
}

function tooth(tool) {
  const d = details(tool);
  const value = d.tooth_count ?? d.gear ?? d.gear_tooth_count ?? d.cylinder_teeth ?? tool?.tooth_count ?? tool?.gear;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function cleanPath(value) {
  return String(value ?? "").trim().replaceAll(" > ", "/").replaceAll(" / ", "/").replace(/\/+$/g, "");
}

function parentPath(value) {
  const text = cleanPath(value);
  if (!text || text === "--") return null;
  const parts = text.split("/").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return text;
  return parts.slice(0, -1).join("/");
}

function locationText(tool) {
  const d = details(tool);
  return d.location ?? d.current_location_full_path ?? d.current_location_name ?? d.location_full_path ?? d.location_name ?? "--";
}

function locationParentText(tool) {
  const d = details(tool);
  return (
    d.parent_location_full_path ??
    d.location_parent_full_path ??
    d.current_location_parent_full_path ??
    d.parent_location_name ??
    d.location_parent_name ??
    d.current_location_parent_name ??
    parentPath(locationText(tool)) ??
    "--"
  );
}

function locationParentKey(tool) {
  const text = locationParentText(tool);
  if (!text || text === "--") return null;
  return cleanPath(text).toLowerCase();
}

function sameParent(...items) {
  const real = items.filter(Boolean);
  const keys = real.map(locationParentKey).filter(Boolean);
  if (keys.length !== real.length) return false;
  return new Set(keys).size === 1;
}

function recipe(option) {
  return option.recipe_details ?? option.recipe ?? {};
}

function press(option) {
  return option.press_details ?? option.press ?? {};
}

function needsExternalPerf(option) {
  const r = recipe(option);
  return key(r.perf_option ?? option.perf_option ?? "none") === "perf" || r.requires_external_perf === true;
}

function needsInternalPerf(option) {
  const r = recipe(option);
  return key(r.internal_perf_option ?? option.internal_perf_option ?? "none") === "perf" || r.requires_internal_perf === true;
}

function needsUndercut(option) {
  return option.requires_undercut === true || key(option.setup_type) === "undercut";
}

function pressCanUndercut(option) {
  const p = press(option);
  const values = [option.press_has_undercut_capability, option.has_undercut_capability, p.has_undercut_capability];
  if (values.some((v) => v === true)) return true;
  if (values.some((v) => v === false)) return false;
  // Do not fail a job just because the serializer did not include the press capability flag.
  return true;
}

function perfLabel(option) {
  const r = recipe(option);
  if (needsExternalPerf(option) && needsInternalPerf(option)) return "External + Internal Perf";
  if (needsExternalPerf(option)) return "External Perf";
  if (needsInternalPerf(option)) return `Internal Perf${r.internal_perf_cutting_type ? ` - ${title(r.internal_perf_cutting_type)}` : ""}`;
  return "No Perf";
}

function recipeName(option) {
  const r = recipe(option);
  return option.recipe_name ?? r.name ?? "";
}

function dieSpec(die) {
  const d = details(die);
  return {
    across: d.number_across ?? d.across ?? "--",
    around: d.number_around ?? d.around ?? "--",
    face: labelize(d.face_type) || "--",
    liner: labelize(d.liner_type) || "--",
    gear: tooth(die) ?? "--",
    location: locationParentText(die),
  };
}

function buildChains(dies, mags, label) {
  if (!dies.length) {
    return [{ label, die: null, dieTooth: null, matchingMags: [], runnableMag: null, canRun: false, problems: [`${label} flex die missing`], spec: null }];
  }

  return dies.map((die) => {
    const dieTooth = tooth(die);
    const matchingMags = mags.filter((mag) => dieTooth !== null && tooth(mag) === dieTooth);
    const runnableMag = matchingMags.find((mag) => canUseTool(die) && canUseTool(mag) && sameParent(die, mag)) ?? null;
    const displayMag = runnableMag ?? matchingMags[0] ?? null;

    const problems = [];
    if (!canUseTool(die)) problems.push(`${label} flex die not usable`);
    if (dieTooth === null) problems.push(`${label} flex die tooth missing`);
    if (!matchingMags.length) problems.push(`${dieTooth ?? "--"}T ${label.toLowerCase()} mag missing`);
    if (matchingMags.length && !runnableMag) problems.push(`${label} mag not usable or wrong location`);

    return {
      label,
      die,
      dieTooth,
      matchingMags,
      displayMag,
      runnableMag,
      canRun: canUseTool(die) && Boolean(runnableMag),
      problems,
      spec: dieSpec(die),
    };
  });
}

function chooseUndercutChain(main, undercutChains) {
  const runnableSameLocation = undercutChains.find(
    (chain) => chain.canRun && main.die && main.runnableMag && chain.die && chain.runnableMag && sameParent(main.die, main.runnableMag, chain.die, chain.runnableMag)
  );
  if (runnableSameLocation) return { chain: runnableSameLocation, linked: true };

  const display = undercutChains.find((chain) => chain.die || chain.displayMag || chain.runnableMag) ?? undercutChains[0] ?? null;
  return { chain: display, linked: false };
}

function buildCombos(option) {
  const assignedTools = tools(option);
  const topTools = assignedTools.filter((t) => isTopTool(t) && !isPerfTool(t));
  const undercutTools = assignedTools.filter(isUndercutTool);
  const perfTools = assignedTools.filter(isPerfRoleTool);

  const mainChains = buildChains(topTools.filter(isFlexDie), topTools.filter(isMag), "Main");
  const undercutChains = buildChains(undercutTools.filter(isFlexDie), undercutTools.filter(isMag), "Undercut");
  const usablePerfTools = perfTools.filter(canUseTool);

  return mainChains.map((main) => {
    const problems = [...main.problems];
    const externalPerf = needsExternalPerf(option);
    const undercutRequired = needsUndercut(option);

    const displayPerf = externalPerf ? usablePerfTools[0] ?? perfTools[0] ?? null : null;
    const runnablePerf = externalPerf && main.die && main.runnableMag
      ? usablePerfTools.find((perf) => sameParent(main.die, main.runnableMag, perf)) ?? null
      : null;

    if (externalPerf && !runnablePerf) problems.push(perfTools.length ? "External perf not usable or wrong location" : "External perf required");

    let undercutChain = null;
    let undercutLinked = false;

    if (undercutRequired) {
      if (!pressCanUndercut(option)) problems.push("Press does not have undercut capability");

      const picked = chooseUndercutChain(main, undercutChains);
      undercutChain = picked.chain;
      undercutLinked = picked.linked;

      if (!undercutChain?.die) problems.push("Undercut flex die missing");
      if (undercutChain?.die && !undercutChain.runnableMag) problems.push(...undercutChain.problems);
      if (undercutChain?.die && undercutChain.runnableMag && !undercutLinked) problems.push("Undercut tooling is not in the same location as the main tooling");
    }

    const canRun =
      main.canRun &&
      (!externalPerf || Boolean(runnablePerf)) &&
      (!undercutRequired || (pressCanUndercut(option) && undercutChain?.canRun && undercutLinked));

    return {
      main,
      undercutChain,
      undercutRequired,
      runnablePerf,
      displayPerf,
      spec: main.spec,
      severity: canRun ? "ready" : "bad",
      label: canRun ? "Can Run" : "No Run",
      problems: uniq(problems),
    };
  });
}

export function evaluateOption(option) {
  const combos = buildCombos(option);
  const readyCombos = combos.filter((c) => c.severity === "ready");
  const problemCombos = combos.filter((c) => c.severity !== "ready");
  const review = option.is_approved === false || option.requires_manual_review === true;

  if (readyCombos.length && option.is_active !== false) {
    return { severity: review ? "warn" : "ready", label: review ? "Review" : "Can Run", readyCombos, problemCombos, combos, problems: review ? ["Review required"] : [] };
  }

  const problems = uniq(problemCombos.flatMap((c) => c.problems));
  if (option.is_active === false) problems.unshift("Inactive option");
  return { severity: "bad", label: "No Run", readyCombos, problemCombos, combos, problems };
}

function aggregate(options) {
  const results = options.map(evaluateOption);
  const ready = results.filter((r) => r.severity === "ready").length;
  const warn = results.filter((r) => r.severity === "warn").length;
  const bad = results.filter((r) => r.severity === "bad").length;
  return { severity: ready ? "ready" : warn ? "warn" : "bad", label: ready ? "Can Run" : warn ? "Review" : "No Run", ready, warn, bad, total: options.length };
}

function Status({ severity, label }) {
  return <span className={`run-status ${severity}`}><i />{label}</span>;
}

function Detail({ label, value }) {
  if (value === null || value === undefined || value === "") return null;
  return <div><span>{label}</span><strong>{String(value)}</strong></div>;
}

function ToolDetails({ title, tool, onClose, onFlexDieReorder, onFlexDieCountUpdate, operatorName }) {
  const [requestNote, setRequestNote] = useState("");
  const [countValue, setCountValue] = useState("");
  const [countNote, setCountNote] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!tool) return null;
  const d = details(tool);
  const isFlex = norm(d.type) === "flex die" || toolType(tool).includes("flex_die");
  const canManageDie = isFlex && d.id && (onFlexDieReorder || onFlexDieCountUpdate);

  async function run(actionName, action) {
    setBusy(actionName);
    setError("");
    try {
      await action();
      if (actionName === "request") setRequestNote("");
      if (actionName === "count") setCountNote("");
    } catch (err) {
      setError(err.message || "Could not update the die.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="tool-detail-panel">
      <div className="tool-detail-head">
        <div><p className="eyebrow">{title}</p><h5>{toolName(tool)}</h5></div>
        <button type="button" className="ghost-btn xs" onClick={onClose}><X size={13} /> Close</button>
      </div>
      <div className="tool-detail-grid">
        <Detail label="Status" value={statusText(tool)} />
        <Detail label="Gear" value={tooth(tool) ? `${tooth(tool)}T` : ""} />
        <Detail label="Across" value={d.number_across ?? d.across} />
        <Detail label="Around" value={d.number_around ?? d.around} />
        <Detail label="Face" value={labelize(d.face_type)} />
        <Detail label="Liner" value={labelize(d.liner_type)} />
        <Detail label="Cut" value={labelize(d.cutting_type)} />
        <Detail label="Repeat" value={d.repeat ?? d.repeat_inches} />
        <Detail label="Width" value={d.width ?? d.label_width_inches ?? d.face_width_inches ?? d.cylinder_width_inches} />
        <Detail label="Gap" value={d.gap_across} />
        <Detail label="Web" value={d.web_width} />
        <Detail label="Original Serial" value={d.original_serial_number} />
        <Detail label="Active / Target" value={isFlex ? `${d.active_die_count ?? 0} / ${d.target_die_count ?? 0}` : ""} />
        <Detail label="Location" value={locationText(tool)} />
        <Detail label="Parent" value={locationParentText(tool)} />
      </div>
      {d.dieline_image_url && (
        <a className="tool-dieline-link" href={d.dieline_image_url} target="_blank" rel="noreferrer">View dieline image</a>
      )}
      {canManageDie && (
        <div className="tool-die-actions">
          {onFlexDieReorder && (
            <form onSubmit={(event) => { event.preventDefault(); run("request", () => onFlexDieReorder(d, requestNote, operatorName)); }}>
              <strong>Request new die</strong>
              <textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Optional note" />
              <button className="primary-btn xs" type="submit" disabled={busy === "request"}>{busy === "request" ? "Requesting..." : "Request Reorder"}</button>
            </form>
          )}
          {onFlexDieCountUpdate && (
            <form onSubmit={(event) => { event.preventDefault(); run("count", () => onFlexDieCountUpdate(d, { activeCount: countValue || d.active_die_count || 0, notes: countNote, operatorName })); }}>
              <strong>Update active count</strong>
              <input type="number" min="0" value={countValue} onChange={(event) => setCountValue(event.target.value)} placeholder={String(d.active_die_count ?? 0)} />
              <textarea value={countNote} onChange={(event) => setCountNote(event.target.value)} placeholder="Optional reason" />
              <button className="ghost-btn xs" type="submit" disabled={busy === "count"}>{busy === "count" ? "Saving..." : "Save Count"}</button>
            </form>
          )}
        </div>
      )}
      {error && <p className="tool-die-error">{error}</p>}
    </div>
  );
}

function ToolChip({ label, tool, missing, onOpen, active }) {
  const click = Boolean(tool);
  return (
    <button type="button" disabled={!click} onClick={click ? onOpen : undefined} className={`tool-chip ${canUseTool(tool) ? "ready" : "bad"} ${active ? "active" : ""}`}>
      <span>{label}</span><strong>{tool ? toolName(tool) : missing}</strong><em>{statusText(tool)}</em>
    </button>
  );
}

function PerfChip({ option, combo, open, active }) {
  const r = recipe(option);
  if (needsExternalPerf(option)) {
    return <ToolChip label="PERF" tool={combo.runnablePerf ?? combo.displayPerf} missing="External perf missing" onOpen={() => open("perf", combo.runnablePerf ?? combo.displayPerf, "Perf")} active={active === "perf"} />;
  }
  if (needsInternalPerf(option)) {
    const cut = title(r.internal_perf_cutting_type ?? option.internal_perf_cutting_type);
    const tpi = r.internal_perf_tpi ?? option.internal_perf_tpi;
    return <div className="tool-chip static"><span>PERF</span><strong>Internal Perf</strong><em>{cut !== "--" ? cut : "Required"}{tpi ? ` - ${tpi} TPI` : ""}</em></div>;
  }
  return <div className="tool-chip static"><span>PERF</span><strong>No Perf</strong><em>Not required</em></div>;
}

function SpecChart({ combo }) {
  const s = combo.spec ?? {};

  return (
    <div className={`spec-chart ${combo.severity}`}>
      <div>
        <span>AC</span>
        <strong>{s.across ?? "--"}</strong>
      </div>

      <div>
        <span>AR</span>
        <strong>{s.around ?? "--"}</strong>
      </div>

      <div>
        <span>FACE</span>
        <strong>{s.face ?? "--"}</strong>
      </div>

      <div>
        <span>LINER</span>
        <strong>{s.liner ?? "--"}</strong>
      </div>

      <div className="gear-cell">
        <span>GEAR</span>
        <strong>{s.gear ?? "--"}</strong>
      </div>

      <div className="wide">
        <span>LOCATION</span>
        <strong>{s.location ?? "--"}</strong>
      </div>
    </div>
  );
}

function Chain({ name, die, mag, missingDie, missingMag, children, open, active }) {
  return (
    <div className="chain-row">
      <strong className="chain-label">{name}</strong>
      <ToolChip label="FD" tool={die} missing={missingDie} onOpen={() => open(`${name}-fd`, die, `${name} Flex Die`)} active={active === `${name}-fd`} />
      <span className="arrow">-&gt;</span>
      <ToolChip label="MAG" tool={mag} missing={missingMag} onOpen={() => open(`${name}-mag`, mag, `${name} Mag`)} active={active === `${name}-mag`} />
      {children}
    </div>
  );
}

function Combo({ option, combo, muted = false, onFlexDieReorder, onFlexDieCountUpdate, operatorName }) {
  const [openTool, setOpenTool] = useState(null);
  const open = (id, tool, label) => {
    if (!tool) return;
    setOpenTool((cur) => cur?.id === id ? null : { id, tool, label });
  };

  const mainMagMissing = combo.main.dieTooth ? `${combo.main.dieTooth}T mag missing` : "Main mag missing";
  const ucTooth = combo.undercutChain?.dieTooth;
  const ucMagMissing = ucTooth ? `${ucTooth}T mag missing` : "Undercut mag missing";

  return (
    <article className={`combo-card ${combo.severity} ${muted ? "muted" : ""}`}>
      <SpecChart combo={combo} />
      <div className="chain-stack">
        <Chain name="MAIN" die={combo.main.die} mag={combo.main.runnableMag ?? combo.main.displayMag} missingDie="Main die missing" missingMag={mainMagMissing} open={open} active={openTool?.id}>
          <span className="arrow">-&gt;</span><PerfChip option={option} combo={combo} open={open} active={openTool?.id} />
        </Chain>
        {combo.undercutRequired && (
          <Chain name="UNDERCUT" die={combo.undercutChain?.die} mag={combo.undercutChain?.runnableMag ?? combo.undercutChain?.displayMag} missingDie="Undercut die missing" missingMag={ucMagMissing} open={open} active={openTool?.id} />
        )}
      </div>
      {combo.problems.length > 0 && <div className="problem-line">{combo.problems.map((p) => <span key={p}>{p}</span>)}</div>}
      {openTool && (
        <ToolDetails
          title={openTool.label}
          tool={openTool.tool}
          onClose={() => setOpenTool(null)}
          onFlexDieReorder={onFlexDieReorder}
          onFlexDieCountUpdate={onFlexDieCountUpdate}
          operatorName={operatorName}
        />
      )}
    </article>
  );
}

function OptionCard({ option, onSelect, onEdit, onFlexDieReorder, onFlexDieCountUpdate, operatorName }) {
  const result = useMemo(() => evaluateOption(option), [option]);

  const visibleCombos = result.readyCombos.length
    ? result.readyCombos
    : result.problemCombos.slice(0, 1);

  const hiddenCombos = result.readyCombos.length
    ? result.problemCombos
    : result.problemCombos.slice(1);
  const meta = [
    recipeName(option),
    title(option.setup_type || "standard"),
    perfLabel(option),
    option.estimated_setup_minutes ? `${option.estimated_setup_minutes} min` : null,
    option.is_preferred ? "Preferred" : null,
    option.is_approved !== false ? "Approved" : "Review",
  ].filter(Boolean);

  return (
    <article className={`recipe-option-card ${result.severity}`}>
      <div className="option-card-head" onClick={() => onSelect?.(option)}>
        <div className="option-title">
          <strong>{option.name || "Option"}</strong>
          <span>{meta.join(" - ")}</span>
        </div>

        <Status severity={result.severity} label={result.label} />

        {onEdit && (
          <button type="button" className="ghost-btn xs" onClick={(event) => { event.stopPropagation(); onEdit(option); }}>
            <Edit3 size={13} /> Edit
          </button>
        )}
      </div>

      <div className="option-body">
        <div className="combo-list">
          {visibleCombos.map((combo, idx) => (
            <Combo
              key={idx}
              option={option}
              combo={combo}
              onFlexDieReorder={onFlexDieReorder}
              onFlexDieCountUpdate={onFlexDieCountUpdate}
              operatorName={operatorName}
            />
          ))}
        </div>

        {hiddenCombos.length > 0 && (
          <div className="problem-line subdued">
            <span>{hiddenCombos.length} alternate tooling path{hiddenCombos.length === 1 ? "" : "s"} not ready</span>
          </div>
        )}
      </div>
    </article>
  );
}

function PressGroup({ pressName, options, onSelect, onEdit, defaultOpen = false, onFlexDieReorder, onFlexDieCountUpdate, operatorName }) {
  const [open, setOpen] = useState(defaultOpen);
  const stat = useMemo(() => aggregate(options), [options]);
  const orderedOptions = useMemo(
    () => [...options].sort((a, b) => {
      const aResult = evaluateOption(a);
      const bResult = evaluateOption(b);
      const rank = { ready: 0, warn: 1, bad: 2 };
      return (rank[aResult.severity] ?? 9) - (rank[bResult.severity] ?? 9) || String(a.name ?? "").localeCompare(String(b.name ?? ""));
    }),
    [options]
  );

  return (
    <section className={`press-group-card ${stat.severity}`}>
      <button
        type="button"
        className="press-head master-press-head"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}

        <div className="press-title-block">
          <span>Press</span>
          <strong>{pressName || "No press"}</strong>
        </div>

        <div className="press-master-status">
          <Status severity={stat.severity} label={stat.label} />
          <span>{stat.ready}/{stat.total} ready</span>
        </div>
      </button>

      {open && (
        <div className="option-stack">
          {orderedOptions.map((option) => (
            <OptionCard
              key={option.id}
              option={option}
              onSelect={onSelect}
              onEdit={onEdit}
              onFlexDieReorder={onFlexDieReorder}
              onFlexDieCountUpdate={onFlexDieCountUpdate}
              operatorName={operatorName}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export default function RecipeOptionsView({ rows, onSelect, onEdit, defaultOpenAll = false, onFlexDieReorder, onFlexDieCountUpdate, operatorName }) {
  const byPress = useMemo(() => groupBy(rows ?? [], (r) => r.press_name ?? r.press_details?.name ?? "No press"), [rows]);
  const pressGroups = useMemo(
    () => Object.entries(byPress).sort(([aName], [bName]) => aName.localeCompare(bName)),
    [byPress]
  );

  if (!rows?.length) return <div className="empty-recipe-options">No press setup options match this view.</div>;

  return (
    <div className="recipe-options-view">
      {pressGroups.map(([pressName, list]) => (
        <PressGroup
          key={pressName}
          pressName={pressName}
          options={list}
          onSelect={onSelect}
          onEdit={onEdit}
          defaultOpen={defaultOpenAll}
          onFlexDieReorder={onFlexDieReorder}
          onFlexDieCountUpdate={onFlexDieCountUpdate}
          operatorName={operatorName}
        />
      ))}
    </div>
  );
}
