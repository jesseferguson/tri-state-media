import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronRight,
  CircleOff,
  Clock3,
  Edit3,
  MapPin,
  Layers3,
  Menu,
  PackageOpen,
  Plus,
  Printer,
  QrCode,
  RefreshCcw,
  Search,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { fetchCollection, requestApi } from "../api";
import { formatInches, labelize } from "../lib/format";
import { canDeleteMaterialRoll } from "../lib/localAuth";
import DeleteMaterialRollDialog from "./DeleteMaterialRollDialog";
import ScanLinkScreen from "./ScanLinkScreen";

function userHeaders(user) {
  return {
    "X-Company-User-Id": String(user?.id || ""),
    "X-Company-Username": String(user?.username || ""),
  };
}

function errorPayload(error) {
  const raw = String(error?.message || "");
  try {
    const payload = JSON.parse(raw);
    if (payload?.detail) return payload;
    const fieldMessage = Object.entries(payload || {})
      .flatMap(([field, messages]) => {
        const values = Array.isArray(messages) ? messages : [messages];
        return values.filter(Boolean).map((message) => `${labelize(field)}: ${message}`);
      })
      .join(" ");
    return { ...payload, detail: fieldMessage || raw || "The action could not be completed." };
  } catch {
    return { detail: raw || "The action could not be completed." };
  }
}

function formatFeet(value) {
  return `${Math.round(Number(value || 0)).toLocaleString()} ft`;
}

function formatDate(value, includeTime = false) {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return includeTime
    ? date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" })
    : date.toLocaleDateString([], { dateStyle: "medium" });
}

function rollLabel(roll) {
  return roll?.serial_number || roll?.source_roll_tag_number || roll?.lot_number || `Roll ${roll?.id}`;
}

function normalizedRollScan(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.searchParams.get("rollTagId")
      || url.searchParams.get("inventoryId")
      || url.searchParams.get("rollId")
      || text;
  } catch {
    return text;
  }
}

function ScannerOverlay({ title, onScan, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const scannedRef = useRef(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function start() {
      try {
        const reader = new BrowserQRCodeReader();
        const controls = await reader.decodeFromConstraints(
          {
            video: {
              facingMode: { ideal: "environment" },
              width: { ideal: 1920 },
              height: { ideal: 1080 },
            },
            audio: false,
          },
          videoRef.current,
          (result, _scanError, activeControls) => {
            const value = result?.getText?.();
            if (!value || cancelled || scannedRef.current) return;
            scannedRef.current = true;
            activeControls?.stop?.();
            controlsRef.current = null;
            window.navigator?.vibrate?.(80);
            onScan(value);
          }
        );
        if (cancelled || scannedRef.current) controls.stop?.();
        else controlsRef.current = controls;
      } catch (scanError) {
        setError(scanError?.message || "Camera scanning is unavailable. Use the scan field instead.");
      }
    }
    start();
    return () => {
      cancelled = true;
      controlsRef.current?.stop?.();
    };
  }, []);

  return (
    <div className="storage-camera-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <section>
        <header>
          <div><QrCode size={20} /><strong>{title}</strong></div>
          <button type="button" onClick={onClose} aria-label="Close scanner"><X size={19} /></button>
        </header>
        <video ref={videoRef} playsInline muted />
        <p>Point the camera at the roll QR. It will be added automatically.</p>
        {error && <div className="storage-message error"><AlertTriangle size={17} /><span>{error}</span></div>}
      </section>
    </div>
  );
}

function MovementHistory({ rows = [], loading }) {
  if (loading) return <p className="storage-empty">Loading movement history...</p>;
  if (!rows.length) return <p className="storage-empty">No movement history yet.</p>;
  return (
    <div className="storage-history">
      {rows.map((row) => (
        <article key={row.id}>
          <span><Clock3 size={14} /></span>
          <div>
            <strong>{row.action_label || labelize(row.action_type)}</strong>
            <p>{[row.roll_reference, row.skid_reference, row.rack_reference].filter(Boolean).join(" / ")}</p>
            {(row.from_location || row.to_location) && <small>{row.from_location || "Start"} <ChevronRight size={11} /> {row.to_location || "Current"}</small>}
            {row.notes && <em>{row.notes}</em>}
          </div>
          <aside>
            <b>{formatDate(row.created_at, true)}</b>
            <span>{row.actor_name || "System"}</span>
          </aside>
        </article>
      ))}
    </div>
  );
}

function StorageForm({ mode, record, locations = [], busy, error, onSave, onClose }) {
  const isSkid = mode === "skids";
  const rackLocations = locations.filter((location) => (
    location.is_active !== false
    && (
      ["company", "shop", "room", "rack", "shelf"].includes(location.location_type)
      || String(location.id) === String(record?.location || "")
    )
  ));
  const [form, setForm] = useState(() => isSkid ? {
    status: record?.status || "active",
    other_location: record?.other_location || "",
    notes: record?.notes || "",
  } : {
    rack_code: record?.rack_code || "",
    location: record?.location || "",
    aisle: record?.aisle || "",
    bay: record?.bay || "",
    level: record?.level || "",
    position: record?.position || "",
    status: record?.status || "active",
    notes: record?.notes || "",
  });

  return (
    <div className="storage-modal-overlay" role="presentation" onMouseDown={onClose}>
      <form className="storage-modal" onSubmit={(event) => { event.preventDefault(); onSave(form); }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{record ? "Edit" : "Create"}</span>
            <h3>{isSkid ? record?.skid_number || "New Skid" : record?.rack_code || "New Rack"}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className="storage-form-grid">
          {!isSkid && (
            <label className="wide"><span>Rack ID</span><input value={form.rack_code} onChange={(event) => setForm((current) => ({ ...current, rack_code: event.target.value.toUpperCase() }))} placeholder="RACK-03-A" required /></label>
          )}
          {!isSkid && (
            <label className="wide">
              <span>Warehouse Location</span>
              <select value={form.location || ""} onChange={(event) => setForm((current) => ({ ...current, location: event.target.value }))} required>
                <option value="">Select warehouse location</option>
                {rackLocations.map((location) => (
                  <option value={location.id} key={location.id}>{location.full_path || location.name}</option>
                ))}
              </select>
            </label>
          )}
          {!isSkid && <label><span>Aisle</span><input value={form.aisle} onChange={(event) => setForm((current) => ({ ...current, aisle: event.target.value }))} /></label>}
          {!isSkid && <label><span>Bay</span><input value={form.bay} onChange={(event) => setForm((current) => ({ ...current, bay: event.target.value }))} /></label>}
          {!isSkid && <label><span>Level</span><input value={form.level} onChange={(event) => setForm((current) => ({ ...current, level: event.target.value }))} /></label>}
          {!isSkid && <label><span>Position</span><input value={form.position} onChange={(event) => setForm((current) => ({ ...current, position: event.target.value }))} /></label>}
          {isSkid && <label className="wide"><span>Other Location</span><input value={form.other_location} onChange={(event) => setForm((current) => ({ ...current, other_location: event.target.value }))} placeholder="Leave blank for Plant Floor" /></label>}
          <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => setForm((current) => ({ ...current, status: event.target.value }))}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              {isSkid && <option value="retired">Retired</option>}
            </select>
          </label>
          <label className="wide"><span>Notes</span><textarea value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} /></label>
        </div>
        {error && <div className="storage-message error"><AlertTriangle size={17} /><span>{error}</span></div>}
        <footer>
          <button className="ghost-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="submit" disabled={busy}>{busy ? "Saving..." : record ? "Save Changes" : isSkid ? "Create Skid" : "Create Rack"}</button>
        </footer>
      </form>
    </div>
  );
}

function PrintDialog({ mode, record, presses, busy, error, onPrint, onClose }) {
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
      <form className="storage-modal storage-print-modal" onSubmit={(event) => { event.preventDefault(); onPrint(form); }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>4 x 3 Zebra Label</span><h3>Print {mode === "skids" ? record.skid_number : record.rack_code}</h3></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className={`storage-print-preview ${mode === "skids" ? "skid-label-preview" : ""}`}>
          <QrCode size={mode === "skids" ? 116 : 56} />
          <div>
            <strong>{mode === "skids" ? "SKID" : "RACK LOCATION"}</strong>
            <b>{mode === "skids" ? record.skid_number : record.rack_code}</b>
            <span>{mode === "skids" ? "QR opens live skid contents" : "QR opens this material page"}</span>
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

function WorkflowDialog({ mode, action, record, busy, error, confirmation, onSubmit, onConfirmMove, onClose }) {
  const isSkidPage = mode === "skids";
  const selectedRoll = action?.roll || null;
  const [scanValue, setScanValue] = useState(selectedRoll ? String(selectedRoll.id) : action?.value || "");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [useAll, setUseAll] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(action?.type === "add-roll");
  const [riskyConfirmed, setRiskyConfirmed] = useState(false);
  const isUse = action?.type === "use-roll";
  const risky = ["remove-roll", "remove-skid"].includes(action?.type) || (isUse && useAll);
  const scanName = action?.type === "move-to-rack" ? "rack" : isSkidPage ? "roll" : "skid";
  const available = Number(selectedRoll?.length_feet ?? selectedRoll?.quantity ?? 0) || 0;
  const enteredAmount = Number(amount || 0);
  const amountTooHigh = isUse && !useAll && amount !== "" && enteredAmount > available;
  const amountInvalid = isUse && !useAll && amount !== "" && enteredAmount <= 0;
  const remaining = useAll
    ? 0
    : amount === ""
      ? available
      : Math.max(0, available - enteredAmount);

  function submit(value = scanValue) {
    if (amountTooHigh || amountInvalid) return;
    if (risky && !riskyConfirmed) {
      setScanValue(value);
      setRiskyConfirmed(true);
      return;
    }
    onSubmit({ scan_value: value, amount_used: amount, use_all: useAll, notes });
  }

  function handleScan(value) {
    const normalizedValue = normalizedRollScan(value);
    if (!normalizedValue) return;
    setCameraOpen(false);
    setScanValue(normalizedValue);
    if (risky) setRiskyConfirmed(true);
    else onSubmit({ scan_value: normalizedValue, amount_used: amount, use_all: useAll, notes });
  }

  const title = {
    "add-roll": "Add Roll",
    "remove-roll": "Remove Roll",
    "use-roll": "Use Roll",
    "move-to-rack": "Move Skid",
    "add-skid": "Add Skid to Rack",
    "remove-skid": "Remove Skid from Rack",
  }[action?.type] || "Scan";

  return (
    <>
      <div className={`storage-modal-overlay ${action?.type === "add-roll" ? "scan-roll-overlay" : ""} ${selectedRoll ? "selected-roll-overlay" : ""}`} role="presentation" onMouseDown={onClose}>
        <form className={`storage-modal storage-workflow-modal ${action?.type === "add-roll" ? "scan-roll-workflow" : ""} ${selectedRoll ? "selected-roll-workflow" : ""} ${isUse ? "use-roll-workflow" : ""}`} onSubmit={(event) => { event.preventDefault(); submit(); }} onMouseDown={(event) => event.stopPropagation()}>
          <header>
            <div><span>{isSkidPage ? record.skid_number : record.rack_code}</span><h3>{title}</h3></div>
            <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
          </header>
          {selectedRoll ? (
            <section className="storage-selected-roll">
              <div className="storage-selected-roll-name">
                <strong>{selectedRoll.material_master_type_code || selectedRoll.material_name || selectedRoll.name || "Material Roll"}</strong>
                <span>{rollLabel(selectedRoll)}</span>
              </div>
              <div className="storage-selected-roll-stats">
                <div><span>On Roll</span><strong>{formatFeet(available)}</strong></div>
                <div><span>Width</span><strong>{selectedRoll.width_inches ? formatInches(selectedRoll.width_inches) : "--"}</strong></div>
              </div>
              <p><MapPin size={14} /> {selectedRoll.current_location_display || `On ${record.skid_number}`}</p>
            </section>
          ) : (
            <div className="storage-scan-entry">
              <button className="storage-scan-button" type="button" onClick={() => setCameraOpen(true)}>
                <Camera size={24} />
                <span><strong>Scan {scanName} QR</strong><small>Uses the phone camera</small></span>
              </button>
              <label className="storage-scan-input">
                <span>Scan or enter {scanName} ID</span>
                <input autoFocus={action?.type !== "add-roll"} value={scanValue} onChange={(event) => { setScanValue(event.target.value); setRiskyConfirmed(false); }} placeholder={`Scan ${scanName} now`} required />
              </label>
            </div>
          )}
          {isUse && (
            <section className="storage-use-roll-panel">
              <div className="storage-use-modes">
                <button className={!useAll ? "active" : ""} type="button" onClick={() => { setUseAll(false); setRiskyConfirmed(false); }}>Enter Footage</button>
                <button className={useAll ? "active danger" : ""} type="button" onClick={() => { setUseAll(true); setRiskyConfirmed(false); }}>Use Entire Roll</button>
              </div>
              {!useAll && (
                <label className={`storage-scan-input storage-footage-input ${amountTooHigh || amountInvalid ? "invalid" : ""}`}>
                  <span>Footage used</span>
                  <input
                    type="number"
                    min="0.01"
                    max={available}
                    step="0.01"
                    inputMode="decimal"
                    value={amount}
                    onChange={(event) => { setAmount(event.target.value); setRiskyConfirmed(false); }}
                    aria-invalid={amountTooHigh || amountInvalid}
                    required
                  />
                  {amountTooHigh && <small>That is too much material. Only {formatFeet(available)} is on this roll.</small>}
                  {amountInvalid && <small>Enter footage greater than zero, or choose Use Entire Roll.</small>}
                </label>
              )}
              <div className={`storage-live-footage ${remaining <= 0 ? "empty" : ""} ${amountTooHigh ? "invalid" : ""}`}>
                <span>Remaining on roll</span>
                <strong>{formatFeet(remaining)}</strong>
                <small>{remaining <= 0 ? "This roll will leave active inventory and be removed from the skid." : `${formatFeet(useAll ? available : enteredAmount)} will be recorded in material usage.`}</small>
              </div>
              <label className="storage-scan-input"><span>Usage note</span><textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional material or quality note" /></label>
            </section>
          )}
          {confirmation && (
            <div className="storage-message warning">
              <AlertTriangle size={18} />
              <div><strong>{confirmation.detail}</strong><span>This requires confirmation.</span></div>
            </div>
          )}
          {error && !confirmation && <div className="storage-message error"><AlertTriangle size={17} /><span>{error}</span></div>}
          {busy && (
            <div className="storage-message">
              <RefreshCcw size={17} />
              <span>{action?.type === "add-roll" ? `Adding the scanned roll to ${record.skid_number}...` : `${title} in progress...`}</span>
            </div>
          )}
          {riskyConfirmed && !confirmation && (
            <div className="storage-message warning">
              <AlertTriangle size={18} />
              <div><strong>Confirm this action</strong><span>{isUse ? "This will consume all remaining footage." : `This will remove the ${scanName} from its current location.`}</span></div>
            </div>
          )}
          <footer>
            <button className="ghost-btn" type="button" onClick={onClose}>Cancel</button>
            {confirmation ? (
              <button className="danger-btn" type="button" onClick={onConfirmMove} disabled={busy}>{busy ? "Moving..." : "Yes, Move It Here"}</button>
            ) : (
              <button className={riskyConfirmed ? "danger-btn" : "primary-btn"} type="button" onClick={() => submit()} disabled={busy || !scanValue || amountTooHigh || amountInvalid || (isUse && !useAll && !amount)}>
                {busy ? "Working..." : riskyConfirmed ? "Confirm Action" : title}
              </button>
            )}
          </footer>
        </form>
      </div>
      {cameraOpen && <ScannerOverlay title={`Scan ${scanName} QR`} onScan={handleScan} onClose={() => setCameraOpen(false)} />}
    </>
  );
}

export default function MaterialStorageView({ mode, currentUser, initialToken = "", onClearToken = () => {}, onNavigate, onOpenRoll }) {
  const isSkidPage = mode === "skids";
  const endpoint = isSkidPage ? "skids" : "racks";
  const isAdmin = String(currentUser?.role || "").toLowerCase() === "admin";
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [formRecord, setFormRecord] = useState(undefined);
  const [workflow, setWorkflow] = useState(null);
  const [printRecord, setPrintRecord] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [moveConfirmation, setMoveConfirmation] = useState(null);
  const [actionMenuOpen, setActionMenuOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const lastPayloadRef = useRef(null);

  const dataQuery = useQuery({
    queryKey: ["material-storage", mode],
    queryFn: async () => {
      const [records, presses, locations] = await Promise.all([
        fetchCollection(endpoint, { ordering: isSkidPage ? "-created_at" : "rack_code", pageSize: 1000, fetchAll: true }),
        fetchCollection("presses", { ordering: "name", pageSize: 500, fetchAll: true }),
        fetchCollection("locations", { ordering: "name", pageSize: 1000, fetchAll: true }),
      ]);
      return { records: records.results || [], presses: presses.results || [], locations: locations.results || [] };
    },
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const records = dataQuery.data?.records || [];
  const selected = records.find((row) => String(row.id) === String(selectedId)) || null;
  const historyQuery = useQuery({
    queryKey: ["material-storage-history", mode, selected?.id],
    queryFn: () => requestApi(`${endpoint}/${selected.id}/history`, { headers: userHeaders(currentUser) }),
    enabled: Boolean(selected?.id),
    staleTime: 5_000,
  });

  useEffect(() => {
    if (!initialToken || dataQuery.isLoading) return;
    const match = records.find((row) => String(row.qr_token) === String(initialToken));
    if (match) {
      setSelectedId(String(match.id));
      return;
    }
    requestApi(`${endpoint}/scan/${encodeURIComponent(initialToken)}`, { headers: userHeaders(currentUser) })
      .then((record) => {
        setSelectedId(String(record.id));
        dataQuery.refetch();
      })
      .catch((scanError) => setError(errorPayload(scanError).detail));
  }, [initialToken, dataQuery.isLoading, mode]);

  useEffect(() => {
    if (!actionMenuOpen) return undefined;
    function closeMenu(event) {
      if (event.key === "Escape" || (event.type === "pointerdown" && !event.target.closest(".storage-action-menu-wrap"))) {
        setActionMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenu);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenu);
    };
  }, [actionMenuOpen]);

  useEffect(() => {
    setActionMenuOpen(false);
    setHistoryOpen(false);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return records.filter((row) => !query || JSON.stringify(row).toLowerCase().includes(query));
  }, [records, search]);

  async function refresh(recordId = selectedId) {
    const result = await dataQuery.refetch();
    if (recordId && result.data?.records?.some((row) => String(row.id) === String(recordId))) setSelectedId(String(recordId));
    historyQuery.refetch();
  }

  async function saveRecord(form) {
    setBusy(true);
    setError("");
    try {
      const creating = formRecord === null;
      const record = await requestApi(creating ? endpoint : `${endpoint}/${formRecord.id}`, {
        method: creating ? "POST" : "PATCH",
        headers: userHeaders(currentUser),
        body: JSON.stringify({ ...form, performed_by: currentUser?.name || "" }),
      });
      setFormRecord(undefined);
      setSuccess(`${isSkidPage ? record.skid_number : record.rack_code} ${creating ? "created" : "updated"}.`);
      await refresh(record.id);
    } catch (saveError) {
      setError(errorPayload(saveError).detail);
    } finally {
      setBusy(false);
    }
  }

  async function runWorkflow(payload, confirmMove = false) {
    if (!selected || !workflow) return;
    setBusy(true);
    setError("");
    setMoveConfirmation(null);
    const actionEndpoint = `${endpoint}/${selected.id}/${workflow.type}`;
    const finalPayload = {
      ...payload,
      confirm_move: confirmMove,
      performed_by: currentUser?.name || "",
      scan_session_id: workflow.sessionId,
    };
    lastPayloadRef.current = finalPayload;
    try {
      const result = await requestApi(actionEndpoint, {
        method: "POST",
        headers: userHeaders(currentUser),
        body: JSON.stringify(finalPayload),
      });
      setWorkflow(null);
      setSuccess(result.completed || "Completed.");
      await refresh(selected.id);
    } catch (workflowError) {
      const payloadError = errorPayload(workflowError);
      if (payloadError.requires_confirmation) setMoveConfirmation(payloadError);
      else setError(payloadError.detail);
    } finally {
      setBusy(false);
    }
  }

  async function printLabel(form) {
    if (!printRecord) return;
    setBusy(true);
    setError("");
    try {
      const result = await requestApi(`${endpoint}/${printRecord.id}/print-label`, {
        method: "POST",
        headers: userHeaders(currentUser),
        body: JSON.stringify({
          ...form,
          performed_by: currentUser?.name || "",
          frontend_url: window.location.origin,
        }),
      });
      setPrintRecord(null);
      setSuccess(`${result.reprint ? "Reprint" : "Print"} queued for ${isSkidPage ? printRecord.skid_number : printRecord.rack_code}.`);
      await refresh(printRecord.id);
    } catch (printError) {
      setError(errorPayload(printError).detail);
    } finally {
      setBusy(false);
    }
  }

  async function deleteRollFromInventory() {
    if (!deleteCandidate || !selected) return;
    setDeleteBusy(true);
    setDeleteError("");
    try {
      const result = await requestApi(`raw-materials/${deleteCandidate.id}/remove-from-inventory`, {
        method: "POST",
        headers: userHeaders(currentUser),
        body: JSON.stringify({ confirm_delete: true }),
      });
      setDeleteCandidate(null);
      setSuccess(`${result.rollReference || rollLabel(deleteCandidate)} was removed from inventory.`);
      await refresh(selected.id);
    } catch (deleteFailure) {
      setDeleteError(errorPayload(deleteFailure).detail);
    } finally {
      setDeleteBusy(false);
    }
  }

  function openWorkflow(type, target = "") {
    const roll = target && typeof target === "object" ? target : null;
    const value = roll ? String(roll.id) : target;
    setError("");
    setSuccess("");
    setMoveConfirmation(null);
    setActionMenuOpen(false);
    setWorkflow({ type, value, roll, sessionId: window.crypto?.randomUUID?.() || String(Date.now()) });
  }

  if (initialToken && (dataQuery.isLoading || (!selected && !error))) {
    return <ScanLinkScreen kind={isSkidPage ? "skid" : "rack"} />;
  }

  return (
    <section className={`material-storage-view ${initialToken && selected ? "scanned-storage-view" : ""}`}>
      <header className="storage-hero">
        <div>
          <span>{isSkidPage ? "Material movement" : "Plant locations"}</span>
          <h2>{isSkidPage ? "Skids" : "Racks"}</h2>
          <p>{isSkidPage ? "Scan rolls onto skids and follow every movement." : "Scan skids into rack locations and see the material inside."}</p>
        </div>
        <div>
          <button className="ghost-btn" type="button" onClick={() => dataQuery.refetch()}><RefreshCcw size={16} /> Refresh</button>
          {isAdmin && <button className="primary-btn" type="button" onClick={() => { setFormRecord(null); setError(""); }}><Plus size={17} /> {isSkidPage ? "New Skid" : "New Rack"}</button>}
        </div>
      </header>

      <nav className="material-storage-links" aria-label="Material inventory views">
        <button type="button" onClick={() => onNavigate?.("material-handling")}><Layers3 size={16} /> Material</button>
        <button className={isSkidPage ? "active" : ""} type="button" onClick={() => onNavigate?.("skids")}><PackageOpen size={16} /> Skids</button>
        <button className={!isSkidPage ? "active" : ""} type="button" onClick={() => onNavigate?.("racks")}><Warehouse size={16} /> Racks</button>
      </nav>

      {initialToken && selected && (
        <div className="storage-scan-arrival">
          <QrCode size={18} />
          <div><strong>QR scan opened {isSkidPage ? selected.skid_number : selected.rack_code}</strong><span>You can begin a movement below.</span></div>
          <button type="button" onClick={onClearToken}><X size={16} /> Clear Scan</button>
        </div>
      )}
      {success && <div className="storage-completed"><CheckCircle2 size={24} /><div><strong>{success}</strong><span>The location and history have been updated.</span></div><button type="button" onClick={() => setSuccess("")}><X size={17} /></button></div>}
      {error && !formRecord && !workflow && !printRecord && <div className="storage-message error"><AlertTriangle size={18} /><span>{error}</span></div>}

      <div className="storage-layout">
        <aside className="storage-list-panel">
          <label className="storage-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${isSkidPage ? "skid, roll, or rack" : "rack or skid"}...`} /></label>
          <div className="storage-list">
            {filtered.map((row) => {
              const active = String(row.id) === String(selected?.id);
              return (
                <button className={active ? "active" : ""} type="button" onClick={() => { setSelectedId(String(row.id)); setSuccess(""); setError(""); }} key={row.id}>
                  <span className={`storage-status-dot ${row.status}`} />
                  <div>
                    <strong>{isSkidPage ? row.skid_number : row.rack_code}</strong>
                    <span>{isSkidPage ? row.current_location_display : row.storage_location_display || row.location_detail || "Location not assigned"}</span>
                    <small>{isSkidPage ? `${row.roll_count} rolls / ${formatFeet(row.total_remaining_feet)}` : `${row.skid_count} skids / ${row.roll_count} rolls`}</small>
                  </div>
                  <ChevronRight size={17} />
                </button>
              );
            })}
            {!dataQuery.isLoading && !filtered.length && <p className="storage-empty">No {isSkidPage ? "skids" : "racks"} match this search.</p>}
          </div>
        </aside>

        <main className={`storage-detail-panel ${isSkidPage ? "skid-detail-panel" : ""}`}>
          {!selected ? (
            <div className="storage-welcome">
              {isSkidPage ? <PackageOpen size={36} /> : <Warehouse size={36} />}
              <strong>Select a {isSkidPage ? "skid" : "rack"}</strong>
              <span>Its current contents, location, and movement actions will appear here.</span>
            </div>
          ) : (
            <>
              <header className="storage-detail-header">
                <div>
                  <span className={`storage-state ${selected.status}`}>{labelize(selected.status)}</span>
                  <h3>{isSkidPage ? selected.skid_number : selected.rack_code}</h3>
                  <p><MapPin size={15} /> {isSkidPage ? selected.current_location_display : selected.storage_location_display || selected.location_detail || "Location not assigned"}</p>
                </div>
                {!isSkidPage && <div>
                  {isAdmin && <button className="icon-command" type="button" onClick={() => { setFormRecord(selected); setError(""); }} title="Edit"><Edit3 size={18} /><span>Edit</span></button>}
                  {isAdmin && <button className="icon-command" type="button" onClick={() => { setPrintRecord(selected); setError(""); }} title="Print label"><Printer size={18} /><span>Print</span></button>}
                </div>}
              </header>

              <section className="storage-facts">
                <div><span>{isSkidPage ? "Rolls" : "Skids"}</span><strong>{isSkidPage ? selected.roll_count : selected.skid_count}</strong></div>
                <div><span>{isSkidPage ? "Rack" : "Total Rolls"}</span><strong>{isSkidPage ? selected.current_rack_code || "Floor" : selected.roll_count}</strong></div>
                <div><span>Material</span><strong>{formatFeet(selected.total_remaining_feet)}</strong></div>
                <div><span>Last Move</span><strong>{formatDate(selected.last_movement?.created_at)}</strong></div>
              </section>

              <section className="storage-quick-actions">
                {isSkidPage ? (
                  <>
                    <button className="primary" type="button" onClick={() => openWorkflow("add-roll")} disabled={selected.status !== "active"}><Camera size={20} /><span><strong>Scan Roll</strong><small>Add directly to skid</small></span></button>
                    <button className="storage-move-primary" type="button" onClick={() => openWorkflow("move-to-rack")} disabled={selected.status !== "active"}><Warehouse size={20} /><span><strong>Move Skid</strong><small>Scan rack QR</small></span></button>
                    <div className="storage-action-menu-wrap">
                      <button className="storage-menu-trigger" type="button" onClick={() => setActionMenuOpen((open) => !open)} aria-label="More skid actions" aria-expanded={actionMenuOpen}><Menu size={22} /></button>
                      {actionMenuOpen && (
                        <div className="storage-action-menu">
                          {isAdmin && <button type="button" onClick={() => { setFormRecord(selected); setError(""); setActionMenuOpen(false); }}><Edit3 size={16} /> Edit Skid</button>}
                          {isAdmin && <button type="button" onClick={() => { setPrintRecord(selected); setError(""); setActionMenuOpen(false); }}><Printer size={16} /> Print Skid Label</button>}
                          <button type="button" onClick={() => { setHistoryOpen(true); setActionMenuOpen(false); }}><Clock3 size={16} /> History</button>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <button className="primary" type="button" onClick={() => openWorkflow("add-skid")} disabled={selected.status !== "active"}><Plus size={20} /><span><strong>Add Skid</strong><small>Scan into rack</small></span></button>
                    <button type="button" onClick={() => openWorkflow("remove-skid")} disabled={!selected.skid_count}><CircleOff size={20} /><span><strong>Remove Skid</strong><small>Move to floor</small></span></button>
                  </>
                )}
              </section>

              <section className="storage-contents">
                <header><div><strong>{isSkidPage ? "Rolls on this skid" : "Skids in this rack"}</strong><span>Current active contents</span></div><b>{isSkidPage ? selected.roll_count : selected.skid_count}</b></header>
                <div>
                  {isSkidPage ? selected.rolls?.map((roll) => (
                    <article key={roll.id}>
                      <span className={`storage-status-dot ${roll.status}`} />
                      <div><strong>{rollLabel(roll)}</strong><span>{[roll.material_master_type_code || roll.material_name, roll.width_inches ? `${formatInches(roll.width_inches)} wide` : "", roll.usage_state === "partially_used" ? "Partially used" : ""].filter(Boolean).join(" / ")}</span></div>
                      <b>{formatFeet(roll.length_feet ?? roll.quantity)}</b>
                      <div className="storage-row-actions">
                        <button type="button" onClick={() => onOpenRoll?.(roll)}>Edit Roll</button>
                        <button type="button" onClick={() => openWorkflow("use-roll", roll)}>Use</button>
                        <button type="button" onClick={() => openWorkflow("remove-roll", roll)}>Off Skid</button>
                        {canDeleteMaterialRoll(currentUser) && (
                          <button className="storage-delete-roll" type="button" onClick={() => { setDeleteError(""); setDeleteCandidate(roll); }} title="Remove roll from inventory">
                            <Trash2 size={13} /> Remove Inventory
                          </button>
                        )}
                      </div>
                    </article>
                  )) : selected.skids?.map((skid) => (
                    <article key={skid.id}>
                      <span className={`storage-status-dot ${skid.status}`} />
                      <div><strong>{skid.skid_number}</strong><span>{skid.roll_count} rolls / {formatFeet(skid.total_remaining_feet)}</span></div>
                      <b>{skid.roll_count} rolls</b>
                      <div className="storage-row-actions"><button type="button" onClick={() => openWorkflow("remove-skid", skid.skid_number)}>Remove</button></div>
                    </article>
                  ))}
                  {!(isSkidPage ? selected.rolls?.length : selected.skids?.length) && <p className="storage-empty">No active contents.</p>}
                </div>
              </section>

              {!isSkidPage && (
                <section className="storage-contents">
                  <header><div><strong>Rolls in this rack</strong><span>All active rolls through the skids above</span></div><b>{selected.roll_count}</b></header>
                  <div>
                    {selected.skids?.flatMap((skid) => (skid.rolls || []).map((roll) => (
                      <article key={`${skid.id}-${roll.id}`}>
                        <span className={`storage-status-dot ${roll.status}`} />
                        <div><strong>{rollLabel(roll)}</strong><span>{[skid.skid_number, roll.material_master_type_code || roll.material_name, roll.width_inches ? `${formatInches(roll.width_inches)} wide` : ""].filter(Boolean).join(" / ")}</span></div>
                        <b>{formatFeet(roll.length_feet ?? roll.quantity)}</b>
                      </article>
                    )))}
                    {!selected.roll_count && <p className="storage-empty">No active rolls in this rack.</p>}
                  </div>
                </section>
              )}

              {!isSkidPage && <section className="storage-history-section">
                <header><strong>Movement History</strong><span>Permanent audit trail</span></header>
                <MovementHistory rows={historyQuery.data || []} loading={historyQuery.isLoading} />
              </section>}
            </>
          )}
        </main>
      </div>

      {formRecord !== undefined && <StorageForm mode={mode} record={formRecord} locations={dataQuery.data?.locations || []} busy={busy} error={error} onSave={saveRecord} onClose={() => { setFormRecord(undefined); setError(""); }} />}
      {printRecord && <PrintDialog mode={mode} record={printRecord} presses={dataQuery.data?.presses || []} busy={busy} error={error} onPrint={printLabel} onClose={() => { setPrintRecord(null); setError(""); }} />}
      {workflow && selected && (
        <WorkflowDialog
          mode={mode}
          action={workflow}
          record={selected}
          busy={busy}
          error={error}
          confirmation={moveConfirmation}
          onSubmit={(payload) => runWorkflow(payload)}
          onConfirmMove={() => runWorkflow(lastPayloadRef.current || {}, true)}
          onClose={() => { setWorkflow(null); setMoveConfirmation(null); setError(""); }}
        />
      )}
      {historyOpen && selected && (
        <div className="storage-modal-overlay storage-history-overlay" role="presentation" onMouseDown={() => setHistoryOpen(false)}>
          <section className="storage-modal storage-history-window" role="dialog" aria-modal="true" aria-label={`${selected.skid_number} history`} onMouseDown={(event) => event.stopPropagation()}>
            <header><div><span>{selected.skid_number}</span><h3>Movement History</h3></div><button type="button" onClick={() => setHistoryOpen(false)} aria-label="Close history"><X size={19} /></button></header>
            <MovementHistory rows={historyQuery.data || []} loading={historyQuery.isLoading} />
          </section>
        </div>
      )}
      <DeleteMaterialRollDialog
        roll={deleteCandidate}
        deleting={deleteBusy}
        error={deleteError}
        onCancel={() => {
          if (!deleteBusy) {
            setDeleteCandidate(null);
            setDeleteError("");
          }
        }}
        onConfirm={deleteRollFromInventory}
      />
    </section>
  );
}
