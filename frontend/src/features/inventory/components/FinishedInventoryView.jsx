import { ArrowRightLeft, Loader2, MapPin, PackageMinus, Pencil, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getRecordTitle, labelize } from "../../../lib/format";

const INACTIVE_STATUSES = new Set(["shipped", "scrapped", "moved"]);

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

function locationOptionText(row) {
  return row.full_path || row.location_full_path || row.name || row.code || "Unnamed location";
}

function stockTone(row) {
  const status = String(row.status || "").toLowerCase();
  if (INACTIVE_STATUSES.has(status) || numeric(row.quantity) <= 0) return "bad";
  if (["allocated", "on_hold"].includes(status)) return "hold";
  return "ready";
}

function itemTsm(row) {
  return row.job_ticket_product_code || row.imported_tsm_id || row.job_ticket_number || row.sku || "";
}

function activeItem(row) {
  return numeric(row.quantity) > 0 && !INACTIVE_STATUSES.has(String(row.status || "").toLowerCase());
}

function itemKey(row) {
  const primary = row.job_ticket
    ? `job:${row.job_ticket}`
    : row.job_ticket_number
      ? `ticket:${String(row.job_ticket_number).trim().toLowerCase()}`
      : row.sku
        ? `sku:${String(row.sku).trim().toLowerCase()}`
        : `name:${String(row.name || "").trim().toLowerCase()}`;
  return [
    primary,
    String(row.unit || "").trim().toLowerCase(),
    String(row.face_type || "").trim().toLowerCase(),
    String(row.liner_type || "").trim().toLowerCase(),
    String(row.recipe || "").trim(),
    String(row.recipe_option || "").trim(),
  ].join("|");
}

function sameFinishedItem(a, b) {
  return itemKey(a) === itemKey(b);
}

function groupByLocation(rows) {
  const groups = new Map();
  (rows ?? []).forEach((row) => {
    const location = locationText(row);
    if (!groups.has(location)) groups.set(location, { location, rows: [], total: 0, mixed: false });
    const group = groups.get(location);
    group.rows.push(row);
    if (activeItem(row)) {
      group.total += numeric(row.quantity);
    }
  });
  return Array.from(groups.values()).map((group) => {
    const activeKeys = new Set(group.rows.filter(activeItem).map(itemKey));
    return { ...group, mixed: activeKeys.size > 1 };
  }).sort((a, b) => a.location.localeCompare(b.location));
}

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value || "--"}</strong>
    </div>
  );
}

export function FinishedInventoryWindow({
  item,
  usageRows = [],
  locations = [],
  inventoryRows = [],
  sending = false,
  moving = false,
  sendError = "",
  moveError = "",
  onClose,
  onEdit,
  onSendOut,
  onMoveItem,
}) {
  const [sendForm, setSendForm] = useState({
    quantity: "",
    used_by: "",
    used_date: new Date().toISOString().slice(0, 10),
    reference: "",
    notes: "",
  });
  const [moveForm, setMoveForm] = useState({
    quantity: "",
    location: "",
    moved_by: "",
    moved_date: new Date().toISOString().slice(0, 10),
    notes: "",
  });

  useEffect(() => {
    setSendForm({
      quantity: "",
      used_by: "",
      used_date: new Date().toISOString().slice(0, 10),
      reference: "",
      notes: "",
    });
    setMoveForm({
      quantity: "",
      location: "",
      moved_by: "",
      moved_date: new Date().toISOString().slice(0, 10),
      notes: "",
    });
  }, [item?.id]);

  if (!item) return null;

  const available = numeric(item.quantity);
  const currentStatus = String(item.status || "").toLowerCase();
  const canSend = available > 0 && !INACTIVE_STATUSES.has(currentStatus);
  const canMove = canSend && locations.length > 0;
  const destinationRows = moveForm.location
    ? inventoryRows.filter((row) => String(row.location || "") === String(moveForm.location) && String(row.id) !== String(item.id) && activeItem(row))
    : [];
  const matchingDestination = destinationRows.find((row) => sameFinishedItem(row, item));
  const mixedDestination = destinationRows.some((row) => !sameFinishedItem(row, item));
  const destinationPreview = moveForm.location
    ? matchingDestination
      ? `Same item found at this location. Moving will add to ${quantityText(matchingDestination)}.`
      : mixedDestination
        ? "No matching item is there. Moving here will make this a mixed skid."
        : "This location is ready for this item."
    : "";

  function updateSend(name, value) {
    setSendForm((current) => ({ ...current, [name]: value }));
  }

  function updateMove(name, value) {
    setMoveForm((current) => ({ ...current, [name]: value }));
  }

  async function submitSend(event) {
    event.preventDefault();
    await onSendOut?.({
      ...sendForm,
      quantity: sendForm.quantity === "" ? 0 : Number(sendForm.quantity),
    });
    setSendForm((current) => ({ ...current, quantity: "", reference: "", notes: "" }));
  }

  async function submitMove(event) {
    event.preventDefault();
    await onMoveItem?.({
      ...moveForm,
      quantity: moveForm.quantity === "" ? 0 : Number(moveForm.quantity),
    });
    setMoveForm((current) => ({ ...current, quantity: "", location: "", notes: "" }));
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

        <form className="finished-send-form" onSubmit={submitMove}>
          <div className="finished-send-title">
            <ArrowRightLeft size={17} />
            <div>
              <strong>Move Item</strong>
              <span>Adds to a matching item at the destination or marks the skid mixed.</span>
            </div>
          </div>
          <label>
            <span>Quantity</span>
            <input
              type="number"
              min="0"
              max={available}
              step="0.001"
              value={moveForm.quantity}
              onChange={(event) => updateMove("quantity", event.target.value)}
              placeholder={`Available ${available.toLocaleString()}`}
              disabled={!canMove}
            />
          </label>
          <label>
            <span>Destination</span>
            <select value={moveForm.location} onChange={(event) => updateMove("location", event.target.value)} disabled={!canMove}>
              <option value="">{locations.length ? "Select location" : "Loading locations..."}</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>{locationOptionText(location)}</option>
              ))}
            </select>
          </label>
          <label>
            <span>Date</span>
            <input type="date" value={moveForm.moved_date} onChange={(event) => updateMove("moved_date", event.target.value)} disabled={!canMove} />
          </label>
          <label>
            <span>Moved By</span>
            <input value={moveForm.moved_by} onChange={(event) => updateMove("moved_by", event.target.value)} placeholder="Name" disabled={!canMove} />
          </label>
          <label className="field-wide">
            <span>Notes</span>
            <textarea value={moveForm.notes} onChange={(event) => updateMove("notes", event.target.value)} placeholder="Optional move note" disabled={!canMove} />
          </label>
          {destinationPreview && <p className={`finished-move-preview ${mixedDestination && !matchingDestination ? "mixed" : "ready"}`}>{destinationPreview}</p>}
          {moveError && <div className="finished-form-alert" role="alert">{moveError}</div>}
          <div className="finished-send-actions">
            <button className="primary-btn" type="submit" disabled={!canMove || moving}>{moving ? "Moving..." : "Move Item"}</button>
          </div>
        </form>

        <form className="finished-send-form" onSubmit={submitSend}>
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
              value={sendForm.quantity}
              onChange={(event) => updateSend("quantity", event.target.value)}
              placeholder={`Available ${available.toLocaleString()}`}
              disabled={!canSend}
            />
          </label>
          <label>
            <span>Date</span>
            <input type="date" value={sendForm.used_date} onChange={(event) => updateSend("used_date", event.target.value)} disabled={!canSend} />
          </label>
          <label>
            <span>Sent By</span>
            <input value={sendForm.used_by} onChange={(event) => updateSend("used_by", event.target.value)} placeholder="Name" disabled={!canSend} />
          </label>
          <label>
            <span>Reference</span>
            <input value={sendForm.reference} onChange={(event) => updateSend("reference", event.target.value)} placeholder="Order, customer, or note" disabled={!canSend} />
          </label>
          <label className="field-wide">
            <span>Notes</span>
            <textarea value={sendForm.notes} onChange={(event) => updateSend("notes", event.target.value)} placeholder="Optional shipment note" disabled={!canSend} />
          </label>
          {sendError && <div className="finished-form-alert" role="alert">{sendError}</div>}
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

export default function FinishedInventoryView({ rows, selectedId, loading = false, onSelect }) {
  const groups = useMemo(() => groupByLocation(rows), [rows]);
  const total = (rows ?? []).reduce((sum, row) => {
    if (!activeItem(row)) return sum;
    return sum + numeric(row.quantity);
  }, 0);
  const activeLots = (rows ?? []).filter(activeItem).length;
  const linkedLots = (rows ?? []).filter((row) => activeItem(row) && (row.job_ticket || row.job_ticket_number || row.job_ticket_product_code)).length;
  const unlinkedLots = Math.max(0, activeLots - linkedLots);

  if (loading) {
    return (
      <section className="finished-inventory-loading" role="status" aria-live="polite">
        <Loader2 size={24} />
        <div>
          <strong>Loading finished inventory</strong>
          <span>Pulling current locations, quantities, and skid groups.</span>
        </div>
      </section>
    );
  }

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
                {group.mixed && <em className="finished-mixed-pill">Mixed skid</em>}
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
        {!groups.length && <p className="finished-empty">No finished inventory is loaded yet.</p>}
      </div>
    </div>
  );
}
