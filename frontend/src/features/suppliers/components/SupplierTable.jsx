import { ChevronDown, Edit3, Mail, Phone, Store, Tag, Trash2 } from "lucide-react";
import { getRecordTitle } from "../../../lib/format";

function splitTags(tags) {
  return String(tags || "")
    .split(/[,;]+/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function supplierGroups(rows) {
  const groups = new Map();
  rows.forEach((row) => {
    const tags = splitTags(row.tags);
    (tags.length ? tags : ["untagged"]).forEach((tag) => {
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(row);
    });
  });
  return Array.from(groups.entries())
    .sort(([left], [right]) => {
      if (left === "untagged") return 1;
      if (right === "untagged") return -1;
      return left.localeCompare(right);
    });
}

function locationLine(row) {
  return [row.city, row.state, row.zip_code].filter(Boolean).join(", ");
}

function addressLines(row) {
  return [
    row.address_line_1,
    row.address_line_2,
    [row.city, row.state, row.zip_code].filter(Boolean).join(", "),
    row.country,
  ].filter(Boolean);
}

function contactCount(row) {
  return [row.phone, row.email].filter(Boolean).length;
}

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
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

export default function SupplierTable({ rows, onEdit, onDelete }) {
  return (
    <div className="supplier-main-table">
      {supplierGroups(rows).map(([group, groupRows]) => (
        <section className="supplier-tag-group" key={group}>
          <header>
            <div><Tag size={15} /><strong>{group}</strong></div>
            <span>{groupRows.length} supplier{groupRows.length === 1 ? "" : "s"}</span>
          </header>
          <div>
            {groupRows.map((row) => {
              const tags = splitTags(row.tags);
              const location = locationLine(row);
              const address = addressLines(row);

              return (
                <details
                  className={`supplier-row ${row.is_active === false ? "inactive" : ""}`}
                  key={`${group}-${row.id}`}
                >
                  <summary>
                    <div className="supplier-title-cell">
                      <span className="supplier-icon"><Store size={16} /></span>
                      <div>
                        <strong>{getRecordTitle(row)}</strong>
                        <em>{location || "No location saved"}</em>
                      </div>
                      <b className={row.is_active === false ? "inactive" : "active"}>{row.is_active === false ? "Inactive" : "Active"}</b>
                    </div>

                    <div className="supplier-chip-strip">
                      {tags.length ? tags.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>) : <span>No tags</span>}
                      {tags.length > 5 && <span>+{tags.length - 5}</span>}
                    </div>

                    <div className="supplier-metrics">
                      <SupplierMetric icon={Phone} label="Phone" value={row.phone || "--"} />
                      <SupplierMetric icon={Mail} label="Email" value={row.email || "--"} />
                      <SupplierMetric icon={Tag} label="Tags" value={tags.length.toLocaleString()} />
                    </div>

                    <ChevronDown className="supplier-row-chevron" size={20} />
                  </summary>

                  <div className="supplier-row-body">
                    <div className="supplier-detail-grid">
                      <Detail label="Phone" value={row.phone} />
                      <Detail label="Email" value={row.email} />
                      <Detail label="Contact Methods" value={`${contactCount(row)} saved`} />
                      <Detail label="Location" value={location} />
                      <Detail label="Address" value={address.join(" / ")} />
                      <Detail label="Notes" value={row.notes} />
                    </div>

                    <div className="supplier-row-actions">
                      {row.phone && <a className="ghost-btn xs" href={`tel:${row.phone}`}><Phone size={13} /> Call</a>}
                      {row.email && <a className="ghost-btn xs" href={`mailto:${row.email}`}><Mail size={13} /> Email</a>}
                      <button className="ghost-btn xs" type="button" onClick={() => onEdit(row)}><Edit3 size={13} /> Edit</button>
                      {onDelete && <button className="danger-btn xs" type="button" onClick={() => onDelete(row)}><Trash2 size={13} /> Delete</button>}
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      ))}
      {!rows.length && <p className="empty-row">No suppliers match this view.</p>}
    </div>
  );
}
