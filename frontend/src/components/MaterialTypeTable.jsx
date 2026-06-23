import { ChevronDown, Edit3, Gauge, Plus, Ruler, Store, Tag, Trash2 } from "lucide-react";
import { formatFeet, formatInches, getRecordTitle, labelize } from "../lib/format";

function supplierName(option) {
  return option.supplier_lookup_name || option.supplier_name || "No supplier";
}

function optionCode(option) {
  return option.supplier_item_number || option.code || "--";
}

function formatMil(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  return Number.isFinite(number) ? `${number.toLocaleString(undefined, { maximumFractionDigits: 3 })} mil` : String(value);
}

function materialSubtitle(material) {
  return [
    material.color,
    material.material_type === "liner" && material.liner_pounds ? `${material.liner_pounds} lb liner` : "",
    material.is_active === false ? "Inactive" : "Active",
  ].filter(Boolean).join(" / ");
}

function groupedOptions(options) {
  return (options ?? []).reduce((acc, option) => {
    const key = String(option.material);
    if (!acc[key]) acc[key] = [];
    acc[key].push(option);
    return acc;
  }, {});
}

function supplierStats(options) {
  const active = options.filter((option) => option.is_active !== false);
  const suppliers = new Set(active.map(supplierName).filter((name) => name && name !== "No supplier"));
  const widths = new Set(active.map((option) => option.width_inches).filter((value) => value !== null && value !== undefined && value !== ""));
  const thicknesses = active
    .map((option) => Number(option.thickness_mil))
    .filter(Number.isFinite)
    .sort((a, b) => a - b);
  const thicknessRange = thicknesses.length
    ? thicknesses[0] === thicknesses.at(-1)
      ? formatMil(thicknesses[0])
      : `${formatMil(thicknesses[0])} - ${formatMil(thicknesses.at(-1))}`
    : "--";

  return {
    activeCount: active.length,
    supplierCount: suppliers.size,
    widthCount: widths.size,
    thicknessRange,
  };
}

function SupplierMetric({ icon: Icon, label, value }) {
  return (
    <div>
      <Icon size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function SupplierRows({ options, onEditSupplierOption }) {
  if (!options.length) {
    return (
      <div className="material-type-supplier-empty">
        <Store size={20} />
        <strong>No supplier options yet.</strong>
      </div>
    );
  }

  return (
    <div className="material-type-supplier-list">
      {options.map((option) => (
        <article className={option.is_active === false ? "inactive" : ""} key={option.id}>
          <div>
            <span>Supplier</span>
            <strong>{supplierName(option)}</strong>
          </div>
          <div>
            <span>Code</span>
            <strong>{optionCode(option)}</strong>
          </div>
          <div>
            <span>Thickness</span>
            <strong>{formatMil(option.thickness_mil)}</strong>
          </div>
          <div>
            <span>Width</span>
            <strong>{formatInches(option.width_inches)}</strong>
          </div>
          <div>
            <span>Length</span>
            <strong>{formatFeet(option.length_feet)}</strong>
          </div>
          <button className="ghost-btn xs" type="button" onClick={() => onEditSupplierOption(option)}>
            <Edit3 size={13} /> Edit
          </button>
        </article>
      ))}
    </div>
  );
}

export default function MaterialTypeTable({ rows, options, selectedId, onSelect, onEdit, onDelete, onAddSupplierOption, onEditSupplierOption }) {
  const optionsByMaterial = groupedOptions(options);

  return (
    <div className="material-type-main-table">
      {rows.map((material) => {
        const materialOptions = [...(optionsByMaterial[String(material.id)] ?? [])].sort((a, b) => {
          const activeSort = Number(b.is_active !== false) - Number(a.is_active !== false);
          if (activeSort) return activeSort;
          return supplierName(a).localeCompare(supplierName(b), undefined, { numeric: true });
        });
        const stats = supplierStats(materialOptions);
        const subtitle = materialSubtitle(material);

        return (
          <details
            className={`material-type-row ${selectedId === material.id ? "selected" : ""} ${material.is_active === false ? "inactive" : ""}`}
            key={material.id}
            onToggle={(event) => {
              if (event.currentTarget.open) onSelect?.(material);
            }}
          >
            <summary>
              <div className="material-type-title-cell">
                <span className="material-type-kind">{labelize(material.material_type)}</span>
                <strong>{getRecordTitle(material)}</strong>
                {subtitle && <em>{subtitle}</em>}
              </div>

              <div className="material-type-supplier-metrics">
                <SupplierMetric icon={Store} label="Suppliers" value={stats.supplierCount.toLocaleString()} />
                <SupplierMetric icon={Ruler} label="Widths" value={stats.widthCount.toLocaleString()} />
                <SupplierMetric icon={Gauge} label="Thickness" value={stats.thicknessRange} />
                <SupplierMetric icon={Tag} label="Options" value={`${stats.activeCount}/${materialOptions.length}`} />
              </div>

              <ChevronDown className="material-type-row-chevron" size={20} />
            </summary>

            <div className="material-type-row-body">
              <div className="material-type-row-actions">
                <button className="ghost-btn xs" type="button" onClick={() => onEdit(material)}>
                  <Edit3 size={13} /> Edit Data Type
                </button>
                <button className="primary-btn xs" type="button" onClick={() => onAddSupplierOption(material)}>
                  <Plus size={13} /> Add Supplier
                </button>
                {onDelete && (
                  <button className="danger-btn xs" type="button" onClick={() => onDelete(material)}>
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
              <SupplierRows options={materialOptions} onEditSupplierOption={onEditSupplierOption} />
            </div>
          </details>
        );
      })}
      {!rows.length && <p className="empty-row">No records match this view.</p>}
    </div>
  );
}
