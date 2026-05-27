import { MapPin, PackageMinus, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getRecordTitle, labelize } from "../lib/format";

function numeric(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function quantityText(row) {
  const qty = numeric(row.quantity);
  const unit = row.unit || "units";
  return `${qty.toLocaleString()} ${unit}`;
}

function locationText(row) {
  return row.location_full_path || row.location_name || "No location";
}

function stockTone(row) {
  const status = String(row.status || "").toLowerCase();
  if (["scrapped", "shipped"].includes(status) || numeric(row.quantity) <= 0) return "bad";
  if (["allocated", "on_hold"].includes(status)) return "hold";
  return "ready";
}

function itemTsm(row) {
  return row.job_ticket_product_code || row.imported_tsm_id || row.job_ticket_number || row.sku || "";
}

function groupByLocation(rows) {
  const groups = new Map();
  (rows ?? []).forEach((row) => {
    const location = locationText(row);
    if (!groups.has(location)) groups.set(location, { location, rows: [], total: 0 });
    const group = groups.get(location);
    group.rows.push(row);
    if (!["shipped", "scrapped"].includes(String(row.status || "").toLowerCase())) {
      group.total += numeric(row.quantity);
    }
  });
  return Array.from(groups.values()).sort((a, b) => a.location.localeCompare(b.location));
}

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

export function FinishedInventoryWindow({ item, usageRows = [], sending = false, onClose, onEdit, onSendOut }) {
  const [form, setForm] = useState({
    quantity: "",
    used_by: "",
    used_date: new Date().toISOString().slice(0, 10),
    reference: "",
    notes: "",
  });

  useEffect(() => {
    setForm({
      quantity: "",
      used_by: "",
      used_date: new Date().toISOString().slice(0, 10),
      reference: "",
      notes: "",
    });
  }, [item?.id]);

  if (!item) return null;

  const available = numeric(item.quantity);
  const canSend = available > 0 && !["shipped", "scrapped"].includes(String(item.status || "").toLowerCase());

  function update(name, value) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    await onSendOut?.({
      ...form,
      quantity: form.quantity === "" ? 0 : Number(form.quantity),
    });
    setForm((current) => ({ ...current, quantity: "", reference: "", notes: "" }));
  }

  return (
    <section className="finished-inventory-overlay" role="dialog" aria-modal="true" aria-label="Finished inventory details">
      <div className="finished-inventory-window">
        <header className="finished-inventory-window-head">
          <div>
            <p className="eyebrow">Finished Inventory</p>
            <h2>{getRecordTitle(item)}</h2>
            <span>{[itemTsm(item), item.job_ticket_number, item.sku].filter(Boolean).join(" / ") || "No linked job"}</span>
          </div>
          <div className="finished-inventory-window-actions">
            <button className="ghost-btn" type="button" onClick={onEdit}><Pencil size={15} /> Edit</button>
            <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
          </div>
        </header>

        <div className="finished-inventory-focus">
          <div>
            <span>On hand</span>
            <strong>{quantityText(item)}</strong>
            <em>{labelize(item.status || "available")}</em>
          </div>
          <div>
            <span>Location</span>
            <strong>{locationText(item)}</strong>
            <em>{item.run_date ? `Run ${item.run_date}` : "No run date"}</em>
          </div>
        </div>

        <div className="finished-inventory-detail-grid">
          <Detail label="TSM ID" value={itemTsm(item)} />
          <Detail label="Job Ticket" value={item.job_ticket_number} />
          <Detail label="Part Number" value={item.sku} />
          <Detail label="Face" value={item.face_type} />
          <Detail label="Liner" value={item.liner_type} />
          <Detail label="Legacy Row" value={item.legacy_row_id} />
        </div>

        <form className="finished-send-form" onSubmit={submit}>
          <div className="finished-send-title">
            <PackageMinus size={17} />
            <div>
              <strong>Send Item Out</strong>
              <span>Reduces finished stock and records a usage event.</span>
            </div>
          </div>
          <label>
            <span>Quantity</span>
            <input
              type="number"
              min="0"
              max={available}
              step="0.001"
              value={form.quantity}
              onChange={(event) => update("quantity", event.target.value)}
              placeholder={`Available ${available.toLocaleString()}`}
              disabled={!canSend}
            />
          </label>
          <label>
            <span>Date</span>
            <input type="date" value={form.used_date} onChange={(event) => update("used_date", event.target.value)} disabled={!canSend} />
          </label>
          <label>
            <span>Sent By</span>
            <input value={form.used_by} onChange={(event) => update("used_by", event.target.value)} placeholder="Name" disabled={!canSend} />
          </label>
          <label>
            <span>Reference</span>
            <input value={form.reference} onChange={(event) => update("reference", event.target.value)} placeholder="Order, customer, or note" disabled={!canSend} />
          </label>
          <label className="field-wide">
            <span>Notes</span>
            <textarea value={form.notes} onChange={(event) => update("notes", event.target.value)} placeholder="Optional shipment note" disabled={!canSend} />
          </label>
          <div className="finished-send-actions">
            <button className="primary-btn" type="submit" disabled={!canSend || sending}>{sending ? "Sending..." : "Send Out"}</button>
          </div>
        </form>

        <section className="finished-usage-history">
          <div className="finished-usage-history-head">
            <strong>Usage History</strong>
            <span>{usageRows.length} event{usageRows.length === 1 ? "" : "s"}</span>
          </div>
          {usageRows.length ? (
            usageRows.slice(0, 12).map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.reference || labelize(row.usage_type)}</strong>
                  <span>{[row.used_date, labelize(row.usage_type), row.used_by].filter(Boolean).join(" / ")}</span>
                </div>
                <em>{numeric(row.quantity).toLocaleString()} {row.unit || item.unit || "units"}</em>
              </article>
            ))
          ) : (
            <p>No usage has been recorded for this finished item yet.</p>
          )}
        </section>
      </div>
    </section>
  );
}

export default function FinishedInventoryView({ rows, selectedId, onSelect }) {
  const groups = useMemo(() => groupByLocation(rows), [rows]);
  const total = (rows ?? []).reduce((sum, row) => {
    if (["shipped", "scrapped"].includes(String(row.status || "").toLowerCase())) return sum;
    return sum + numeric(row.quantity);
  }, 0);
  const activeLots = (rows ?? []).filter((row) => numeric(row.quantity) > 0 && !["shipped", "scrapped"].includes(String(row.status || "").toLowerCase())).length;
  const linkedLots = (rows ?? []).filter((row) => row.job_ticket || row.job_ticket_number || row.job_ticket_product_code).length;
  const unlinkedLots = Math.max(0, activeLots - linkedLots);

  return (
    <div className="finished-inventory-view">
      <div className="finished-inventory-summary">
        <div>
          <span>On hand qty</span>
          <strong>{total.toLocaleString()}</strong>
        </div>
        <div>
          <span>Linked lots</span>
          <strong>{linkedLots.toLocaleString()}</strong>
        </div>
        <div>
          <span>Unlinked legacy</span>
          <strong>{unlinkedLots.toLocaleString()}</strong>
        </div>
      </div>

      <div className="finished-location-groups">
        {groups.map((group) => (
          <section className="finished-location-group" key={group.location}>
            <header>
              <div>
                <MapPin size={17} />
                <strong>{group.location}</strong>
              </div>
              <span>{group.total.toLocaleString()} on hand / {group.rows.length} lot{group.rows.length === 1 ? "" : "s"}</span>
            </header>
            <div className="finished-location-items">
              {group.rows.map((row) => (
                <button
                  type="button"
                  key={row.id}
                  className={`finished-location-item ${String(row.id) === String(selectedId) ? "active" : ""}`}
                  onClick={() => onSelect?.(row)}
                >
                  <span className={`finished-status-dot ${stockTone(row)}`} />
                  <div>
                    <strong>{getRecordTitle(row)}</strong>
                    <span>{[itemTsm(row), row.job_ticket_number, row.sku].filter(Boolean).join(" / ") || "No linked job"}</span>
                  </div>
                  <em>{quantityText(row)}</em>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
