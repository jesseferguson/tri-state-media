import { useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, ClipboardCheck, Pencil, RotateCcw, Trash2, X } from "lucide-react";
import { formatCell, getRecordTitle, labelize } from "../../../lib/format";

const purposeChoices = [
  ["coater", "Coater Run"],
  ["production", "Production Job"],
  ["sample", "Sample / Test"],
  ["qc", "QC Review"],
  ["other", "Other"],
];

function currentQuantity(roll) {
  return roll.length_feet ?? roll.quantity ?? 0;
}

function rollUnit(roll) {
  return roll.unit || "lf";
}

function locationName(row) {
  return row.location_full_path || row.location_name || "No location";
}

function usageTitle(row) {
  return [row.reference, row.coater_roll_tag_number, row.finished_inventory_name].filter(Boolean).join(" / ") || labelize(row.usage_type);
}

function UsagePanel({ rows }) {
  const total = rows.reduce((sum, row) => {
    const qty = Number(row.quantity ?? 0);
    if (!Number.isFinite(qty)) return sum;
    if (!["checkout", "manual", "coater", "finished", "shipped", "scrap"].includes(row.usage_type)) return sum;
    return sum + qty;
  }, 0);
  const largest = Math.max(...rows.map((row) => Number(row.quantity ?? 0)).filter(Number.isFinite), 1);

  return (
    <section className="roll-usage-panel">
      <div className="roll-usage-head">
        <div>
          <span>Usage</span>
          <strong>{total.toLocaleString()} used</strong>
        </div>
        <em>{rows.length} records</em>
      </div>
      <div className="roll-usage-list">
        {rows.length ? rows.slice(0, 5).map((row) => {
          const qty = Number(row.quantity ?? 0);
          const width = `${Math.max(4, Math.round((qty / largest) * 100))}%`;
          return (
            <article key={row.id} className="roll-usage-row">
              <div>
                <strong>{usageTitle(row)}</strong>
                <span>{[formatCell(row, "used_date"), labelize(row.usage_type), row.used_by].filter(Boolean).join(" / ")}</span>
              </div>
              <div className="roll-mini-bar"><span style={{ width }} /></div>
              <em>{qty ? `${qty.toLocaleString()} ${row.unit}` : "--"}</em>
            </article>
          );
        }) : (
          <p className="roll-usage-empty">No usage has been recorded for this roll yet.</p>
        )}
      </div>
    </section>
  );
}

export default function RollWorkflowWindow({ roll, locations, usageRows = [], submitting, canDelete = false, onClose, onEdit, onCheckOut, onReturn, onUpdateStatus, onDelete }) {
  const [mode, setMode] = useState("details");
  const [purpose, setPurpose] = useState("coater");
  const [customPurpose, setCustomPurpose] = useState("");
  const [usedBy, setUsedBy] = useState("");
  const [notes, setNotes] = useState("");
  const [qcIssue, setQcIssue] = useState(false);
  const [qcNotes, setQcNotes] = useState("");
  const [remaining, setRemaining] = useState(currentQuantity(roll));
  const [location, setLocation] = useState(roll.location || "");
  const [scan, setScan] = useState("");
  const [holdReference, setHoldReference] = useState("");

  const purposeText = purpose === "other" ? customPurpose : purposeChoices.find(([value]) => value === purpose)?.[1];
  const scanned = scan.trim();
  const scanMatches = !scanned || scanned.toLowerCase() === String(roll.serial_number || "").toLowerCase();
  const canSubmitReturn = remaining !== "" && Number(remaining) >= 0 && scanMatches;
  const consumed = useMemo(() => {
    const current = Number(currentQuantity(roll) || 0);
    const left = Number(remaining || 0);
    if (!Number.isFinite(current) || !Number.isFinite(left)) return 0;
    return Math.max(0, current - left);
  }, [remaining, roll]);

  function submitCheckout(event) {
    event.preventDefault();
    onCheckOut({
      used_for: qcIssue ? "QC Review" : purposeText,
      used_by: usedBy,
      notes,
      qc_issue: qcIssue,
      qc_notes: qcNotes,
    });
  }

  function submitReturn(event) {
    event.preventDefault();
    if (!canSubmitReturn) return;
    onReturn({
      remaining_quantity: Number(remaining),
      location,
      used_by: usedBy,
      notes,
      qc_issue: qcIssue,
      qc_notes: qcNotes,
    });
  }

  function submitStatus(event) {
    event.preventDefault();
    onUpdateStatus?.({
      status: qcIssue ? "on_hold" : "scheduled",
      reference: qcIssue ? "QC issue" : holdReference || "Held for job",
      used_by: usedBy,
      notes,
      qc_issue: qcIssue,
      qc_notes: qcNotes,
    });
  }

  return (
    <section className="roll-overlay" role="dialog" aria-modal="true" aria-label="Roll workflow">
      <div className="roll-window compact-card">
        <header className="roll-window-head">
          <div>
            <p className="eyebrow">Roll Control</p>
            <h2>{getRecordTitle(roll)}</h2>
          </div>
          <div className="roll-window-actions">
            <button className="primary-btn" type="button" onClick={onEdit}><Pencil size={15} /> Edit Roll</button>
            {canDelete && <button className="material-remove-inventory-btn" type="button" onClick={onDelete}><Trash2 size={15} /> Remove from Inventory</button>}
            <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
          </div>
        </header>

        <div className="roll-id-strip">
          <div>
            <span>Roll ID</span>
            <strong>{roll.serial_number || "Auto ID pending"}</strong>
          </div>
          <div>
            <span>Status</span>
            <strong>{labelize(roll.status)}</strong>
          </div>
          <div>
            <span>On Roll</span>
            <strong>{Number(currentQuantity(roll) || 0).toLocaleString()} {rollUnit(roll)}</strong>
          </div>
          <div>
            <span>Location</span>
            <strong>{locationName(roll)}</strong>
          </div>
        </div>

        <div className="roll-spec-grid">
          <div><span>Material</span><strong>{roll.material_name || roll.name || "--"}</strong></div>
          <div><span>Code</span><strong>{roll.material_code || roll.code || "--"}</strong></div>
          <div><span>Type</span><strong>{labelize(roll.material_type)}</strong></div>
          <div><span>Family</span><strong>{roll.material_family || "--"}</strong></div>
          <div><span>Lot</span><strong>{roll.lot_number || "--"}</strong></div>
          <div><span>Width</span><strong>{roll.width_inches ? `${roll.width_inches}"` : "--"}</strong></div>
        </div>

        <UsagePanel rows={usageRows} />

        <div className="roll-mode-tabs" role="tablist" aria-label="Roll action">
          <button type="button" className={mode === "details" ? "active" : ""} onClick={() => setMode("details")}>
            Details
          </button>
          <button type="button" className={mode === "checkout" ? "active" : ""} onClick={() => setMode("checkout")}>
            <ClipboardCheck size={16} /> Check Out
          </button>
          <button type="button" className={mode === "return" ? "active" : ""} onClick={() => setMode("return")}>
            <RotateCcw size={16} /> Return Roll
          </button>
          <button type="button" className={mode === "status" ? "active" : ""} onClick={() => setMode("status")}>
            Hold / QC
          </button>
        </div>

        {mode === "details" && (
          <div className="roll-detail-actions">
            <button
              className="primary-btn"
              type="button"
              disabled={submitting || roll.status === "in_use"}
              onClick={() => onCheckOut({
                used_for: "Coordinator checkout",
                used_by: "",
                notes: "",
                qc_issue: false,
                qc_notes: "",
              })}
            >
              {submitting ? "Taking Out..." : roll.status === "in_use" ? "Already Out" : "Take Entire Roll Out"}
            </button>
            <button className="ghost-btn" type="button" onClick={() => setMode("return")}>Return / Update Remaining</button>
            <button className="ghost-btn" type="button" onClick={() => setMode("status")}>Hold For Job / QC</button>
          </div>
        )}

        {mode === "checkout" && (
          <form className="roll-form" onSubmit={submitCheckout}>
            <label>
              <span>Used For</span>
              <select value={purpose} onChange={(event) => setPurpose(event.target.value)}>
                {purposeChoices.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            {purpose === "other" && (
              <label>
                <span>Purpose</span>
                <input value={customPurpose} onChange={(event) => setCustomPurpose(event.target.value)} placeholder="What is this roll being used for?" />
              </label>
            )}
            <label>
              <span>Coordinator / Operator</span>
              <input value={usedBy} onChange={(event) => setUsedBy(event.target.value)} placeholder="Name or initials" />
            </label>
            <label className="roll-check">
              <input type="checkbox" checked={qcIssue} onChange={(event) => setQcIssue(event.target.checked)} />
              <span>Flag this roll for QC</span>
            </label>
            {qcIssue && (
              <label className="field-wide">
                <span>QC Notes</span>
                <textarea value={qcNotes} onChange={(event) => setQcNotes(event.target.value)} placeholder="Describe the issue found at this location." />
              </label>
            )}
            <label className="field-wide">
              <span>Notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional job, tag, or handoff note" />
            </label>
            <div className="roll-form-actions">
              <button className="primary-btn" type="submit" disabled={submitting}>Take Roll Out</button>
            </div>
          </form>
        )}

        {mode === "return" && (
          <form className="roll-form" onSubmit={submitReturn}>
            <label className="field-wide">
              <span>Scan / Confirm Roll ID</span>
              <input value={scan} onChange={(event) => setScan(event.target.value)} placeholder={roll.serial_number || "Scan barcode"} autoFocus />
            </label>
            <div className={`roll-scan-state ${scanMatches ? "ready" : "bad"}`}>
              {scanMatches ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              <span>{scanMatches ? "Roll ID matches." : "Scanned ID does not match this roll."}</span>
            </div>
            <label>
              <span>Remaining on Roll</span>
              <input type="number" step="0.001" min="0" value={remaining} onChange={(event) => setRemaining(event.target.value)} />
            </label>
            <label>
              <span>Return Location</span>
              <select value={location ?? ""} onChange={(event) => setLocation(event.target.value)}>
                <option value="">No location</option>
                {(locations ?? []).map((row) => <option key={row.id} value={row.id}>{row.full_path || row.name}</option>)}
              </select>
            </label>
            <div className="roll-return-summary">
              <span>Calculated used</span>
              <strong>{consumed.toLocaleString()} {rollUnit(roll)}</strong>
            </div>
            <label>
              <span>Coordinator / Operator</span>
              <input value={usedBy} onChange={(event) => setUsedBy(event.target.value)} placeholder="Name or initials" />
            </label>
            <label className="roll-check">
              <input type="checkbox" checked={qcIssue} onChange={(event) => setQcIssue(event.target.checked)} />
              <span>Return on QC hold</span>
            </label>
            {qcIssue && (
              <label className="field-wide">
                <span>QC Notes</span>
                <textarea value={qcNotes} onChange={(event) => setQcNotes(event.target.value)} placeholder="Reason this returned roll needs review." />
              </label>
            )}
            <label className="field-wide">
              <span>Return Notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={`Last received ${formatCell(roll, "received_date")}`} />
            </label>
            <div className="roll-form-actions">
              <button className="primary-btn" type="submit" disabled={submitting || !canSubmitReturn}>Put Back In Inventory</button>
            </div>
          </form>
        )}

        {mode === "status" && (
          <form className="roll-form" onSubmit={submitStatus}>
            <label>
              <span>Hold Reference</span>
              <input value={holdReference} onChange={(event) => setHoldReference(event.target.value)} placeholder="Job, coordinator note, or reason" />
            </label>
            <label>
              <span>Coordinator</span>
              <input value={usedBy} onChange={(event) => setUsedBy(event.target.value)} placeholder="Name or initials" />
            </label>
            <label className="roll-check">
              <input type="checkbox" checked={qcIssue} onChange={(event) => setQcIssue(event.target.checked)} />
              <span>QC issue instead of job hold</span>
            </label>
            {qcIssue && (
              <label className="field-wide">
                <span>QC Notes</span>
                <textarea value={qcNotes} onChange={(event) => setQcNotes(event.target.value)} placeholder="Describe the issue. This keeps the roll in inventory but marks it on hold." />
              </label>
            )}
            <label className="field-wide">
              <span>Notes</span>
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="This does not consume inventory footage." />
            </label>
            <div className="roll-return-summary">
              <span>Inventory stays on hand</span>
              <strong>{Number(currentQuantity(roll) || 0).toLocaleString()} {rollUnit(roll)}</strong>
            </div>
            <div className="roll-form-actions">
              <button className="primary-btn" type="submit" disabled={submitting}>{qcIssue ? "Flag QC Hold" : "Hold For Job"}</button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}
