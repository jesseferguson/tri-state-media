import { useEffect, useState } from "react";
import { AlertTriangle, Box, Edit3, Image as ImageIcon, PackagePlus, Printer, QrCode, Save, Trash2, X } from "lucide-react";
import { choiceLists } from "../../../resourceConfig";
import { formatInches, getRecordTitle, labelize } from "../../../lib/format";
import { FilePreview } from "../../../shared/components/FilePreview";
import FlexDieRequestQueue from "./FlexDieRequestQueue";

function numberValue(value) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function formatMoney(value) {
  if (value === null || value === undefined || value === "") return "--";
  const number = Number(value);
  if (Number.isNaN(number)) return String(value);
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
}

function formatDate(value) {
  if (!value) return "--";
  const dateOnly = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return `${Number(dateOnly[2])}/${Number(dateOnly[3])}/${dateOnly[1]}`;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
}

function serialsForDie(die) {
  if (Array.isArray(die?.serial_number_list)) return die.serial_number_list;
  return String(die?.serial_numbers ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function countTone(die) {
  const active = numberValue(die?.active_die_count);
  const target = numberValue(die?.target_die_count);
  if (active < 1) return "bad";
  if (target && active < target) return "warn";
  return "ready";
}

function Detail({ label, value }) {
  return (
    <div>
      <span>{label}</span>
      <strong title={String(value ?? "--")}>{value || "--"}</strong>
    </div>
  );
}

function PrimarySpec({ label, value, detail, tone = "" }) {
  return (
    <div className={`flex-die-spec-card ${tone}`}>
      <span>{label}</span>
      <strong title={String(value ?? "--")}>{value || "--"}</strong>
      {detail && <em>{detail}</em>}
    </div>
  );
}

function InlineAlert({ tone }) {
  if (tone === "ready") {
    return (
      <div className="flex-die-alert ready">
        <strong>No active alerts</strong>
        <span>Die count is at or above the target for this folder.</span>
      </div>
    );
  }

  return (
    <div className={`flex-die-alert ${tone}`}>
      <AlertTriangle size={16} />
      <strong>{tone === "bad" ? "Needs ordered" : "Below target"}</strong>
      <span>This jacket is below the count production wants on hand.</span>
    </div>
  );
}

function FlexDiePrintDialog({ die, presses = [], busy, error, onPrint, onClose }) {
  const [form, setForm] = useState(() => ({
    press: presses.find((press) => press.printer_ip)?.id || "",
    copies: 1,
    speed: "",
    darkness: "",
  }));
  const selectedPress = presses.find((press) => String(press.id) === String(form.press));

  useEffect(() => {
    if (!selectedPress) return;
    setForm((current) => ({
      ...current,
      speed: current.speed || selectedPress.printer_speed || "5",
      darkness: current.darkness || selectedPress.printer_darkness || "20",
    }));
  }, [selectedPress?.id]);

  return (
    <div className="storage-modal-overlay" role="presentation" onMouseDown={onClose}>
      <form className="storage-modal flex-die-print-modal" onSubmit={(event) => { event.preventDefault(); onPrint(form); }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>2.5 x 5 Zebra Label</span><h3>Print {getRecordTitle(die)}</h3></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className="flex-die-label-preview">
          <div>
            <span>Flex Die Folder</span>
            <strong>{getRecordTitle(die)}</strong>
            <em>QR opens live folder info</em>
          </div>
          <QrCode size={88} />
          <section>
            <b>Across {die.number_across || "--"}</b>
            <b>Around {die.number_around || "--"}</b>
            <b>Width {formatInches(die.label_width_inches)}</b>
            <b>Length {formatInches(die.label_length_inches)}</b>
            <b>Gear {die.gear ? `${die.gear}T` : "--"}</b>
            <b>Web {formatInches(die.web_width_inches)}</b>
            <b>Face {labelize(die.face_type)}</b>
            <b>Cut {labelize(die.cutting_type)}</b>
          </section>
          <div className="flex-die-label-preview-serial">
            <span>Current Original Serial Number</span>
            <strong>{die.original_serial_number || "--"}</strong>
          </div>
        </div>
        <div className="storage-form-grid">
          <label className="wide">
            <span>Printer</span>
            <select value={form.press} onChange={(event) => setForm((current) => ({ ...current, press: event.target.value, speed: "", darkness: "" }))} required>
              <option value="">Choose printer</option>
              {presses.filter((press) => press.printer_ip).map((press) => <option value={press.id} key={press.id}>{press.name} / {press.printer_ip}</option>)}
            </select>
          </label>
          <label><span>Copies</span><input type="number" min="1" max="20" value={form.copies} onChange={(event) => setForm((current) => ({ ...current, copies: event.target.value }))} /></label>
          <label><span>Speed</span><input type="number" min="1" max="14" value={form.speed} onChange={(event) => setForm((current) => ({ ...current, speed: event.target.value }))} /></label>
          <label><span>Darkness</span><input type="number" min="0" max="30" value={form.darkness} onChange={(event) => setForm((current) => ({ ...current, darkness: event.target.value }))} /></label>
        </div>
        {error && <div className="storage-message error"><AlertTriangle size={17} /><span>{error}</span></div>}
        <footer>
          <button className="ghost-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="submit" disabled={busy || !form.press}><Printer size={16} /> {busy ? "Queueing..." : "Print Label"}</button>
        </footer>
      </form>
    </div>
  );
}

function HistoryList({ rows }) {
  if (!rows?.length) return <p className="muted">No die requests or count changes yet.</p>;
  return (
    <div className="flex-die-history-list">
      {rows.slice(0, 12).map((row) => (
        <article key={row.id}>
          <strong>{labelize(row.event_type)}</strong>
          <span>{row.summary}</span>
          <em>{[row.performed_by, row.event_date ? new Date(row.event_date).toLocaleString() : ""].filter(Boolean).join(" / ")}</em>
        </article>
      ))}
    </div>
  );
}

function eventDate(row) {
  return row?.event_date ? new Date(row.event_date).toLocaleString() : "";
}

function eventNote(row) {
  return [row.notes, eventDate(row)].filter(Boolean).join(" / ");
}

function ManagementStat({ label, value, tone = "" }) {
  return (
    <div className={`flex-die-management-stat ${tone}`}>
      <span>{label}</span>
      <strong>{value === 0 ? 0 : value || "--"}</strong>
    </div>
  );
}

function OrderTimeline({ rows }) {
  if (!rows?.length) return <p className="muted">No order events have been recorded yet.</p>;
  return (
    <div className="flex-die-order-list">
      {rows.map((row) => (
        <article key={row.id}>
          <strong>{labelize(row.event_type)}</strong>
          <span>{row.summary}</span>
          <em>{eventNote(row)}</em>
        </article>
      ))}
    </div>
  );
}

function UsageList({ rows }) {
  if (!rows?.length) return <p className="muted">This die is not assigned to any press setup options yet.</p>;
  return (
    <div className="flex-die-usage-list">
      {rows.map((row) => (
        <article key={row.id}>
          <div>
            <strong>{row.recipe_name || "No label layout"}</strong>
            <span>{[row.press_name, row.recipe_option_name].filter(Boolean).join(" / ") || "No press option"}</span>
          </div>
          <em>{[labelize(row.tool_role), row.station_number ? `Station ${row.station_number}` : "", row.is_required === false ? "Optional" : "Required"].filter(Boolean).join(" / ")}</em>
        </article>
      ))}
    </div>
  );
}

export default function FlexDieDetailPanel({
  die,
  historyRows = [],
  usageRows = [],
  onEdit,
  onDelete,
  onRequestReorder,
  onMarkOrdered,
  onReceiveDie,
  onAdjustCount,
  onDeleteDieline,
  onUpdateStatus,
  onPrintFolderLabel,
  presses = [],
  currentUser = null,
  canProcessFlexDieRequests = false,
  onRequestsChanged,
  printingLabel = false,
  printLabelError = "",
}) {
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [printNotice, setPrintNotice] = useState("");
  const [requestNote, setRequestNote] = useState("");
  const [orderNote, setOrderNote] = useState("");
  const [receiveSerial, setReceiveSerial] = useState("");
  const [receiveQty, setReceiveQty] = useState(1);
  const [receiveNote, setReceiveNote] = useState("");
  const [countValue, setCountValue] = useState(die?.active_die_count ?? 0);
  const [countNote, setCountNote] = useState("");
  const [statusValue, setStatusValue] = useState(die?.status ?? "in_stock");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const serials = serialsForDie(die);
  const tone = countTone(die);
  const imageUrl = die?.dieline_image_url || die?.dieline_image;
  const compatiblePresses = Array.isArray(die?.compatible_press_names) ? die.compatible_press_names : [];
  const compatiblePressText = compatiblePresses.length ? compatiblePresses.join(", ") : "No press compatibility set";
  const orderRows = historyRows.filter((row) => ["die_reorder_requested", "die_ordered", "die_received"].includes(row.event_type));
  const orderedRows = historyRows.filter((row) => row.event_type === "die_ordered");
  const fdNumber = getRecordTitle(die);
  const activeCount = numberValue(die.active_die_count);
  const targetCount = numberValue(die.target_die_count);
  const labelSize = `${formatInches(die.label_width_inches)} x ${formatInches(die.label_length_inches)}`;
  const webWidth = formatInches(die.web_width_inches || die.computed_web_width_inches);
  const location = die.current_location_full_path || die.current_location_name || "--";
  const lastQuote = [
    die.last_quote_price ? formatMoney(die.last_quote_price) : "",
    die.last_quote_supplier_name,
  ].filter(Boolean).join(" / ");
  const lastOrder = [
    die.last_order_price ? formatMoney(die.last_order_price) : "",
    die.last_ordered_date ? formatDate(die.last_ordered_date) : "",
  ].filter(Boolean).join(" / ");

  useEffect(() => {
    setCountValue(die?.active_die_count ?? 0);
    setStatusValue(die?.status ?? "in_stock");
    setCountNote("");
    setError("");
    setPrintDialogOpen(false);
    setPrintNotice("");
  }, [die?.id, die?.active_die_count, die?.status]);

  async function run(actionName, action) {
    setBusy(actionName);
    setError("");
    try {
      await action();
      if (actionName === "request") setRequestNote("");
      if (actionName === "ordered") setOrderNote("");
      if (actionName === "receive") {
        setReceiveSerial("");
        setReceiveQty(1);
        setReceiveNote("");
      }
      if (actionName === "count") setCountNote("");
    } catch (err) {
      setError(err.message || "Could not update this die.");
    } finally {
      setBusy("");
    }
  }

  async function printFolderLabel(form) {
    if (!onPrintFolderLabel) return;
    setPrintNotice("");
    try {
      await onPrintFolderLabel(form);
      setPrintDialogOpen(false);
      setPrintNotice(`Folder label queued for ${getRecordTitle(die)}.`);
    } catch {
      // The mutation error is shown in the dialog through printLabelError.
    }
  }

  return (
    <aside className="flex-die-detail-panel compact-card">
      <section className="flex-die-overview-panel" id="flex-die-summary">
        <header className="flex-die-detail-head flex-die-folder-hero">
          <div className="flex-die-folder-identity">
            <p className="eyebrow">Flex Die Folder</p>
            <h2>{fdNumber}</h2>
            <div className="flex-die-head-pills">
              <span className={`flex-die-count-pill ${tone}`}>
                {activeCount} active / {targetCount} target
              </span>
              <span className={`flex-die-status-pill ${die.status || "in_stock"}`}>{labelize(die.status)}</span>
            </div>
          </div>
          <div className="flex-die-hero-side">
            <div className="flex-die-folder-meta-grid">
              <div className="flex-die-folder-meta-card">
                <span>Location</span>
                <strong title={location}>{location}</strong>
              </div>
              <div className="flex-die-folder-meta-card">
                <span>Current Supplier</span>
                <strong title={die.supplier_name || "No supplier assigned"}>{die.supplier_name || "No supplier assigned"}</strong>
              </div>
              <div className="flex-die-folder-meta-card">
                <span>Known Presses</span>
                <strong title={compatiblePressText}>{compatiblePressText}</strong>
              </div>
            </div>
            <div className="flex-die-actions">
              <button className="ghost-btn" type="button" onClick={() => setPrintDialogOpen(true)} disabled={!onPrintFolderLabel}>
                <Printer size={15} />
                <span className="desktop-label">Print Folder Label</span>
                <span className="mobile-label">Print</span>
              </button>
              <button className="primary-btn" type="button" onClick={onEdit}><Edit3 size={15} /> Edit</button>
              <button className="danger-btn" type="button" onClick={onDelete}><Trash2 size={15} /> Delete</button>
            </div>
          </div>
        </header>

        {printNotice && <p className="flex-die-print-success">{printNotice}</p>}

        {tone !== "ready" && <InlineAlert tone={tone} />}

        <section className="flex-die-critical-specs" aria-label="Primary flex die specs">
          <PrimarySpec label="Across" value={die.number_across || "--"} detail="number across" tone="primary" />
          <PrimarySpec label="Around" value={die.number_around || "--"} detail="number around" />
          <PrimarySpec label="Gear" value={die.gear ? `${die.gear}T` : "--"} detail="tooth count" />
          <PrimarySpec label="Repeat" value={formatInches(die.repeat_inches)} detail="label repeat" />
          <PrimarySpec label="Shape" value={labelize(die.shape_type)} detail="label shape" />
          <PrimarySpec label="Web Width" value={webWidth} detail="total web width" />
        </section>
      </section>

      <nav className="flex-die-folder-nav" aria-label="Flex die folder sections">
        <a href="#flex-die-summary">Overview</a>
        <a href="#flex-die-specs">Specs</a>
        <a href="#flex-die-management">Manage</a>
        <a href="#flex-die-serials">Serials</a>
        <a href="#flex-die-actions">Actions</a>
        <a href="#flex-die-history">Messages</a>
      </nav>

      <section className="flex-die-content-grid" id="flex-die-specs">
        <div className="flex-die-section flex-die-full-specs">
          <div className="type-section-head">
            <strong>Specs + Supplier</strong>
            <span>Complete folder data</span>
          </div>
          <div className="flex-die-detail-grid">
            <Detail label="Label Size" value={labelSize} />
            <Detail label="Label Width" value={formatInches(die.label_width_inches)} />
            <Detail label="Label Length" value={formatInches(die.label_length_inches)} />
            <Detail label="Gap Across" value={formatInches(die.gap_across_inches)} />
            <Detail label="Gap Around" value={formatInches(die.gap_around_inches)} />
            <Detail label="Cutting" value={labelize(die.cutting_type)} />
            <Detail label="Face" value={labelize(die.face_type)} />
            <Detail label="Liner" value={labelize(die.liner_type)} />
            <Detail label="Current Supplier" value={die.supplier_name} />
            <Detail label="Last Quote" value={lastQuote} />
            <Detail label="Last Order" value={lastOrder} />
            <Detail label="Original Serial" value={die.original_serial_number} />
            <Detail label="Current Location" value={location} />
            <Detail label="Known Presses" value={compatiblePressText} />
          </div>
        </div>

        <div className="flex-die-section flex-die-dieline-section">
          <div className="type-section-head">
            <strong>Dieline</strong>
            <span>{die.dieline_image_name || die.external_dieline_source || "Folder file"}</span>
          </div>
          <section className={`flex-die-image-card ${die.dieline_image_is_document ? "document" : ""}`}>
            {imageUrl ? (
              <FilePreview
                url={imageUrl}
                title={die.dieline_image_name || die.name}
                isDocument={die.dieline_image_is_document}
                compact={die.dieline_image_is_document}
              />
            ) : (
              <div><ImageIcon size={22} /><span>No dieline file</span></div>
            )}
            {die.external_dieline_source && imageUrl && (
              <small className="flex-die-dieline-source">{die.external_dieline_source}</small>
            )}
            {imageUrl && die.dieline_image_is_uploaded && onDeleteDieline && (
              <button className="ghost-btn xs" type="button" onClick={() => run("image", onDeleteDieline)}>
                <Trash2 size={12} /> Delete File
              </button>
            )}
          </section>
        </div>
      </section>

      {(die.notes || die.procurement_notes) && (
        <section className="flex-die-section flex-die-notes-section">
          <div className="type-section-head">
            <strong>Notes</strong>
            <span>Folder and procurement notes</span>
          </div>
          <div className="flex-die-notes-grid">
            {die.notes && <p>{die.notes}</p>}
            {die.procurement_notes && <p>{die.procurement_notes}</p>}
          </div>
        </section>
      )}

      <section className="flex-die-section management" id="flex-die-management">
        <div className="type-section-head">
          <strong>Management Summary</strong>
          <span>Ordering, usage, and serial control</span>
        </div>
        <div className="flex-die-management-layout">
          {onUpdateStatus && (
            <form className="flex-die-status-form" onSubmit={(event) => { event.preventDefault(); run("status", () => onUpdateStatus({ status: statusValue })); }}>
              <label>
                <span>Status</span>
                <select value={statusValue} onChange={(event) => setStatusValue(event.target.value)}>
                  {(choiceLists.toolStatus ?? []).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </label>
              <button className="primary-btn xs" type="submit" disabled={busy === "status"}><Save size={13} /> {busy === "status" ? "Saving..." : "Save Status"}</button>
            </form>
          )}
          <div className="flex-die-management-grid">
            <ManagementStat label="Status" value={labelize(die.status)} tone={tone} />
            <ManagementStat label="Order Events" value={orderRows.length} />
            <ManagementStat label="Times Ordered" value={orderedRows.length} />
            <ManagementStat label="Press Setups Using Die" value={usageRows.length} />
            <ManagementStat label="Recorded Serials" value={serials.length} />
            <ManagementStat label="Current Location" value={location} />
          </div>
        </div>
      </section>

      <FlexDieRequestQueue
        currentUser={currentUser}
        flexDieId={die.id}
        canProcess={canProcessFlexDieRequests}
        compact
        showControls={false}
        title="Open Requests For This Folder"
        emptyText="No open requests for this flex die folder."
        onChanged={onRequestsChanged}
      />

      <section className="flex-die-section" id="flex-die-serials">
        <div className="type-section-head">
          <strong>Serial History</strong>
          <span>{serials.length} recorded</span>
        </div>
        {serials.length ? (
          <div className="flex-die-serial-list">
            {serials.map((serial) => <span key={serial}>{serial}</span>)}
          </div>
        ) : (
          <p className="muted">No serial numbers have been recorded yet.</p>
        )}
      </section>

      <section className="flex-die-section">
        <div className="type-section-head">
          <strong>Usage</strong>
          <span>{usageRows.length} press setup assignment{usageRows.length === 1 ? "" : "s"}</span>
        </div>
        <UsageList rows={usageRows} />
      </section>

      <section className="flex-die-section flex-die-action-center" id="flex-die-actions">
        <div className="type-section-head">
          <strong>Actions</strong>
          <span>Request, receive, and count updates</span>
        </div>
        <section className="flex-die-control-grid">
          <form onSubmit={(event) => { event.preventDefault(); run("request", () => onRequestReorder(requestNote)); }}>
            <strong><PackagePlus size={14} /> Request Die</strong>
            <textarea value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Optional note for production engineering" />
            <button className="primary-btn" type="submit" disabled={busy === "request"}>{busy === "request" ? "Requesting..." : "Request Reorder"}</button>
          </form>

          <form onSubmit={(event) => { event.preventDefault(); run("ordered", () => onMarkOrdered(orderNote)); }}>
            <strong><PackagePlus size={14} /> Order Status</strong>
            <textarea value={orderNote} onChange={(event) => setOrderNote(event.target.value)} placeholder="Optional order note" />
            <button className="ghost-btn" type="submit" disabled={busy === "ordered"}>{busy === "ordered" ? "Saving..." : "Mark Ordered"}</button>
          </form>

          <form onSubmit={(event) => { event.preventDefault(); run("receive", () => onReceiveDie({ serialNumber: receiveSerial, quantity: receiveQty, notes: receiveNote })); }}>
            <strong><Box size={14} /> Receive Die</strong>
            <input value={receiveSerial} onChange={(event) => setReceiveSerial(event.target.value)} placeholder="Serial number" />
            <input type="number" min="1" value={receiveQty} onChange={(event) => setReceiveQty(event.target.value)} />
            <textarea value={receiveNote} onChange={(event) => setReceiveNote(event.target.value)} placeholder="Optional receive note" />
            <button className="primary-btn" type="submit" disabled={busy === "receive"}>{busy === "receive" ? "Receiving..." : "Receive"}</button>
          </form>

          <form onSubmit={(event) => { event.preventDefault(); run("count", () => onAdjustCount({ activeCount: countValue, notes: countNote })); }}>
            <strong><Box size={14} /> Active Count</strong>
            <input type="number" min="0" value={countValue} onChange={(event) => setCountValue(event.target.value)} />
            <textarea value={countNote} onChange={(event) => setCountNote(event.target.value)} placeholder="Optional reason" />
            <button className="ghost-btn" type="submit" disabled={busy === "count"}>{busy === "count" ? "Saving..." : "Save Count"}</button>
          </form>
        </section>
        {error && <p className="flex-die-error">{error}</p>}
      </section>

      <section className="flex-die-section flex-die-message-section" id="flex-die-history">
        <div className="type-section-head">
          <strong>Alerts + Message History</strong>
          <span>{historyRows.length} event{historyRows.length === 1 ? "" : "s"}</span>
        </div>
        <div className="flex-die-message-grid">
          <div className="flex-die-message-stack">
            <InlineAlert tone={tone} />
            <div>
              <strong>Ordering Timeline</strong>
              <OrderTimeline rows={orderRows} />
            </div>
          </div>
          <div>
            <strong>Requests + History</strong>
            <HistoryList rows={historyRows} />
          </div>
        </div>
      </section>

      {printDialogOpen && (
        <FlexDiePrintDialog
          die={die}
          presses={presses}
          busy={printingLabel}
          error={printLabelError}
          onPrint={printFolderLabel}
          onClose={() => setPrintDialogOpen(false)}
        />
      )}
    </aside>
  );
}
