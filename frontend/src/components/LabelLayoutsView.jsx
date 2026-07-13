import { Fragment, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, CheckCircle2, ChevronDown, ChevronRight, Copy, Edit3, ExternalLink, LoaderCircle, Plus, Search, Trash2, Wrench, X } from "lucide-react";
import * as pdfjsLib from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { apiEndpoint } from "../api";
import { choiceLists } from "../resourceConfig";
import { formatInches, getRecordTitle, labelize } from "../lib/format";
import { isPdfUrl } from "./FilePreview";
import { evaluateOption } from "./RecipeOptionsView";

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

const GOOD_STATUSES = new Set(["active", "available", "in_stock", "in_use"]);
const BAD_STATUSES = new Set(["inactive", "missing", "needs_ordered", "needs_repair", "ordered", "out_for_repair", "out_for_retool", "out_of_stock", "retired"]);

const choiceLookup = Object.fromEntries(
  ["faceType", "linerType", "shapeType", "layoutShapeType", "cuttingType", "labelCutType", "toolRole", "toolType", "toolStatus", "bladeType"].flatMap((listKey) =>
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

function compactSearchText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/"/g, "");
}

function numberSearchText(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  return [
    value,
    Number.isFinite(n) ? n.toFixed(3) : "",
    Number.isFinite(n) ? String(n) : "",
    formatInches(value),
    sizeText(value),
  ].filter(Boolean).join(" ").toLowerCase().replace(/"/g, "");
}

function matchesNumberFilter(value, query) {
  const q = compactSearchText(query);
  if (!q) return true;
  return numberSearchText(value).includes(q);
}

function tpiText(row) {
  return [
    row.tpi ? `${row.tpi} TPI` : "",
    row.internal_perf_tpi ? `Internal ${row.internal_perf_tpi} TPI` : "",
  ].filter(Boolean).join(" / ");
}

function layoutFileUrl(row) {
  return row?.layout_file_url || row?.layout_file || "";
}

function layoutFileName(row) {
  return row?.layout_file_name || String(layoutFileUrl(row)).split("/").pop() || "";
}

function layoutPreviewUrl(row) {
  return row?.id && layoutFileUrl(row) ? `${apiEndpoint("recipes", row.id)}layout-file-preview/` : "";
}

function layoutMatchesFilters(row, filters) {
  if (!matchesNumberFilter(row.label_width_inches, filters.width)) return false;
  if (!matchesNumberFilter(row.label_length_inches, filters.length)) return false;
  if (!matchesNumberFilter(row.repeat_inches, filters.repeat)) return false;

  const perfQuery = compactSearchText(filters.perf);
  if (perfQuery) {
    const perfSource = [
      perfText(row),
      perfShortLabel(row),
      perfShortLabel(row) === "NP" ? "No Perf" : "",
      row.perf_option,
      row.internal_perf_option,
      row.perf_notes,
      row.internal_perf_notes,
    ].join(" ").toLowerCase();
    if (!perfSource.includes(perfQuery)) return false;
  }

  const tpiQuery = compactSearchText(filters.tpi);
  if (tpiQuery) {
    const source = [row.tpi, row.internal_perf_tpi, tpiText(row)].filter(Boolean).join(" ").toLowerCase();
    if (!source.includes(tpiQuery)) return false;
  }

  return true;
}

function layoutGroupLabel(row) {
  return [
    choiceLabel("faceType", row.face_type, "No Face"),
    choiceLabel("linerType", row.liner_type, "No Liner"),
    sizeText(row.label_width_inches),
    sizeText(row.repeat_inches),
    perfShortLabel(row),
  ].join(" - ");
}

function layoutGroupKey(row) {
  return [
    groupKey(row.face_type),
    groupKey(row.liner_type),
    row.label_width_inches ?? "",
    row.repeat_inches ?? "",
    perfShortLabel(row).toLowerCase(),
  ].join("|");
}

function layoutRootTitle(row) {
  const face = choiceLabel("faceType", row.face_type, "");
  const liner = choiceLabel("linerType", row.liner_type, "");
  const material = [face, liner].filter(Boolean).join(" / ");
  return [
    `${formatInches(row.label_width_inches)} x ${formatInches(row.label_length_inches)}`,
    material,
  ].filter(Boolean).join(" ");
}

function layoutRootChips(row) {
  return [
    `Repeat ${formatInches(row.repeat_inches)}`,
    tpiText(row),
    choiceLabel("layoutShapeType", row.shape_type, "Shape"),
    choiceLabel("labelCutType", row.cutting_type, "Cut"),
    perfShortLabel(row) === "NP" ? "No Perf" : perfShortLabel(row),
  ].filter(Boolean);
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
  const operation = externalOperation(row);
  const external = operation === "sheeted"
    ? "Sheeted / sheeter cut"
    : operation === "perf"
    ? `External ${row.tpi ? `${row.tpi} TPI` : "Perf"}`
    : "No between-label cut";
  const internal = row.internal_perf_option === "perf"
    ? `Internal ${row.internal_perf_tpi ? `${row.internal_perf_tpi} TPI` : "Perf"}`
    : "";
  return [external, internal].filter(Boolean).join(" / ");
}

function perfShortLabel(row) {
  const operation = externalOperation(row);
  if (operation === "sheeted") return "Sheeted";
  if (operation === "perf" || recipeNeedsPerf(row, null)) return "Perf";
  return "NP";
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

function bladeTypes(tool) {
  const details = toolDetails(tool);
  const values = Array.isArray(details.blade_types) ? details.blade_types : Array.isArray(tool?.blade_types) ? tool.blade_types : [];
  return values.map((value) => normalized(value).replaceAll(" ", "_").replaceAll("-", "_")).filter(Boolean);
}

function hasSheeterBlade(tool) {
  const details = toolDetails(tool);
  return details.has_sheeter_blade === true || tool?.has_sheeter_blade === true || bladeTypes(tool).includes("sheeter");
}

function toolRoleKey(tool) {
  return normalized(tool?.tool_role ?? tool?.role ?? "top").replaceAll(" ", "_").replaceAll("-", "_");
}

function toothText(tool) {
  const details = toolDetails(tool);
  const value = details.tooth_count ?? details.gear ?? details.gear_tooth_count ?? details.perf_cylinder_gear ?? tool?.tooth_count ?? tool?.gear;
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
  if (type.includes("perf_blade_setup")) {
    const blades = bladeTypes(tool).map((value) => choiceLabel("bladeType", value, value)).filter(Boolean);
    return [
      details.perf_cylinder,
      details.gear || details.perf_cylinder_gear ? `${details.gear ?? details.perf_cylinder_gear}T` : "",
      hasSheeterBlade(tool) ? "Sheeter" : "",
      blades.length ? blades.join(", ") : "",
      details.blade_count ? `${details.blade_count} blades` : "",
    ].filter(Boolean).join(" / ");
  }
  return tool?.manual_description || "";
}

function toolLocation(tool) {
  const details = toolDetails(tool);
  return (
    details.location ??
    details.current_location_full_path ??
    details.current_location_name ??
    details.location_full_path ??
    details.location_name ??
    tool?.current_location_full_path ??
    tool?.current_location_name ??
    tool?.location_full_path ??
    tool?.location_name ??
    ""
  );
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

function externalOperation(recipe, option) {
  const source = recipe ?? option?.recipe_details ?? {};
  const value = normalized(source.perf_option ?? option?.perf_option).replaceAll(" ", "_").replaceAll("-", "_");
  if (value === "sheeted" || value === "sheet" || source.requires_sheeting === true) return "sheeted";
  if (value === "perf" || source.requires_external_perf === true) return "perf";
  return "none";
}

function recipeNeedsExternalPerf(recipe, option) {
  return externalOperation(recipe, option) !== "none";
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
  const needsPerf = recipeNeedsExternalPerf(recipe, option) || perfTools.length > 0;
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
    { key: "mag1", label: "Magnetic Cylinder", missing: "Magnetic cylinder missing", requestGroup: "MAG1", tool: mag1 },
    { key: "die1", label: "Flex Die", missing: "Flex die missing", requestGroup: "DIE1", tool: die1 },
  ];

  if (needsUndercut) {
    slots.push(
      { key: "mag2", label: "Undercut Magnetic Cylinder", missing: "Undercut magnetic cylinder missing", requestGroup: "MAG2", tool: mag2 },
      { key: "die2", label: "Undercut Flex Die", missing: "Undercut flex die missing", requestGroup: "DIE2", tool: die2 }
    );
  }

  if (needsPerf) {
    const operation = externalOperation(recipe, option);
    slots.push({
      key: "perf",
      label: operation === "sheeted" ? "Sheeter Setup" : "Perf Setup",
      missing: operation === "sheeted" ? "Sheeter setup missing" : "Perf tooling missing",
      requestGroup: "PERF",
      tool: perf,
    });
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

function CopyLayoutIdButton({ row, copiedId, onCopy }) {
  if (!row?.id) return null;
  const copied = String(copiedId) === String(row.id);
  return (
    <button type="button" className={`layout-copy-id ${copied ? "copied" : ""}`} title="Copy layout ID" onClick={(event) => { event.stopPropagation(); onCopy?.(row); }}>
      <Copy size={12} />
      {copied ? "Copied" : `ID ${row.id}`}
    </button>
  );
}

function ArtworkImage({ src, fallbackSrc = "", title }) {
  const [currentSrc, setCurrentSrc] = useState(src);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setCurrentSrc(src);
    setFailed(false);
  }, [src]);

  if (!currentSrc || failed) {
    return (
      <span className="layout-artwork-state failed" aria-hidden="true">
        <ExternalLink size={18} />
      </span>
    );
  }

  return (
    <img
      src={currentSrc}
      alt={title}
      onError={() => {
        if (fallbackSrc && currentSrc !== fallbackSrc) {
          setCurrentSrc(fallbackSrc);
        } else {
          setFailed(true);
        }
      }}
    />
  );
}

function PdfArtworkImage({ url, fallbackUrl = "", title }) {
  const [previewSrc, setPreviewSrc] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const sources = [url, fallbackUrl].filter(Boolean);
    if (!sources.length) return undefined;

    setPreviewSrc("");
    setFailed(false);

    async function renderFirstPage() {
      let pdf = null;
      try {
        let response = null;
        for (const source of sources) {
          response = await fetch(source, { cache: "no-store", signal: controller.signal });
          if (response.ok) break;
        }
        if (!response?.ok) throw new Error(`Could not load layout PDF preview (${response?.status || "no response"}).`);
        const data = new Uint8Array(await response.arrayBuffer());
        const loadingTask = pdfjsLib.getDocument({
          data,
          disableAutoFetch: true,
          disableRange: true,
          disableStream: true,
        });
        pdf = await loadingTask.promise;
        const page = await pdf.getPage(1);
        if (cancelled) return;

        const baseViewport = page.getViewport({ scale: 1 });
        const deviceScale = Math.min(window.devicePixelRatio || 1, 2);
        const targetSize = Math.round(640 * deviceScale);
        const scale = targetSize / Math.max(baseViewport.width, baseViewport.height);
        const viewport = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { alpha: false });
        if (!context) throw new Error("Canvas preview is unavailable.");

        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        context.fillStyle = "#ffffff";
        context.fillRect(0, 0, canvas.width, canvas.height);

        await page.render({ canvasContext: context, viewport }).promise;
        if (!cancelled) setPreviewSrc(canvas.toDataURL("image/png"));
      } catch (error) {
        if (!cancelled && error?.name !== "AbortError") {
          console.warn("Could not render layout PDF preview.", error);
          setFailed(true);
        }
      } finally {
        if (pdf) {
          try {
            await pdf.destroy();
          } catch {
            // Ignore cleanup failures after the preview has already rendered.
          }
        }
      }
    }

    renderFirstPage();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [url, fallbackUrl]);

  if (previewSrc) return <img className="layout-artwork-rendered" src={previewSrc} alt={title} />;

  return (
    <span className={`layout-artwork-state ${failed ? "failed" : "loading"}`} aria-hidden="true">
      {failed ? <ExternalLink size={18} /> : <LoaderCircle size={18} />}
    </span>
  );
}

function LayoutArtworkPreview({ row, size = "expanded" }) {
  const url = layoutFileUrl(row);
  if (!url) return null;
  const title = layoutFileName(row) || row.name || "Layout artwork";
  const previewUrl = layoutPreviewUrl(row) || url;

  return (
    <div className={`layout-artwork-preview ${size}`} title={title}>
      {isPdfUrl(url) ? (
        <PdfArtworkImage url={previewUrl} fallbackUrl={url} title={title} />
      ) : (
        <ArtworkImage src={previewUrl} fallbackSrc={url} title={title} />
      )}
    </div>
  );
}

function LayoutRootArtwork({ row }) {
  const url = layoutFileUrl(row);
  if (!url) return null;
  const openUrl = layoutPreviewUrl(row) || url;

  return (
    <div className="layout-root-artwork-shell" onClick={(event) => event.stopPropagation()}>
      <LayoutArtworkPreview row={row} size="main" />
      <a className="layout-artwork-open" href={openUrl} target="_blank" rel="noreferrer" title="Open layout artwork" aria-label="Open layout artwork">
        <ExternalLink size={14} />
      </a>
    </div>
  );
}

function LayoutAttachmentPreview({ row }) {
  const url = layoutFileUrl(row);
  if (!url) return null;
  const name = layoutFileName(row) || "Layout artwork";
  const openUrl = layoutPreviewUrl(row) || url;
  return (
    <div className="layout-attachment-preview" onClick={(event) => event.stopPropagation()}>
      <LayoutArtworkPreview row={row} />
      <div className="layout-attachment-meta">
        <strong>{name}</strong>
        <a href={openUrl} target="_blank" rel="noreferrer"><ExternalLink size={12} /> Open full size</a>
      </div>
    </div>
  );
}

function ChainToolCard({ slot, option, onAddTooling, onEdit, onDelete, onOpen }) {
  if (!slot.tool) {
    return (
      <button type="button" className="layout-chain-card missing" onClick={() => onAddTooling(option, slot.requestGroup)}>
        <div className="layout-chain-main">
          <span className="layout-chain-type">{slot.label}</span>
          <strong>{slot.missing}</strong>
        </div>
        <em className="layout-chain-add"><Plus size={11} /> Add</em>
      </button>
    );
  }

  const status = toolStatus(slot.tool);
  const meta = toolMeta(slot.tool);
  const dieAcross = isFlexDieTool(slot.tool) ? dieAcrossText(slot.tool) : "";
  const location = !isFlexDieTool(slot.tool) ? toolLocation(slot.tool) : "";

  return (
    <div
      className={`layout-chain-card ${status} interactive`}
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(slot.tool)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen?.(slot.tool);
      }}
    >
      <div className="layout-chain-main">
        <div className="layout-chain-title-row">
          <span className="layout-chain-type">{slot.label}</span>
          <small className={`layout-chain-state ${status}`}>{toolStateText(slot.tool)}</small>
        </div>
        <strong>{toolName(slot.tool)}</strong>
        {(dieAcross || meta) && (
          <div className="layout-chain-tags">
            {dieAcross && <em className="layout-die-across">{dieAcross}</em>}
            {meta && <small className="layout-chain-meta">{meta}</small>}
          </div>
        )}
        {location && <small className="layout-chain-location">{location}</small>}
      </div>
      <div className="layout-tool-actions">
        <button type="button" onClick={(event) => { event.stopPropagation(); onEdit(slot.tool); }}><Edit3 size={12} /> Edit</button>
        <button type="button" className="danger-text" onClick={(event) => { event.stopPropagation(); onDelete(slot.tool); }}><Trash2 size={12} /> Delete</button>
      </div>
    </div>
  );
}

function PressOptionCard({ recipe, option, toolRows, onEditPressOption, onDeletePressOption, onAddTooling, onEditTooling, onDeleteTooling, renderToolDetail }) {
  const [open, setOpen] = useState(false);
  const [detailTool, setDetailTool] = useState(null);
  const tools = optionTools(option, toolRows, option.tools);
  const sharedReadiness = evaluateOption({ ...option, recipe_details: option.recipe_details ?? recipe, tools });
  const readiness = {
    tone: sharedReadiness.severity,
    label: sharedReadiness.label === "Can Run" ? "Ready" : sharedReadiness.label,
    problems: sharedReadiness.problems ?? [],
  };
  const plan = buildToolSlots(recipe, option, tools);
  const { slots } = plan;

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
              {index > 0 && <span className="layout-chain-arrow"><ArrowRight size={18} aria-hidden="true" /></span>}
              <ChainToolCard
                slot={slot}
                option={option}
                onAddTooling={onAddTooling}
                onEdit={onEditTooling}
                onDelete={onDeleteTooling}
                onOpen={(tool) => setDetailTool((current) => current?.id === tool?.id ? null : tool)}
              />
            </Fragment>
          ))}
        </div>
      )}

      {open && detailTool && renderToolDetail && (
        <div className="layout-inline-tool-detail">
          {renderToolDetail(detailTool, () => setDetailTool(null))}
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
  renderToolDetail,
  copiedId,
  onCopyLayoutId,
  showHeader = true,
}) {
  return (
    <article className={`layout-design-card ${showHeader ? "" : "root-panel"} ${selected ? "selected" : ""} ${row.is_active === false ? "inactive" : ""}`} onClick={() => onSelect(row)}>
      {showHeader && (
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
            <CopyLayoutIdButton row={row} copiedId={copiedId} onCopy={onCopyLayoutId} />
            <button type="button" onClick={() => onEdit(row)}><Edit3 size={12} /> Edit</button>
            <button type="button" onClick={() => onAddPressOption(row)}><Plus size={12} /> Add Press Option</button>
            <button type="button" className="danger-text" onClick={() => onDelete(row)}><Trash2 size={12} /> Delete</button>
          </div>
        </header>
      )}

      <LayoutAttachmentPreview row={row} />

      <div className={`layout-press-section ${showHeader ? "" : "root-options"}`} onClick={(event) => event.stopPropagation()}>
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
                renderToolDetail={renderToolDetail}
              />
            ))}
          </div>
        ) : (
          <div className="layout-no-options">
            <span>No press tooling setups yet.</span>
            <button type="button" onClick={() => onAddPressOption(row)}><Plus size={12} /> Add Press Setup</button>
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
  const primaryRow = group.rows[0] ?? {};
  const singleLayout = group.rows.length === 1;
  const selected = group.rows.some((row) => selectedId === row.id);
  const setupLabel = `${group.optionCount} setup${group.optionCount === 1 ? "" : "s"}`;
  const countLabel = singleLayout ? setupLabel : `${group.rows.length} layouts / ${setupLabel}`;

  function toggleGroup() {
    if (primaryRow?.id) actions.onSelect?.(primaryRow);
    toggleOpen(group.key);
  }

  return (
    <section className={`layout-group combined roll-root ${open ? "open" : ""} ${selected ? "selected" : ""}`}>
      <div className={`layout-group-head combined layout-root-head ${singleLayout && layoutFileUrl(primaryRow) ? "has-artwork" : ""}`}>
        {singleLayout && <LayoutRootArtwork row={primaryRow} />}

        <button type="button" className="layout-root-toggle" onClick={toggleGroup}>
          <span className="layout-group-toggle">{open ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</span>
          <span className="layout-root-stripe" aria-hidden="true" />
          <span className="layout-group-title layout-root-title">
            <strong>{singleLayout ? layoutRootTitle(primaryRow) : group.label}</strong>
            <em>{singleLayout ? (primaryRow.name || perfText(primaryRow)) : "Grouped label layouts"}</em>
          </span>
          {singleLayout && (
            <span className="layout-root-specs">
              {layoutRootChips(primaryRow).map((chip) => <small key={chip}>{chip}</small>)}
            </span>
          )}
          <span className="layout-group-count layout-root-count">{countLabel}</span>
        </button>

        {singleLayout && (
          <div className="layout-inline-actions layout-root-actions">
            <CopyLayoutIdButton row={primaryRow} copiedId={actions.copiedId} onCopy={actions.onCopyLayoutId} />
            <button type="button" onClick={() => actions.onEdit(primaryRow)}><Edit3 size={12} /> Edit</button>
            <button type="button" onClick={() => actions.onAddPressOption(primaryRow)}><Plus size={12} /> Add Press Option</button>
            <button type="button" className="danger-text" onClick={() => actions.onDelete(primaryRow)}><Trash2 size={12} /> Delete</button>
          </div>
        )}
      </div>

      {open && (
        <div className="layout-group-body combined">
          {group.rows.map((row) => (
            <LayoutCard
              key={row.id}
              row={row}
              options={optionsByRecipe.get(String(row.id)) ?? []}
              toolRows={toolRows}
              selected={selectedId === row.id}
              showHeader={!singleLayout}
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
  renderToolDetail,
}) {
  const [openKeys, setOpenKeys] = useState(() => new Set());
  const [filters, setFilters] = useState({ width: "", length: "", repeat: "", perf: "", tpi: "" });
  const [copiedId, setCopiedId] = useState("");

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

  const filteredRows = useMemo(() => (rows ?? []).filter((row) => layoutMatchesFilters(row, filters)), [rows, filters]);
  const groups = useMemo(() => buildGroups(filteredRows, optionsByRecipe), [filteredRows, optionsByRecipe]);

  function updateFilter(key, value) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  function clearFilters() {
    setFilters({ width: "", length: "", repeat: "", perf: "", tpi: "" });
  }

  async function copyLayoutId(row) {
    const text = String(row?.id ?? "").trim();
    if (!text) return;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const el = document.createElement("textarea");
        el.value = text;
        el.setAttribute("readonly", "");
        el.style.position = "fixed";
        el.style.opacity = "0";
        document.body.appendChild(el);
        el.select();
        document.execCommand("copy");
        document.body.removeChild(el);
      }
      setCopiedId(text);
      window.setTimeout(() => setCopiedId((current) => current === text ? "" : current), 1400);
    } catch {
      setCopiedId("");
    }
  }

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
      <div className="layout-search-panel">
        <label>
          <span><Search size={13} /> Width</span>
          <input value={filters.width} onChange={(event) => updateFilter("width", event.target.value)} placeholder="2.000" />
        </label>
        <label>
          <span>Length</span>
          <input value={filters.length} onChange={(event) => updateFilter("length", event.target.value)} placeholder="1.000" />
        </label>
        <label>
          <span>Repeat</span>
          <input value={filters.repeat} onChange={(event) => updateFilter("repeat", event.target.value)} placeholder="3.125" />
        </label>
        <label>
          <span>Perf</span>
          <input value={filters.perf} onChange={(event) => updateFilter("perf", event.target.value)} placeholder="NP / perf" />
        </label>
        <label>
          <span>TPI</span>
          <input value={filters.tpi} onChange={(event) => updateFilter("tpi", event.target.value)} placeholder="12" />
        </label>
        <button type="button" onClick={clearFilters} disabled={!Object.values(filters).some(Boolean)}>
          <X size={13} /> Clear
        </button>
      </div>
      {!groups.length && <p className="label-layout-empty">No label layouts match those filters.</p>}
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
            renderToolDetail,
            copiedId,
            onCopyLayoutId: copyLayoutId,
          }}
        />
      ))}
    </div>
  );
}
