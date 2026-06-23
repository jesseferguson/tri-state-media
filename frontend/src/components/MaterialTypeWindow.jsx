import { ChevronDown, Edit3, Gauge, Plus, Ruler, Store, Tag, Trash2, X } from "lucide-react";
import { formatFeet, formatInches, getRecordTitle, labelize } from "../lib/format";

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

function optionTitle(option) {
  return option.option_name || option.supplier_item_number || option.supplier_lookup_name || option.supplier_name || "Supplier option";
}

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

function SupplierStat({ icon: Icon, label, value }) {
  return (
    <article>
      <Icon size={16} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function SupplierOptionCard({ option, onEdit }) {
  const active = option.is_active !== false;

  return (
    <details className={`type-option-card supplier-option-card ${active ? "active" : "inactive"}`}>
      <summary>
        <div className="supplier-option-main">
          <span className="supplier-option-icon"><Store size={16} /></span>
          <div>
            <strong>{supplierName(option)}</strong>
            <span>{optionTitle(option)}</span>
          </div>
          <em className={`supplier-status ${active ? "ready" : "inactive"}`}>{active ? "Active" : "Inactive"}</em>
        </div>
        <div className="supplier-option-metric">
          <span>Code</span>
          <strong>{optionCode(option)}</strong>
        </div>
        <div className="supplier-option-metric">
          <span>Thickness</span>
          <strong>{formatMil(option.thickness_mil)}</strong>
        </div>
        <div className="supplier-option-metric">
          <span>Width</span>
          <strong>{formatInches(option.width_inches)}</strong>
        </div>
        <ChevronDown className="supplier-option-chevron" size={18} />
      </summary>
      <div className="type-option-detail supplier-option-detail">
        <Detail label="Supplier" value={supplierName(option)} />
        <Detail label="Code" value={optionCode(option)} />
        <Detail label="Thickness" value={formatMil(option.thickness_mil)} />
        <Detail label="Width" value={formatInches(option.width_inches)} />
        <Detail label="Length" value={formatFeet(option.length_feet)} />
        <Detail label="Notes" value={option.notes} />
        <button className="ghost-btn xs" type="button" onClick={() => onEdit(option)}>
          <Edit3 size={13} /> Edit Supplier Option
        </button>
      </div>
    </details>
  );
}

export default function MaterialTypeWindow({ material, options, onClose, onEdit, onDelete, onAddSupplierOption, onEditSupplierOption }) {
  const allOptions = [...(options ?? [])].sort((a, b) => {
    const activeSort = Number(b.is_active !== false) - Number(a.is_active !== false);
    if (activeSort) return activeSort;
    return supplierName(a).localeCompare(supplierName(b), undefined, { numeric: true });
  });
  const stats = supplierStats(allOptions);
  const summaryItems = [
    ...(material.material_type === "coated_stock" ? [["Code", material.code]] : []),
    ["Data Type", material.name],
    ["Type", labelize(material.material_type)],
    ["Color", material.color],
    ...(material.material_type === "liner" ? [["Liner Pounds", material.liner_pounds]] : []),
    ["Status", material.is_active === false ? "Inactive" : "Active"],
  ];

  return (
    <section className="type-overlay" role="dialog" aria-modal="true" aria-label="Material data type">
      <div className="type-window compact-card">
        <header className="type-window-head">
          <div>
            <p className="eyebrow">{labelize(material.material_type)} Data Type</p>
            <h2>{getRecordTitle(material)}</h2>
          </div>
          <div className="type-window-actions">
            <button className="ghost-btn" type="button" onClick={onEdit}>
              <Edit3 size={15} /> Edit
            </button>
            <button className="primary-btn" type="button" onClick={onAddSupplierOption}>
              <Plus size={15} /> Supplier / Purchase Option
            </button>
            {onDelete && (
              <button className="danger-btn" type="button" onClick={onDelete}>
                <Trash2 size={15} /> Delete
              </button>
            )}
            <button className="ghost-btn" type="button" onClick={onClose}>
              <X size={15} /> Close
            </button>
          </div>
        </header>

        <div className="type-summary-grid">
          {summaryItems.map(([label, value]) => <Detail key={label} label={label} value={value} />)}
        </div>

        <section className="type-options-panel">
          <div className="type-section-head">
            <div>
              <strong>Supplier / Purchase Options</strong>
              <span>{stats.activeCount} active / {allOptions.length} total</span>
            </div>
            <button className="primary-btn xs" type="button" onClick={onAddSupplierOption}>
              <Plus size={13} /> Add Supplier
            </button>
          </div>

          <div className="supplier-option-stats">
            <SupplierStat icon={Store} label="Suppliers" value={stats.supplierCount.toLocaleString()} />
            <SupplierStat icon={Ruler} label="Widths" value={stats.widthCount.toLocaleString()} />
            <SupplierStat icon={Gauge} label="Thickness" value={stats.thicknessRange} />
            <SupplierStat icon={Tag} label="Options" value={allOptions.length.toLocaleString()} />
          </div>

          {allOptions.length ? (
            <div className="type-option-list">
              {allOptions.map((option) => (
                <SupplierOptionCard key={option.id} option={option} onEdit={onEditSupplierOption} />
              ))}
            </div>
          ) : (
            <div className="supplier-option-empty">
              <Store size={22} />
              <strong>No supplier options linked yet.</strong>
              <button className="primary-btn" type="button" onClick={onAddSupplierOption}>
                <Plus size={15} /> Add Supplier Option
              </button>
            </div>
          )}
        </section>

        {material.notes && (
          <section className="type-notes">
            <strong>Notes</strong>
            <p>{material.notes}</p>
          </section>
        )}
      </div>
    </section>
  );
}
