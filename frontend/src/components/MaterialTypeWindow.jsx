import { Edit3, Plus, X } from "lucide-react";
import { getRecordTitle, labelize } from "../lib/format";

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

function optionTitle(option) {
  return option.option_name || option.supplier_item_number || option.supplier_name || "Supplier option";
}

export default function MaterialTypeWindow({ material, options, onClose, onEdit, onAddSupplierOption, onEditSupplierOption }) {
  const activeOptions = (options ?? []).filter((option) => option.is_active !== false);
  const summaryItems = [
    ["Code", material.code],
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
              <Plus size={15} /> Supplier Option
            </button>
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
            <strong>Supplier Options</strong>
            <span>{activeOptions.length} active / {(options ?? []).length} total</span>
          </div>

          {options?.length ? (
            <div className="type-option-list">
              {options.map((option) => (
                <details key={option.id} className={`type-option-card ${option.is_active === false ? "inactive" : ""}`}>
                  <summary>
                    <div>
                      <strong>{optionTitle(option)}</strong>
                      <span>{option.supplier_name || option.supplier_lookup_name || "No supplier"}</span>
                    </div>
                    <div>
                      <span>Item #</span>
                      <strong>{option.supplier_item_number || "--"}</strong>
                    </div>
                    <div>
                      <span>Mil</span>
                      <strong>{option.thickness_mil || "--"}</strong>
                    </div>
                    <div>
                      <span>Width</span>
                      <strong>{option.width_inches || "--"}</strong>
                    </div>
                    <div>
                      <span>Length</span>
                      <strong>{option.length_feet || "--"}</strong>
                    </div>
                  </summary>
                  <div className="type-option-detail">
                    <Detail label="Supplier" value={option.supplier_name || option.supplier_lookup_name} />
                    <Detail label="Supplier Item #" value={option.supplier_item_number} />
                    <Detail label="Status" value={option.is_active === false ? "Inactive" : "Active"} />
                    <Detail label="Notes" value={option.notes} />
                    <button className="ghost-btn xs" type="button" onClick={() => onEditSupplierOption(option)}>
                      <Edit3 size={13} /> Edit Supplier Option
                    </button>
                  </div>
                </details>
              ))}
            </div>
          ) : (
            <p className="muted">No supplier options are linked to this data type yet.</p>
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
