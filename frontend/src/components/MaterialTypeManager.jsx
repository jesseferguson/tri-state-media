import { useEffect, useMemo, useState } from "react";
import { Edit3, Plus, Search, Trash2, X } from "lucide-react";

const emptyForm = {
  code: "",
  name: "",
  description: "",
  is_active: true,
};

function normalizeForm(record) {
  if (!record) return emptyForm;
  return {
    code: record.code || "",
    name: record.name || "",
    description: record.description || "",
    is_active: record.is_active !== false,
  };
}

function materialTitle(row) {
  return row.name && row.name !== row.code ? `${row.code} - ${row.name}` : row.code || row.name || "Material Type";
}

function materialSearchText(row) {
  return [row.code, row.name, row.description, row.is_active === false ? "inactive" : "active"]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function MaterialTypeManager({ rows = [], saving = false, deleting = false, canDelete = false, onClose, onSave, onDelete }) {
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  useEffect(() => {
    setForm(normalizeForm(editing));
  }, [editing?.id]);

  const activeCount = useMemo(() => rows.filter((row) => row.is_active !== false).length, [rows]);
  const inactiveCount = rows.length - activeCount;
  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (statusFilter === "active" && row.is_active === false) return false;
        if (statusFilter === "inactive" && row.is_active !== false) return false;
        return !normalizedQuery || materialSearchText(row).includes(normalizedQuery);
      })
      .sort((left, right) => String(left.code || left.name || "").localeCompare(String(right.code || right.name || ""), undefined, { numeric: true }));
  }, [rows, query, statusFilter]);

  function update(name, value) {
    setForm((prev) => ({ ...prev, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    try {
      await onSave?.({ mode: editing ? "edit" : "create", record: editing, payload: form });
      setEditing(null);
      setForm(emptyForm);
    } catch {}
  }

  async function remove(row) {
    if (!window.confirm(`Delete ${materialTitle(row)}? This cannot be undone.`)) return;
    try {
      await onDelete?.(row);
      if (editing?.id === row.id) setEditing(null);
    } catch {}
  }

  return (
    <section className="material-type-overlay" role="dialog" aria-modal="true" aria-label="Material types">
      <div className="material-type-window compact-card">
        <header className="material-type-head">
          <div>
            <p className="eyebrow">Material Setup</p>
            <h2>Material Types</h2>
            <p>Broad families such as PM, PM/PET, PET, LPO, or LV.</p>
          </div>
          <button className="ghost-btn" type="button" onClick={onClose}>
            <X size={16} /> Close
          </button>
        </header>

        <div className="material-setup-explain">
          <article>
            <strong>Material Type</strong>
            <span>Quote and job-ticket family.</span>
            <em>PM, PM/PET, PET</em>
          </article>
          <article>
            <strong>Material</strong>
            <span>Coated construction with face, liner, adhesive, and silicone.</span>
            <em>PM 40# permanent coated stock</em>
          </article>
        </div>

        <div className="material-type-layout">
          <form className="material-type-form" onSubmit={submit}>
            <div className="type-section-head">
              <strong>{editing ? "Edit Material Type" : "Add Material Type"}</strong>
              {editing && (
                <button className="ghost-btn xs" type="button" onClick={() => setEditing(null)}>
                  <Plus size={13} /> New
                </button>
              )}
            </div>
            <label>
              <span>Type Code</span>
              <input value={form.code} onChange={(event) => update("code", event.target.value.toUpperCase())} placeholder="PM" required />
            </label>
            <label>
              <span>Name</span>
              <input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Poly Matte" required />
            </label>
            <label className="field-wide">
              <span>Description</span>
              <textarea value={form.description} onChange={(event) => update("description", event.target.value)} />
            </label>
            <label className="check-field">
              <input type="checkbox" checked={form.is_active} onChange={(event) => update("is_active", event.target.checked)} />
              <span>Active</span>
            </label>
            <div className="form-actions">
              <button className="primary-btn" type="submit" disabled={saving}>
                {saving ? "Saving..." : editing ? "Save Type" : "Add Type"}
              </button>
            </div>
          </form>

          <section className="material-type-list">
            <div className="type-section-head">
              <strong>{filteredRows.length} of {rows.length} Material Type{rows.length === 1 ? "" : "s"}</strong>
              <span>{activeCount} active / {inactiveCount} inactive</span>
            </div>
            <div className="material-type-list-tools">
              <label>
                <Search size={15} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search code, name, or description" />
              </label>
              <div>
                {[
                  ["all", "All"],
                  ["active", "Active"],
                  ["inactive", "Inactive"],
                ].map(([value, label]) => (
                  <button className={statusFilter === value ? "active" : ""} type="button" onClick={() => setStatusFilter(value)} key={value}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="material-type-list-scroll">
              {filteredRows.length ? (
                filteredRows.map((row) => (
                  <article className={row.is_active === false ? "inactive" : ""} key={row.id}>
                    <div className="material-type-code-card">
                      <strong>{row.code || "--"}</strong>
                      <span>{row.is_active === false ? "Inactive" : "Active"}</span>
                    </div>
                    <div className="material-type-row-copy">
                      <strong>{row.name || row.code || "Material Type"}</strong>
                      <span>{row.description || "No description"}</span>
                    </div>
                    <div className="row-actions">
                      <button className="ghost-btn xs" type="button" onClick={() => setEditing(row)}>
                        <Edit3 size={13} /> Edit
                      </button>
                      {canDelete && (
                        <button className="danger-btn xs" type="button" onClick={() => remove(row)} disabled={deleting}>
                          <Trash2 size={13} /> Delete
                        </button>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <p className="muted">No material types match this search.</p>
              )}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
}
