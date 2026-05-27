import { Fragment, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { formatInches, getRecordTitle } from "../lib/format";
import { PdfPreview, isPdfUrl } from "./FilePreview";

function normalizeInitial(fields, record, defaults = {}) {
  const out = {};

  fields.forEach((field) => {
    if (field.readOnly) return;
    if (field.type === "checkbox") {
      out[field.name] = record?.[field.name] ?? defaults?.[field.name] ?? field.defaultValue ?? false;
      return;
    }
    if (field.type === "imageUpload") {
      out[field.name] = null;
      return;
    }
    if (field.type === "multiRelation") {
      out[field.name] = record?.[field.name] ?? defaults?.[field.name] ?? field.defaultValue ?? [];
      return;
    }
    out[field.name] = record?.[field.name] ?? defaults?.[field.name] ?? field.defaultValue ?? "";
  });

  return out;
}

function clearHiddenFields(fields, nextForm) {
  const cleaned = { ...nextForm };

  fields.forEach((field) => {
    if (field.readOnly || shouldShow(field, cleaned)) return;
    cleaned[field.name] = getEmptyValueForField(field);
  });

  return cleaned;
}

function matchesShowWhenValue(actual, expected) {
  if (Array.isArray(expected)) return expected.includes(actual);
  return actual === expected;
}

function shouldShow(field, form) {
  if (!field.showWhen) return true;
  return Object.entries(field.showWhen).every(([key, expected]) => matchesShowWhenValue(form[key], expected));
}

function getFieldLabel(field, form) {
  if (typeof field.dynamicLabel === "function") return field.dynamicLabel(form);
  return field.label;
}

function getFieldTab(field) {
  return field.tab || "Ticket";
}

function getEmptyValueForField(field) {
  if (Object.prototype.hasOwnProperty.call(field, "clearWhenHidden")) return field.clearWhenHidden;
  if (field.type === "number" || field.type === "relation" || field.type === "searchRelation" || field.type === "date") return null;
  if (field.type === "multiRelation") return [];
  if (field.type === "imageUpload") return null;
  if (field.type === "checkbox") return false;
  return "";
}

function formatValueForPayload(field, value) {
  if (field.type === "number") return value === "" || value === null || value === undefined ? null : Number(value);
  if (field.type === "date") return value === "" || value === null || value === undefined ? null : value;
  if (field.type === "relation" || field.type === "searchRelation") return value === "" || value === null || value === undefined ? null : Number(value);
  if (field.type === "multiRelation") return Array.isArray(value) ? value : [];
  if (field.type === "imageUpload") return value ?? null;
  if (field.type === "checkbox") return Boolean(value);
  if (["select", "text", "email", "textarea"].includes(field.type)) return value === null || value === undefined ? "" : value;
  return value === null || value === undefined ? "" : value;
}

const materialCodePrefixes = {
  liner: "LIN",
  face: "FAC",
  adhesive: "ADH",
  silicone: "SIL",
  coating: "COA",
  coated_stock: "CS",
};

function generatedMaterialCode(materialType) {
  const prefix = materialCodePrefixes[materialType] ?? "MAT";
  return `${prefix}-${Date.now().toString(36).toUpperCase()}`;
}

const tsmMaterialPrefixRules = [
  { prefix: "1", labels: ["PMDTD/PET", "PMDT/PET", "PMDTD", "PMDT"] },
  { prefix: "2", labels: ["PMPR", "PMD", "PM"] },
  { prefix: "3", labels: ["DTP"] },
  { prefix: "4", labels: ["TTP"] },
  { prefix: "5", labels: ["TTT"] },
  { prefix: "6", labels: ["DTT"] },
  { prefix: "8", labels: ["PGT"] },
  { prefix: "10", labels: ["LPO"] },
  { prefix: "11", labels: ["LV"] },
  { prefix: "12", labels: ["GIJPA"] },
  { prefix: "13", labels: ["PET"] },
  { prefix: "14", labels: ["LPA"] },
];

const tsmMaterialAliases = tsmMaterialPrefixRules
  .flatMap((rule) => rule.labels.map((label) => ({ label, prefix: rule.prefix })))
  .sort((a, b) => b.label.length - a.label.length);

function compactMaterialText(value) {
  return String(value ?? "").toUpperCase().replace(/\s+/g, "");
}

function normalizeTsmCode(value) {
  return String(value ?? "").trim().toUpperCase().replace(/^TSM\s+/, "").replace(/\s+/g, "");
}

function parseTsmCode(value) {
  const normalized = normalizeTsmCode(value);
  const match = /^([A-Z0-9]+)-(\d{3})-(\d{3})$/.exec(normalized);
  if (!match) return null;
  return {
    normalized,
    prefix: match[1],
    group: match[2],
    sequence: Number(match[3]),
  };
}

function formatTsmCode(prefix, sequence, group = "000") {
  return `${prefix}-${group}-${String(Math.max(1, Number(sequence) || 1)).padStart(3, "0")}`;
}

function selectedLookupRow(rows, id) {
  if (id === null || id === undefined || id === "") return null;
  return (rows ?? []).find((row) => String(row.id) === String(id)) ?? null;
}

function normalizeMatchText(value) {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function numberMatches(left, right) {
  const a = Number(left);
  const b = Number(right);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 0.001;
}

function recipeMatchParts(recipe, form) {
  const parts = [];
  if (numberMatches(recipe.label_width_inches, form.label_width_inches)) parts.push("Width");
  if (numberMatches(recipe.label_length_inches, form.label_length_inches)) parts.push("Length");
  if (numberMatches(recipe.repeat_inches, form.repeat_inches)) parts.push("Repeat");
  if (normalizeMatchText(recipe.face_type) && normalizeMatchText(recipe.face_type) === normalizeMatchText(form.face_type)) parts.push("Face");
  if (normalizeMatchText(recipe.liner_type) && normalizeMatchText(recipe.liner_type) === normalizeMatchText(form.liner_type)) parts.push("Liner");
  return parts;
}

function recipeMatchScore(recipe, form) {
  let score = 0;
  if (numberMatches(recipe.label_width_inches, form.label_width_inches)) score += 4;
  if (numberMatches(recipe.label_length_inches, form.label_length_inches)) score += 4;
  if (numberMatches(recipe.repeat_inches, form.repeat_inches)) score += 5;
  if (normalizeMatchText(recipe.face_type) && normalizeMatchText(recipe.face_type) === normalizeMatchText(form.face_type)) score += 3;
  if (normalizeMatchText(recipe.liner_type) && normalizeMatchText(recipe.liner_type) === normalizeMatchText(form.liner_type)) score += 3;
  return score;
}

function recipeLayoutLine(recipe) {
  return [
    recipe.label_width_inches && recipe.label_length_inches ? `${formatInches(recipe.label_width_inches)} x ${formatInches(recipe.label_length_inches)}` : "",
    recipe.repeat_inches ? `Repeat ${formatInches(recipe.repeat_inches)}` : "",
    [recipe.face_type, recipe.liner_type].filter(Boolean).join(" / "),
  ].filter(Boolean).join(" - ");
}

function customerPrefixForForm(form, lookups) {
  const customer = selectedLookupRow(lookups?.customers, form.customer);
  const source = form.customer_name || customer?.name || customer?.customer_name || "";
  const compact = String(source).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length >= 3 ? compact.slice(0, 3) : "";
}

function materialPrefixForForm(form, lookups) {
  const masterType = selectedLookupRow(lookups?.["material-master-types"], form.material_master_type);
  const material = selectedLookupRow(lookups?.materials, form.material_spec);
  const texts = [
    masterType?.code,
    masterType?.name,
    masterType?.description,
    material?.master_type_code,
    material?.material_master_type_code,
    material?.material_family,
    material?.code,
    material?.name,
  ].filter(Boolean);

  for (const text of texts) {
    const compact = compactMaterialText(text);
    const match = tsmMaterialAliases.find((alias) => compact.includes(compactMaterialText(alias.label)));
    if (match) return match.prefix;
  }
  return "";
}

function prefixFromPartialInput(value) {
  const normalized = normalizeTsmCode(value);
  const match = /^([A-Z0-9]+)-/.exec(normalized);
  return match?.[1] ?? "";
}

function buildTsmIdRecommendation(form, lookups, record) {
  const existingRows = (lookups?.["job-tickets"] ?? [])
    .filter((row) => !record?.id || String(row.id) !== String(record.id));
  const usedCodes = new Set(existingRows.map((row) => normalizeTsmCode(row.product_code)).filter(Boolean));
  const inputCode = normalizeTsmCode(form.product_code);
  const inputParts = parseTsmCode(inputCode);
  const prefix = inputParts?.prefix || prefixFromPartialInput(inputCode) || customerPrefixForForm(form, lookups) || materialPrefixForForm(form, lookups);
  const group = inputParts?.group || "000";

  if (!prefix) {
    return {
      status: "missing-context",
      message: "Select a customer for a customer-specific item, or a material type for a stock item.",
      inputTone: "",
    };
  }

  const parsedExisting = existingRows
    .map((row) => parseTsmCode(row.product_code))
    .filter((parts) => parts && parts.prefix === prefix && parts.group === group);
  const usedSequences = new Set(parsedExisting.map((parts) => parts.sequence));
  const targetSequence = inputParts?.sequence || Math.max(0, ...parsedExisting.map((parts) => parts.sequence)) + 1;
  let availableSequence = Math.max(1, targetSequence);
  while (usedSequences.has(availableSequence)) availableSequence += 1;

  const usedNearby = parsedExisting
    .sort((a, b) => Math.abs(a.sequence - targetSequence) - Math.abs(b.sequence - targetSequence) || a.sequence - b.sequence)
    .slice(0, 3)
    .sort((a, b) => a.sequence - b.sequence)
    .map((parts) => formatTsmCode(parts.prefix, parts.sequence, parts.group));

  const exactConflict = Boolean(inputCode && usedCodes.has(inputCode));
  return {
    status: "ready",
    prefix,
    group,
    usedNearby,
    availableCode: formatTsmCode(prefix, availableSequence, group),
    exactConflict,
    inputTone: exactConflict ? "conflict" : inputParts ? "available" : "",
  };
}

function TsmIdRecommendationPanel({ recommendation, onPick }) {
  if (!recommendation) return null;

  if (recommendation.status === "missing-context") {
    return <small className="tsm-id-helper">{recommendation.message}</small>;
  }

  return (
    <div className="tsm-id-recommendations" aria-live="polite">
      {recommendation.usedNearby.length > 0 && (
        <div className="tsm-id-recommendation-group">
          <span>Used nearby</span>
          <div>
            {recommendation.usedNearby.map((code) => (
              <strong className="bad" key={code}>{code}</strong>
            ))}
          </div>
        </div>
      )}
      <div className="tsm-id-recommendation-group">
        <span>Recommended available</span>
        <button type="button" className="good" onClick={() => onPick(recommendation.availableCode)}>
          {recommendation.availableCode}
        </button>
      </div>
    </div>
  );
}

function RecipeRecommendationPanel({ recipes, form, value, onPick }) {
  const candidates = useMemo(() => {
    return (recipes ?? [])
      .map((recipe) => ({
        recipe,
        score: recipeMatchScore(recipe, form),
        matches: recipeMatchParts(recipe, form),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || String(a.recipe.name ?? "").localeCompare(String(b.recipe.name ?? ""), undefined, { numeric: true }))
      .slice(0, 5);
  }, [recipes, form]);

  if (!candidates.length) {
    return (
      <div className="recipe-recommendations empty">
        <span>Recommended Label Layouts</span>
        <p>Enter width, length, repeat, face, or liner to find close layout matches.</p>
      </div>
    );
  }

  return (
    <div className="recipe-recommendations" aria-live="polite">
      <span>Recommended Label Layouts</span>
      <div>
        {candidates.map(({ recipe, matches }) => (
          <button
            key={recipe.id}
            type="button"
            className={String(recipe.id) === String(value) ? "active" : ""}
            onClick={() => onPick(recipe.id)}
          >
            <strong>{recipe.name || getRecordTitle(recipe)}</strong>
            <em>{recipeLayoutLine(recipe) || "Layout details missing"}</em>
            <small>{matches.join(", ")} match{matches.length === 1 ? "" : "es"}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function makeSearchText(row, field) {
  const parts = [getRecordTitle(row)];
  (field.searchFields ?? []).forEach((key) => parts.push(row?.[key], row?.[`${key}_name`], row?.[`${key}_label`]));
  Object.entries(row ?? {}).forEach(([key, value]) => {
    if (["string", "number", "boolean"].includes(typeof value)) parts.push(value);
    if (key.endsWith("_name") || key.endsWith("_label")) parts.push(value);
  });
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function matchesLookupFilters(row, filters = {}) {
  return Object.entries(filters ?? {}).every(([key, expected]) => {
    const actual = row?.[key];
    if (Array.isArray(expected)) return expected.map(String).includes(String(actual ?? ""));
    return String(actual ?? "") === String(expected);
  });
}

function scopeRows(rows, field) {
  if (!field.lookupFilters) return rows;
  return rows.filter((row) => matchesLookupFilters(row, field.lookupFilters));
}

function familyKey(row) {
  return row.material_family || row.name || getRecordTitle(row);
}

function groupRowsByFamily(rows, field) {
  if (!field.groupByFamily) return rows;

  const grouped = new Map();
  rows.forEach((row) => {
    const key = familyKey(row);
    if (!grouped.has(key)) {
      grouped.set(key, {
        ...row,
        family_option_count: 1,
        family_supplier_names: row.supplier_name ? [row.supplier_name] : [],
      });
      return;
    }

    const existing = grouped.get(key);
    existing.family_option_count += 1;
    if (row.supplier_name && !existing.family_supplier_names.includes(row.supplier_name)) {
      existing.family_supplier_names.push(row.supplier_name);
    }
  });

  return Array.from(grouped.values());
}

function getFieldLookupFilters(field, form) {
  const filters = { ...(field.lookupFilters ?? {}) };
  Object.entries(field.lookupFiltersFrom ?? {}).forEach(([lookupKey, formKey]) => {
    const value = form[formKey];
    if (value !== "" && value !== null && value !== undefined) filters[lookupKey] = value;
  });
  return Object.keys(filters).length ? filters : null;
}

function getRelationTitle(row, field) {
  if (!row) return "";
  if (field.display) return field.display(row);

  if (field.relation === "recipe-options") {
    const recipe = row.recipe_name ?? row.recipe_details?.name ?? "";
    const press = row.press_name ?? row.press_details?.name ?? "";
    const name = row.name ?? getRecordTitle(row);
    return [recipe, press, name].filter(Boolean).join(" / ");
  }

  if (field.relation === "raw-materials") {
    return [
      row.material_master_type_code,
      row.material_family,
      row.material_name ?? row.name ?? getRecordTitle(row),
      row.material_code,
      row.lot_number,
      row.width_inches ? `${row.width_inches}"` : "",
      row.location_name,
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "job-tickets") {
    return [
      row.ticket_number,
      row.customer_name,
      row.job_name ?? row.product_name,
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "customers") {
    if (field.displayMode === "nameOnly") return row.name ?? getRecordTitle(row);
    return [
      row.name ?? getRecordTitle(row),
      row.customer_code,
      row.contact_name,
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "materials") {
    if (field.lookupFilters?.material_type === "coated_stock" || row.material_type === "coated_stock") {
      const type = row.master_type_code || row.material_family || row.code;
      const description = row.name ?? getRecordTitle(row);
      return [type, description && description !== type ? description : "", row.code && row.code !== type ? row.code : ""]
        .filter(Boolean)
        .join(" / ");
    }

    if (field.groupByFamily) {
      return [
        row.material_family || row.name || getRecordTitle(row),
        `${row.family_option_count ?? 1} supplier option${(row.family_option_count ?? 1) === 1 ? "" : "s"}`,
        row.family_supplier_names?.slice(0, 3).join(", "),
      ].filter(Boolean).join(" / ");
    }

    return [
      row.code,
      row.master_type_code,
      row.material_type,
      row.company,
      row.name ?? getRecordTitle(row),
      row.material_family,
      row.gsm ? `${row.gsm} GSM` : "",
      row.liner_pounds ? `${row.liner_pounds}#` : "",
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "material-master-types") {
    return [
      row.code,
      row.name ?? getRecordTitle(row),
      row.is_active === false ? "Inactive" : "",
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "recipes") {
    return [
      row.name ?? getRecordTitle(row),
      recipeLayoutLine(row),
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "boxes") {
    return [
      row.item_number,
      row.name ?? getRecordTitle(row),
      row.supplier,
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "cores") {
    return [
      row.item_number,
      row.name ?? getRecordTitle(row),
      row.core_size_inches ? `${row.core_size_inches}"` : "",
      row.supplier,
    ].filter(Boolean).join(" / ");
  }

  if (field.relation === "flex-dies") {
    return `${row.name ?? getRecordTitle(row)}${row.gear ? ` · ${row.gear}T` : ""}${row.number_across && row.number_around ? ` · ${row.number_across}×${row.number_around}` : ""}`;
  }

  if (field.relation === "mags") {
    return `${row.name ?? getRecordTitle(row)}${row.tooth_count ? ` · ${row.tooth_count}T` : ""}`;
  }

  if (field.relation === "perf-cylinders") {
    return `${row.name ?? getRecordTitle(row)}${row.gear_tooth_count ? ` · ${row.gear_tooth_count}T` : ""}`;
  }

  if (field.relation === "perf-blade-setups") {
    return `${row.name ?? getRecordTitle(row)}${row.perf_cylinder_name ? ` · ${row.perf_cylinder_name}` : ""}`;
  }

  return getRecordTitle(row);
}

function getRelationSubtitle(row, field) {
  if (field.relation === "recipes") {
    return [
      row.shape_type,
      row.cutting_type,
      row.perf_option === "perf" ? "Perf" : row.perf_option === "none" ? "No Perf" : "",
    ].filter(Boolean).join(" / ");
  }

  return [row.status, row.current_location_name, row.press_name, row.recipe_name].filter(Boolean).join(" · ");
}

function lookupChoiceValue(row, field) {
  if (!row) return "";
  const valueField = field.lookupValueField ?? "name";
  return row[valueField] ?? row.name ?? row.code ?? getRecordTitle(row);
}

function lookupChoiceLabel(row, field) {
  if (!row) return "";
  const parts = (field.lookupLabelFields ?? ["name", "code"]).map((key) => {
    const value = row[key];
    if (key === "liner_pounds" && value) return `${value}#`;
    return value;
  });
  return parts.filter(Boolean).join(" / ") || getRecordTitle(row);
}

function RelationPicker({ field, rows, value, onChange, id, required }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const scopedRows = useMemo(() => scopeRows(rows, field), [rows, field]);
  const optionRows = useMemo(() => groupRowsByFamily(scopedRows, field), [scopedRows, field]);
  const selected = scopedRows.find((row) => Number(row.id) === Number(value)) ?? rows.find((row) => Number(row.id) === Number(value));
  const selectedGroup = selected && optionRows.find((row) => familyKey(row) === familyKey(selected));

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q ? optionRows.filter((row) => makeSearchText(row, field).includes(q) || getRelationTitle(row, field).toLowerCase().includes(q)) : optionRows;
    const sorted = field.recommendFromJobLayout
      ? [...base].sort((a, b) => recipeMatchScore(b, field.recommendationContext ?? {}) - recipeMatchScore(a, field.recommendationContext ?? {}) || String(a.name ?? "").localeCompare(String(b.name ?? ""), undefined, { numeric: true }))
      : base;
    return sorted.slice(0, field.maxResults ?? 80);
  }, [optionRows, query, field]);

  return (
    <div className="lookup-picker" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }}>
      <input id={id} type="hidden" value={value ?? ""} required={required} readOnly />
      <button type="button" className="lookup-selected" onClick={() => setOpen((prev) => !prev)}>
        <span>{selected ? getRelationTitle({ ...selected, family_option_count: selectedGroup?.family_option_count, family_supplier_names: selectedGroup?.family_supplier_names }, field) : "Select..."}</span>
        {selected && <X size={13} onClick={(event) => { event.stopPropagation(); onChange(""); setQuery(""); }} />}
      </button>

      {open && (
        <div className="lookup-menu">
          <div className="lookup-search">
            <Search size={14} />
            <input autoFocus value={query} placeholder={`Search ${field.label.toLowerCase()}...`} onChange={(event) => setQuery(event.target.value)} />
          </div>
          <div className="lookup-results">
            {filtered.map((row) => (
              <button key={row.id} type="button" className={Number(row.id) === Number(value) ? "selected" : ""} onClick={() => { onChange(Number(row.id)); setOpen(false); setQuery(""); }}>
                <strong>{getRelationTitle(row, field)}</strong>
                <span>{[row.status, row.current_location_name, row.press_name, row.recipe_name].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
            {!filtered.length && <p>No matches found.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

export default function RecordForm({ resource, record, defaults = {}, lookups = {}, onSubmit, onCancel, submitting, canUseField = () => true }) {
  const fields = resource.fields ?? [];
  const [form, setForm] = useState(() => normalizeInitial(fields, record, defaults));
  const [activeFormTab, setActiveFormTab] = useState("");

  useEffect(() => {
    setForm(normalizeInitial(fields, record, defaults));
  }, [resource.key, record?.id, JSON.stringify(defaults)]);

  const title = record ? `Edit ${resource.singular}` : `Add ${resource.singular}`;
  const allVisibleFields = useMemo(
    () => fields.filter((field) => !field.readOnly && !field.hidden && canUseField(field) && shouldShow(field, form)),
    [fields, form, canUseField]
  );
  const formTabs = useMemo(() => Array.from(new Set(allVisibleFields.map(getFieldTab))), [allVisibleFields]);
  const formTabsKey = formTabs.join("|");
  const currentFormTab = activeFormTab || formTabs[0] || "";
  const visibleFields = useMemo(
    () => (formTabs.length > 1 ? allVisibleFields.filter((field) => getFieldTab(field) === currentFormTab) : allVisibleFields),
    [allVisibleFields, currentFormTab, formTabs.length]
  );
  const tsmIdRecommendation = useMemo(
    () => (resource.key === "job-tickets" && !record ? buildTsmIdRecommendation(form, lookups, record) : null),
    [form, lookups, record, resource.key]
  );

  useEffect(() => {
    if (!formTabs.length) return;
    if (!activeFormTab || !formTabs.includes(activeFormTab)) setActiveFormTab(formTabs[0]);
  }, [activeFormTab, formTabsKey]);

  function update(name, value) {
    setForm((prev) => clearHiddenFields(fields, { ...prev, [name]: value }));
  }

  function cleanPayload() {
    const payload = {};
    const imageUploads = [];
    fields.forEach((field) => {
      if (field.readOnly) return;
      if (!canUseField(field)) return;
      const visible = shouldShow(field, form);
      const rawValue = visible ? form[field.name] : getEmptyValueForField(field);
      if (field.type === "imageUpload") {
        if (rawValue instanceof File) {
          imageUploads.push({ slot: field.imageSlot, file: rawValue });
        }
        return;
      }
      payload[field.name] = formatValueForPayload(field, rawValue);
    });
    if (resource.endpoint === "materials" && !payload.code) {
      payload.code = generatedMaterialCode(payload.material_type);
    }
    if (imageUploads.length) payload.__imageUploads = imageUploads;
    return payload;
  }

  return (
    <section className={`form-panel compact-card ${resource.key}-form-panel`}>
      <div className="panel-head">
        <div>
          <p className="eyebrow">{title}</p>
          <h2>{record ? getRecordTitle(record) : resource.label}</h2>
        </div>
        <button className="ghost-btn" type="button" onClick={onCancel}>Close</button>
      </div>

      <form className={`record-form ${resource.key}-record-form`} onSubmit={(event) => { event.preventDefault(); onSubmit(cleanPayload()); }}>
        {formTabs.length > 1 && (
          <div className="record-form-tabs" role="tablist" aria-label={`${resource.singular} sections`}>
            {formTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                className={currentFormTab === tab ? "active" : ""}
                onClick={() => setActiveFormTab(tab)}
              >
                {tab}
              </button>
            ))}
          </div>
        )}

        {visibleFields.map((field, index) => {
          const fieldLabel = getFieldLabel(field, form);
          const lookupField = { ...field, label: fieldLabel, lookupFilters: getFieldLookupFilters(field, form), recommendationContext: form };
          const value = form[field.name];
          const id = `${resource.key}-${field.name}`;
          const isTsmIdField = resource.key === "job-tickets" && field.name === "product_code";
          const tsmToneClass = isTsmIdField && tsmIdRecommendation?.inputTone ? ` tsm-id-field ${tsmIdRecommendation.inputTone}` : "";
          const fieldClass = `field field-${field.name}${tsmToneClass}`;
          const fieldWideClass = `${fieldClass} field-wide`;
          const sectionHeading = field.section && field.section !== visibleFields[index - 1]?.section
            ? <div className="form-section-heading"><strong>{field.section}</strong>{field.sectionHint && <span>{field.sectionHint}</span>}</div>
            : null;

          if (field.type === "textarea") {
            return (
              <Fragment key={field.name}>
                {sectionHeading}
                <label className={fieldWideClass} htmlFor={id}>
                  <span>{fieldLabel}</span>
                  <textarea id={id} value={value ?? ""} placeholder={field.placeholder ?? ""} required={field.required} onChange={(event) => update(field.name, event.target.value)} />
                </label>
              </Fragment>
            );
          }

          if (field.type === "checkbox") {
            return (
              <Fragment key={field.name}>
                {sectionHeading}
                <label className={`check-field field-${field.name}`} htmlFor={id}>
                  <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => update(field.name, event.target.checked)} />
                  <span>{fieldLabel}{field.helpText && <small>{field.helpText}</small>}</span>
                </label>
              </Fragment>
            );
          }

          if (field.type === "imageUpload") {
            const existingImage = record?.job_images?.find((image) => image.slot === field.imageSlot);
            const existingUrl = record?.[`${field.imageSlot}_image_url`] || record?.[`${field.imageSlot}_image`] || existingImage?.url;
            const existingName = record?.[`${field.imageSlot}_image_name`] || existingImage?.name;
            const existingSource = existingImage?.source;
            const existingIsDocument = existingImage?.isDocument || isPdfUrl(existingUrl);
            return (
              <Fragment key={field.name}>
                {sectionHeading}
                <label className={`${fieldClass} image-upload-field`} htmlFor={id}>
                  <span>{fieldLabel}</span>
                  <div>
                    {existingUrl && !existingIsDocument ? (
                      <img src={existingUrl} alt={existingName || fieldLabel} />
                    ) : existingUrl ? (
                      <PdfPreview url={existingUrl} title={existingName || fieldLabel} compact />
                    ) : (
                      <em>No image uploaded</em>
                    )}
                    <input id={id} type="file" accept="image/*,application/pdf,.pdf" onChange={(event) => update(field.name, event.target.files?.[0] ?? null)} />
                    <strong>{value?.name || existingName || "Choose image"}</strong>
                    {existingSource && <small>{existingSource}</small>}
                  </div>
                </label>
              </Fragment>
            );
          }

          if (field.type === "select") {
            const lookupRows = field.lookupRelation
              ? scopeRows(lookups[field.lookupRelation] ?? [], lookupField)
              : [];
            const dynamicChoices = lookupRows.map((row) => [lookupChoiceValue(row, field), lookupChoiceLabel(row, field)]);
            const choices = dynamicChoices.length ? dynamicChoices : (field.choices ?? []);
            const valueExists = choices.some(([choiceValue]) => String(choiceValue) === String(value ?? ""));
            return (
              <Fragment key={field.name}>
                {sectionHeading}
                <label className={fieldClass} htmlFor={id}>
                  <span>{fieldLabel}</span>
                  <select id={id} value={value ?? ""} required={field.required} onChange={(event) => update(field.name, event.target.value)}>
                    {!field.required && <option value="">Select...</option>}
                    {value && !valueExists && <option value={value}>{value}</option>}
                    {choices.map(([choiceValue, label]) => <option key={choiceValue} value={choiceValue}>{label}</option>)}
                  </select>
                  {field.helpText && <small>{field.helpText}</small>}
                </label>
              </Fragment>
            );
          }

          if (field.type === "searchRelation" || (field.type === "relation" && field.searchable)) {
            const rows = lookups[field.relation] ?? [];
            return (
              <Fragment key={field.name}>
                {sectionHeading}
                <label className={fieldClass} htmlFor={id}>
                  <span>{fieldLabel}</span>
                  <RelationPicker field={lookupField} rows={rows} value={value} id={id} required={field.required} onChange={(next) => update(field.name, next)} />
                  {resource.key === "job-tickets" && field.name === "recipe" && (
                    <RecipeRecommendationPanel recipes={rows} form={form} value={value} onPick={(next) => update(field.name, next)} />
                  )}
                </label>
              </Fragment>
            );
          }

          if (field.type === "relation") {
            const rows = scopeRows(lookups[field.relation] ?? [], lookupField);
            return (
              <Fragment key={field.name}>
                {sectionHeading}
                <label className={fieldClass} htmlFor={id}>
                  <span>{fieldLabel}</span>
                  <select id={id} value={value ?? ""} required={field.required} onChange={(event) => update(field.name, event.target.value ? Number(event.target.value) : "")}>
                    <option value="">Select...</option>
                    {rows.map((row) => <option key={row.id} value={row.id}>{getRelationTitle(row, lookupField)}</option>)}
                  </select>
                </label>
              </Fragment>
            );
          }

          if (field.type === "multiRelation") {
            const rows = scopeRows(lookups[field.relation] ?? [], lookupField);
            const selected = Array.isArray(value) ? value.map(Number) : [];
            return (
              <Fragment key={field.name}>
                {sectionHeading}
                <label className={fieldWideClass} htmlFor={id}>
                  <span>{fieldLabel}</span>
                  <select id={id} multiple value={selected.map(String)} onChange={(event) => update(field.name, Array.from(event.target.selectedOptions).map((option) => Number(option.value)))}>
                    {rows.map((row) => <option key={row.id} value={row.id}>{getRelationTitle(row, lookupField)}</option>)}
                  </select>
                  <small>Hold Ctrl to pick multiple.</small>
                </label>
              </Fragment>
            );
          }

          return (
            <Fragment key={field.name}>
              {sectionHeading}
              <label className={fieldClass} htmlFor={id}>
                <span>{fieldLabel}</span>
                <input id={id} className={isTsmIdField && tsmIdRecommendation?.inputTone ? `tsm-id-input ${tsmIdRecommendation.inputTone}` : undefined} type={field.type ?? "text"} step={field.step} required={field.required} value={value ?? ""} placeholder={field.placeholder ?? ""} onChange={(event) => update(field.name, event.target.value)} />
                {field.helpText && <small>{field.helpText}</small>}
                {isTsmIdField && tsmIdRecommendation && (
                  <TsmIdRecommendationPanel recommendation={tsmIdRecommendation} onPick={(next) => update(field.name, next)} />
                )}
              </label>
            </Fragment>
          );
        })}

        <div className="form-actions">
          <button className="ghost-btn" type="button" onClick={onCancel}>Cancel</button>
          <button className="primary-btn" type="submit" disabled={submitting}>{submitting ? "Saving..." : "Save"}</button>
        </div>
      </form>
    </section>
  );
}
