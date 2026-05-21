import { Fragment, useEffect, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { getRecordTitle } from "../lib/format";
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
    return base.slice(0, field.maxResults ?? 80);
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

export default function RecordForm({ resource, record, defaults = {}, lookups, onSubmit, onCancel, submitting, canUseField = () => true }) {
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
          const lookupField = { ...field, label: fieldLabel, lookupFilters: getFieldLookupFilters(field, form) };
          const value = form[field.name];
          const id = `${resource.key}-${field.name}`;
          const fieldClass = `field field-${field.name}`;
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
                <input id={id} type={field.type ?? "text"} step={field.step} required={field.required} value={value ?? ""} placeholder={field.placeholder ?? ""} onChange={(event) => update(field.name, event.target.value)} />
                {field.helpText && <small>{field.helpText}</small>}
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
