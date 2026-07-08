import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserQRCodeReader } from "@zxing/browser";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Camera,
  CheckCircle2,
  ChevronLeft,
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

function formatInventoryTotals(rows = [], fallback = 0) {
  if (!rows.length) return formatFeet(fallback);
  if (rows.length === 1) {
    const row = rows[0];
    return `${Number(row.amount || 0).toLocaleString(undefined, { maximumFractionDigits: row.unit === "lf" ? 0 : 2 })} ${row.unit}`;
  }
  return `${rows.length} units`;
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

const CAMERA_FIRST_WORKFLOWS = new Set(["add-roll", "add-skid", "move-to-rack"]);

function storageRackLabel(row) {
  return [row?.rack_code, row?.storage_location_display || row?.location_detail].filter(Boolean).join(" / ");
}

function cleanStorageText(value, fallback = "Unassigned") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function rackAisle(row) {
  return cleanStorageText(row?.aisle, "No Aisle");
}

function rackNumber(row) {
  return cleanStorageText(row?.bay, "No Rack Number");
}

function naturalCompare(left, right) {
  return String(left ?? "").localeCompare(String(right ?? ""), undefined, { numeric: true, sensitivity: "base" });
}

function rackSearchText(row) {
  return [
    row.rack_code,
    row.aisle,
    row.bay,
    row.level,
    row.position,
    row.storage_location_display,
    row.location_detail,
    row.status,
    ...(row.skids || []).map((skid) => skid.skid_number),
    ...(row.loose_rolls || []).map((roll) => `${roll.serial_number || ""} ${roll.lot_number || ""} ${roll.material_name || ""}`),
  ].filter(Boolean).join(" ").toLowerCase();
}

function groupedRacks(rows = []) {
  const byAisle = new Map();
  rows.forEach((row) => {
    const aisle = rackAisle(row);
    const number = rackNumber(row);
    if (!byAisle.has(aisle)) {
      byAisle.set(aisle, { key: aisle, racks: [], numbers: new Map(), skidCount: 0, rollCount: 0 });
    }
    const aisleGroup = byAisle.get(aisle);
    aisleGroup.racks.push(row);
    aisleGroup.skidCount += Number(row.skid_count || 0);
    aisleGroup.rollCount += Number(row.roll_count || 0);
    if (!aisleGroup.numbers.has(number)) {
      aisleGroup.numbers.set(number, { key: number, racks: [], skidCount: 0, rollCount: 0 });
    }
    const numberGroup = aisleGroup.numbers.get(number);
    numberGroup.racks.push(row);
    numberGroup.skidCount += Number(row.skid_count || 0);
    numberGroup.rollCount += Number(row.roll_count || 0);
  });
  return Array.from(byAisle.values())
    .map((aisle) => ({
      ...aisle,
      numbers: Array.from(aisle.numbers.values())
        .map((number) => ({ ...number, racks: number.racks.sort((a, b) => naturalCompare(a.rack_code, b.rack_code)) }))
        .sort((a, b) => naturalCompare(a.key, b.key)),
    }))
    .sort((a, b) => naturalCompare(a.key, b.key));
}

function locationPath(row) {
  return row?.full_path || row?.location_full_path || row?.name || "";
}

function locationMatches(row, pattern) {
  return row?.is_active !== false
    && row?.inventory_scope !== "finished_product"
    && pattern.test(`${locationPath(row)} ${row?.code || ""}`);
}

function isFloorLocation(row) {
  return locationMatches(row, /floor/i);
}

function sameFloor(left, right) {
  const clean = (value) => String(value || "")
    .trim()
    .replace(/^wilmington ohio\s*>\s*/i, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
  const a = clean(left);
  const b = clean(right);
  if (!a || !b) return false;
  return a === b || a.endsWith(b) || b.endsWith(a);
}

function floorSearchText(row) {
  return [
    row.name,
    row.full_path,
    row.code,
    row.skids?.map((skid) => skid.skid_number).join(" "),
    row.rolls?.map((roll) => `${roll.serial_number || ""} ${roll.lot_number || ""} ${roll.material_name || ""} ${roll.material_master_type_code || ""}`).join(" "),
  ].filter(Boolean).join(" ").toLowerCase();
}

function activeRolls(rows = []) {
  return rows.filter((row) => row?.is_active !== false && !["depleted", "scrapped"].includes(row?.status));
}

function floorLocationRows(locations = [], skids = [], inventory = []) {
  return locations
    .filter(isFloorLocation)
    .sort((a, b) => naturalCompare(locationPath(a), locationPath(b)))
    .map((location) => {
      const fullPath = locationPath(location);
      const floorSkids = skids.filter((skid) => (
        skid.status === "active"
        && !skid.current_rack
        && sameFloor(skid.other_location || skid.current_location_display || "Plant Floor", fullPath)
      ));
      const looseRolls = activeRolls(inventory).filter((roll) => (
        !roll.current_skid
        && !roll.current_rack
        && !roll.direct_rack
        && (
          String(roll.location || "") === String(location.id)
          || sameFloor(roll.location_full_path || roll.current_location_display || "Plant Floor", fullPath)
        )
      ));
      const skidRolls = floorSkids.flatMap((skid) => skid.rolls || []);
      const rolls = [...looseRolls, ...skidRolls];
      const totalFeet = rolls.reduce((sum, roll) => sum + (Number(roll.length_feet ?? roll.quantity ?? 0) || 0), 0);
      return {
        id: `floor-${location.id}`,
        storage_kind: "floor",
        location_id: location.id,
        name: location.name,
        code: location.code,
        full_path: fullPath,
        status: location.is_active === false ? "inactive" : "active",
        skid_count: floorSkids.length,
        roll_count: rolls.length,
        total_remaining_feet: totalFeet,
        skids: floorSkids,
        rolls,
      };
    });
}

function floorDestinationOptions(locations = [], racks = []) {
  const options = [];
  const pushOption = (key, label, value, detail = "") => {
    if (!value || options.some((option) => option.value.toLowerCase() === String(value).toLowerCase())) return;
    options.push({ key, label, value, detail });
  };
  const plant = locations.find((row) => locationMatches(row, /wilmington.*plant\s*floor|plant\s*floor/i));
  const offsite = locations.find((row) => locationMatches(row, /off[\s-]*site.*floor/i));
  pushOption("plant", "Plant Floor", locationPath(plant) || "Wilmington Ohio > Plant Floor", "General material floor");
  pushOption("offsite", "Off-Site Floor", locationPath(offsite) || "Wilmington Ohio > Off-Site Floor", "Large shipment staging");
  Array.from(new Set(racks.map((rack) => String(rack.aisle || "").trim()).filter(Boolean)))
    .sort(naturalCompare)
    .forEach((aisle) => pushOption(`aisle-${aisle}`, `Aisle ${aisle} Floor`, `Wilmington Ohio > Aisle ${aisle} Floor`, "Temporary aisle staging"));
  return options;
}

function defaultWilmingtonLocationId(locations = []) {
  return (
    locations.find((row) => /wilmington ohio/i.test(locationPath(row)) && !row.parent)?.id
    || locations.find((row) => /wilmington ohio/i.test(locationPath(row)))?.id
    || ""
  );
}

function floorCodeFromName(value) {
  const code = String(value || "Floor")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return code ? `LOC-${code}`.slice(0, 50) : `LOC-FLOOR-${Date.now()}`;
}

function StorageSearchPicker({ label, options, value, onChange, getLabel, placeholder }) {
  const selected = options.find((option) => String(option.id) === String(value) || option.qr_token === value || option.rack_code === value);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const normalizedQuery = query.trim().toLowerCase();
  const visible = options
    .filter((option) => !normalizedQuery || [getLabel(option), option.rack_code, option.qr_token].filter(Boolean).join(" ").toLowerCase().includes(normalizedQuery))
    .slice(0, 30);

  return (
    <label className="storage-scan-input storage-search-picker">
      <span>{label}</span>
      <div className={open ? "open" : ""}>
        <Search size={15} />
        <input
          value={open ? query : selected ? getLabel(selected) : query}
          onFocus={() => { setQuery(""); setOpen(true); }}
          onBlur={() => window.setTimeout(() => setOpen(false), 120)}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            if (value) onChange("");
          }}
          placeholder={placeholder}
          autoComplete="off"
        />
        {value && <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(""); setQuery(""); setOpen(true); }} aria-label={`Clear ${label}`}><X size={14} /></button>}
        {open && (
          <div>
            {visible.map((option) => (
              <button
                className={String(option.id) === String(value) ? "active" : ""}
                type="button"
                key={option.id}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(String(option.id));
                  setQuery("");
                  setOpen(false);
                }}
              >
                <strong>{getLabel(option)}</strong>
              </button>
            ))}
            {!visible.length && <p>No racks found.</p>}
          </div>
        )}
      </div>
    </label>
  );
}

function ScannerOverlay({ title, instruction = "Point the camera at the QR. The action will continue automatically.", onScan, onClose }) {
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
        <p>{instruction}</p>
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

function MaterialLoadingScreen({ title, detail }) {
  return (
    <section className="material-loading-screen" aria-live="polite">
      <div>
        <span><PackageOpen size={24} /></span>
        <strong>{title}</strong>
        <p>{detail}</p>
        <i />
      </div>
    </section>
  );
}

function StorageForm({ mode, record, locations = [], busy, error, onSave, onClose }) {
  const isSkid = mode === "skids";
  const canChooseStorageType = !isSkid && !record;
  const wilmingtonId = defaultWilmingtonLocationId(locations);
  const rackLocations = locations.filter((location) => (
    location.is_active !== false
    && location.inventory_scope !== "finished_product"
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
  const storageRecordType = form.storage_record_type || "rack";
  const floorName = form.floor_type === "offsite"
    ? "Off-Site Floor"
    : form.floor_type === "aisle"
      ? form.aisle ? `Aisle ${form.aisle} Floor` : "Aisle Floor"
      : form.floor_type === "custom"
        ? form.name
        : "Plant Floor";

  function updateForm(next) {
    setForm((current) => ({ ...current, ...next }));
  }

  return (
    <div className="storage-modal-overlay" role="presentation" onMouseDown={onClose}>
      <form className="storage-modal" onSubmit={(event) => { event.preventDefault(); onSave(form); }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <span>{record ? "Edit" : "Create"}</span>
            <h3>{isSkid ? record?.skid_number || "New Skid" : record?.rack_code || (storageRecordType === "floor" ? "New Floor" : "New Rack")}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        {canChooseStorageType && (
          <div className="storage-kind-toggle" role="tablist" aria-label="Storage type">
            <button className={storageRecordType === "rack" ? "active" : ""} type="button" onClick={() => updateForm({ storage_record_type: "rack" })}><Warehouse size={16} /> Rack</button>
            <button className={storageRecordType === "floor" ? "active" : ""} type="button" onClick={() => updateForm({ storage_record_type: "floor", parent: form.parent || wilmingtonId, floor_type: form.floor_type || "plant" })}><MapPin size={16} /> Floor</button>
          </div>
        )}
        <div className="storage-form-grid">
          {!isSkid && storageRecordType === "rack" && (
            <label className="wide"><span>Rack ID</span><input value={form.rack_code} onChange={(event) => updateForm({ rack_code: event.target.value.toUpperCase() })} placeholder="RACK-03-A" required /></label>
          )}
          {!isSkid && storageRecordType === "rack" && (
            <label className="wide">
              <span>Warehouse Location</span>
              <select value={form.location || ""} onChange={(event) => updateForm({ location: event.target.value })} required>
                <option value="">Select warehouse location</option>
                {rackLocations.map((location) => (
                  <option value={location.id} key={location.id}>{location.full_path || location.name}</option>
                ))}
              </select>
            </label>
          )}
          {!isSkid && storageRecordType === "rack" && <label><span>Aisle</span><input value={form.aisle} onChange={(event) => updateForm({ aisle: event.target.value })} /></label>}
          {!isSkid && storageRecordType === "rack" && <label><span>Rack Number</span><input value={form.bay} onChange={(event) => updateForm({ bay: event.target.value })} /></label>}
          {!isSkid && storageRecordType === "rack" && <label><span>Level</span><input value={form.level} onChange={(event) => updateForm({ level: event.target.value })} /></label>}
          {!isSkid && storageRecordType === "rack" && <label><span>Position</span><input value={form.position} onChange={(event) => updateForm({ position: event.target.value })} /></label>}
          {!isSkid && storageRecordType === "floor" && (
            <>
              <label className="wide">
                <span>Floor Type</span>
                <select value={form.floor_type || "plant"} onChange={(event) => updateForm({ floor_type: event.target.value })}>
                  <option value="plant">Wilmington Plant Floor</option>
                  <option value="offsite">Wilmington Off-Site Floor</option>
                  <option value="aisle">Aisle Floor</option>
                  <option value="custom">Custom Floor Area</option>
                </select>
              </label>
              {(form.floor_type || "plant") === "aisle" && <label><span>Aisle</span><input value={form.aisle || ""} onChange={(event) => updateForm({ aisle: event.target.value })} placeholder="03" required /></label>}
              {(form.floor_type || "plant") === "custom" && <label><span>Floor Name</span><input value={form.name || ""} onChange={(event) => updateForm({ name: event.target.value })} placeholder="Receiving Floor" required /></label>}
              <label className="wide">
                <span>Parent Location</span>
                <select value={form.parent || wilmingtonId || ""} onChange={(event) => updateForm({ parent: event.target.value })} required>
                  <option value="">Select parent location</option>
                  {rackLocations.map((location) => (
                    <option value={location.id} key={location.id}>{location.full_path || location.name}</option>
                  ))}
                </select>
              </label>
              <div className="wide floor-preview">
                <MapPin size={18} />
                <div><span>New floor location</span><strong>{floorName || "Floor"}</strong><small>Shows up in Add Material as a floor destination.</small></div>
              </div>
            </>
          )}
          {isSkid && <label className="wide"><span>Other Location</span><input value={form.other_location} onChange={(event) => updateForm({ other_location: event.target.value })} placeholder="Leave blank for Plant Floor" /></label>}
          {(isSkid || storageRecordType === "rack") && <label>
            <span>Status</span>
            <select value={form.status} onChange={(event) => updateForm({ status: event.target.value })}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              {isSkid && <option value="retired">Retired</option>}
            </select>
          </label>}
          <label className="wide"><span>Notes</span><textarea value={form.notes} onChange={(event) => updateForm({ notes: event.target.value })} /></label>
        </div>
        {error && <div className="storage-message error"><AlertTriangle size={17} /><span>{error}</span></div>}
        <footer>
          <button className="ghost-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="submit" disabled={busy}>{busy ? "Saving..." : record ? "Save Changes" : isSkid ? "Create Skid" : storageRecordType === "floor" ? "Create Floor" : "Create Rack"}</button>
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
          <div><span>3 x 3 Zebra Label</span><h3>Print {mode === "skids" ? record.skid_number : record.rack_code}</h3></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className="storage-print-preview skid-label-preview">
          <QrCode size={116} />
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

function OfflineMovementForms({ onClose }) {
  const today = new Date().toLocaleDateString();
  return (
    <div className="storage-modal-overlay offline-form-overlay" role="presentation" onMouseDown={onClose}>
      <section className="storage-modal offline-form-window" role="dialog" aria-modal="true" aria-label="Offline movement forms" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>Wifi Backup</span><h3>Offline Material Forms</h3></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className="offline-form-actions">
          <p>Print these before working in the off-site area. When wifi is back, enter the sheet into Add Material, Skids, or Locations.</p>
          <button className="primary-btn" type="button" onClick={() => window.print()}><Printer size={16} /> Print Forms</button>
        </div>
        <main className="offline-print-pack">
          {[
            ["Material Receiving", ["Material Type", "Supplier / Company", "Shipment Lot", "Width", "Length per Roll", "Roll Count", "Storage: Plant Floor / Off-Site Floor / Rack", "Notes"]],
            ["Skid Movement", ["Skid #", "From Location", "To Rack / Floor", "Moved By", "Date / Time", "Notes"]],
            ["Roll Usage / Hold", ["Roll ID / Lot", "Job / Press", "Feet Used", "Remaining Estimate", "Use Entire Roll?", "Hold / Damage Notes", "Operator"]],
          ].map(([title, fields]) => (
            <article className="offline-form-sheet" key={title}>
              <header>
                <strong>{title}</strong>
                <span>{today}</span>
              </header>
              <div>
                {fields.map((field) => (
                  <label key={field}><span>{field}</span><i /></label>
                ))}
              </div>
              <footer>
                <label><span>Entered in system by</span><i /></label>
                <label><span>Date entered</span><i /></label>
              </footer>
            </article>
          ))}
        </main>
      </section>
    </div>
  );
}

function FloorMoveDialog({ skid, options = [], busy, error, onMove, onClose }) {
  const [value, setValue] = useState(options[0]?.value || "Wilmington Ohio > Plant Floor");
  const [custom, setCustom] = useState("");
  const movingToCustom = value === "__custom__";
  const destination = movingToCustom ? custom.trim() : value;

  return (
    <div className="storage-modal-overlay" role="presentation" onMouseDown={onClose}>
      <form className="storage-modal floor-move-modal" onSubmit={(event) => { event.preventDefault(); onMove(destination); }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div><span>{skid?.skid_number}</span><h3>Move To Floor</h3></div>
          <button type="button" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </header>
        <div className="floor-destination-list">
          {options.map((option) => (
            <button className={value === option.value ? "active" : ""} type="button" key={option.key} onClick={() => setValue(option.value)}>
              <MapPin size={18} />
              <span><strong>{option.label}</strong><small>{option.detail || option.value}</small></span>
            </button>
          ))}
          <button className={movingToCustom ? "active" : ""} type="button" onClick={() => setValue("__custom__")}>
            <Plus size={18} />
            <span><strong>Other Floor</strong><small>Type a temporary floor area</small></span>
          </button>
        </div>
        {movingToCustom && (
          <div className="storage-form-grid">
            <label className="wide"><span>Floor Location</span><input value={custom} onChange={(event) => setCustom(event.target.value)} placeholder="Wilmington Ohio > Aisle 03 Floor" required /></label>
          </div>
        )}
        {error && <div className="storage-message error"><AlertTriangle size={17} /><span>{error}</span></div>}
        <footer>
          <button className="ghost-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="primary-btn" type="submit" disabled={busy || !destination}>{busy ? "Moving..." : "Move Skid"}</button>
        </footer>
      </form>
    </div>
  );
}

function WorkflowDialog({ mode, action, record, racks = [], busy, error, confirmation, onSubmit, onConfirmMove, onClose }) {
  const isSkidPage = mode === "skids";
  const selectedRoll = action?.roll || null;
  const cameraFirst = CAMERA_FIRST_WORKFLOWS.has(action?.type);
  const [scanValue, setScanValue] = useState(selectedRoll ? String(selectedRoll.id) : action?.value || "");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [useAll, setUseAll] = useState(false);
  const [cameraOpen, setCameraOpen] = useState(cameraFirst);
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

  function chooseRack(value) {
    setCameraOpen(false);
    setScanValue(value);
    setRiskyConfirmed(false);
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
      <div className={`storage-modal-overlay ${cameraFirst ? "scan-roll-overlay" : ""} ${selectedRoll ? "selected-roll-overlay" : ""}`} role="presentation" onMouseDown={onClose}>
        <form className={`storage-modal storage-workflow-modal ${cameraFirst ? "scan-roll-workflow" : ""} ${selectedRoll ? "selected-roll-workflow" : ""} ${isUse ? "use-roll-workflow" : ""}`} onSubmit={(event) => { event.preventDefault(); submit(); }} onMouseDown={(event) => event.stopPropagation()}>
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
                <input autoFocus={!cameraFirst} value={scanValue} onChange={(event) => { setScanValue(event.target.value); setRiskyConfirmed(false); }} placeholder={`Scan ${scanName} now`} required />
              </label>
              {action?.type === "move-to-rack" && (
                <StorageSearchPicker
                  label="Or Search Rack"
                  options={racks.filter((row) => row.status === "active")}
                  value={scanValue}
                  onChange={chooseRack}
                  getLabel={storageRackLabel}
                  placeholder="Rack code or location"
                />
              )}
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
      {cameraOpen && (
        <ScannerOverlay
          title={`Scan ${scanName} QR`}
          instruction={`Point the camera at the ${scanName} QR. The action will continue automatically.`}
          onScan={handleScan}
          onClose={() => setCameraOpen(false)}
        />
      )}
    </>
  );
}

export default function MaterialStorageView({ mode, currentUser, initialToken = "", onClearToken = () => {}, onNavigate, onOpenRoll }) {
  const isSkidPage = mode === "skids";
  const endpoint = isSkidPage ? "skids" : "racks";
  const isAdmin = String(currentUser?.role || "").toLowerCase() === "admin";
  const [selectedId, setSelectedId] = useState("");
  const [search, setSearch] = useState("");
  const [locationTab, setLocationTab] = useState("all");
  const [formRecord, setFormRecord] = useState(undefined);
  const [workflow, setWorkflow] = useState(null);
  const [printRecord, setPrintRecord] = useState(null);
  const [offlineFormsOpen, setOfflineFormsOpen] = useState(false);
  const [floorMoveOpen, setFloorMoveOpen] = useState(false);
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
      const [records, presses, locations, rackRecords, skidRecords, inventoryRecords] = await Promise.all([
        fetchCollection(endpoint, { ordering: isSkidPage ? "-created_at" : "rack_code", pageSize: 1000, fetchAll: true }),
        fetchCollection("presses", { ordering: "name", pageSize: 500, fetchAll: true }),
        fetchCollection("locations", { ordering: "name", pageSize: 1000, fetchAll: true }),
        isSkidPage
          ? fetchCollection("racks", { ordering: "rack_code", pageSize: 1000, fetchAll: true })
          : Promise.resolve({ results: [] }),
        isSkidPage
          ? Promise.resolve({ results: [] })
          : fetchCollection("skids", { ordering: "-created_at", pageSize: 1000, fetchAll: true }),
        isSkidPage
          ? Promise.resolve({ results: [] })
          : fetchCollection("raw-materials", { ordering: "material_type,name,serial_number", pageSize: 1000, fetchAll: true }),
      ]);
      return {
        records: records.results || [],
        presses: presses.results || [],
        locations: locations.results || [],
        racks: isSkidPage ? rackRecords.results || [] : records.results || [],
        skids: skidRecords.results || [],
        inventory: inventoryRecords.results || [],
      };
    },
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const records = dataQuery.data?.records || [];
  const floorRows = useMemo(
    () => isSkidPage ? [] : floorLocationRows(dataQuery.data?.locations || [], dataQuery.data?.skids || [], dataQuery.data?.inventory || []),
    [isSkidPage, dataQuery.data?.locations, dataQuery.data?.skids, dataQuery.data?.inventory]
  );
  const selectedFloor = floorRows.find((row) => String(row.id) === String(selectedId)) || null;
  const selectedRack = records.find((row) => String(row.id) === String(selectedId)) || null;
  const selected = selectedFloor || selectedRack;
  const selectedIsFloor = Boolean(selected?.storage_kind === "floor");
  const floorOptions = useMemo(
    () => floorDestinationOptions(dataQuery.data?.locations || [], dataQuery.data?.racks || []),
    [dataQuery.data?.locations, dataQuery.data?.racks]
  );
  const canMoveSelectedSkidToFloor = Boolean(
    isSkidPage
    && selected
    && selected.status === "active"
  );
  const rackRolls = !isSkidPage && selected ? [
    ...(selected.loose_rolls || []).map((roll) => ({ ...roll, storage_skid_number: "" })),
    ...(selected.skids || []).flatMap((skid) => (skid.rolls || []).map((roll) => ({ ...roll, storage_skid_number: skid.skid_number }))),
  ] : [];
  const historyQuery = useQuery({
    queryKey: ["material-storage-history", mode, selected?.id],
    queryFn: () => requestApi(`${endpoint}/${selected.id}/history`, { headers: userHeaders(currentUser) }),
    enabled: Boolean(selected?.id && !selectedIsFloor),
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
    setFloorMoveOpen(false);
    setHistoryOpen(false);
  }, [selectedId]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!isSkidPage && locationTab === "floor") return [];
    return records.filter((row) => !query || (isSkidPage ? JSON.stringify(row).toLowerCase().includes(query) : rackSearchText(row).includes(query)));
  }, [records, search, isSkidPage, locationTab]);
  const filteredFloors = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (locationTab === "racks") return [];
    return floorRows.filter((row) => !query || floorSearchText(row).includes(query));
  }, [floorRows, search, locationTab]);
  const rackGroups = useMemo(() => groupedRacks(filtered), [filtered]);

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
      if (!isSkidPage && creating && form.storage_record_type === "floor") {
        const name = form.floor_type === "offsite"
          ? "Off-Site Floor"
          : form.floor_type === "aisle"
            ? `Aisle ${String(form.aisle || "").trim()} Floor`.replace(/\s+/g, " ").trim()
            : form.floor_type === "custom"
              ? String(form.name || "").trim()
              : "Plant Floor";
        if (!name || name === "Aisle Floor") throw new Error(JSON.stringify({ detail: "Enter the aisle for this floor location." }));
        const existing = (dataQuery.data?.locations || []).find((location) => (
          location.is_active !== false
          && location.inventory_scope !== "finished_product"
          && String(locationPath(location)).toLowerCase().endsWith(name.toLowerCase())
        ));
        if (existing) {
          setFormRecord(undefined);
          setSuccess(`${locationPath(existing)} already exists and is ready for material.`);
          await refresh();
          return;
        }
        const location = await requestApi("locations", {
          method: "POST",
          headers: userHeaders(currentUser),
          body: JSON.stringify({
            name,
            code: form.code || floorCodeFromName(name),
            location_type: "position",
            inventory_scope: "raw_material",
            parent: form.parent || defaultWilmingtonLocationId(dataQuery.data?.locations || []) || null,
            is_active: true,
            notes: form.notes || "",
          }),
        });
        setFormRecord(undefined);
        setSuccess(`${location.full_path || location.name} created as a material floor.`);
        await refresh();
        return;
      }
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

  async function moveSelectedSkidToFloor(floorLocation = "") {
    if (!selected || !isSkidPage) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      const result = await requestApi(`${endpoint}/${selected.id}/move-to-floor`, {
        method: "POST",
        headers: userHeaders(currentUser),
        body: JSON.stringify({ performed_by: currentUser?.name || "", floor_location: floorLocation }),
      });
      setFloorMoveOpen(false);
      setSuccess(result.completed || `${selected.skid_number} moved to the production floor.`);
      await refresh(selected.id);
    } catch (moveError) {
      setError(errorPayload(moveError).detail);
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

  function closeSelectedDetail() {
    setSelectedId("");
    setSuccess("");
    setError("");
    if (initialToken) onClearToken();
  }

  if (initialToken && (dataQuery.isLoading || (!selected && !error))) {
    return <ScanLinkScreen kind={isSkidPage ? "skid" : "rack"} />;
  }

  return (
    <section className={`material-storage-view ${initialToken && selected ? "scanned-storage-view" : ""}`}>
      <header className="storage-hero">
        <div>
          <span>{isSkidPage ? "Material movement" : "Plant locations"}</span>
          <h2>{isSkidPage ? "Skids" : "Locations"}</h2>
          <p>{isSkidPage ? "Scan rolls onto skids and follow every movement." : "See floor areas, rack locations, and the material stored there."}</p>
        </div>
        <div>
          <button className="ghost-btn" type="button" onClick={() => dataQuery.refetch()}><RefreshCcw size={16} /> Refresh</button>
          <button className="ghost-btn" type="button" onClick={() => setOfflineFormsOpen(true)}><Printer size={16} /> Offline Forms</button>
          {isAdmin && <button className="primary-btn" type="button" onClick={() => { setFormRecord(null); setError(""); }}><Plus size={17} /> {isSkidPage ? "New Skid" : "New Location"}</button>}
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

      {dataQuery.isLoading && !records.length ? (
        <MaterialLoadingScreen
          title={`Loading ${isSkidPage ? "Skids" : "Locations"}`}
          detail={isSkidPage ? "Pulling current skid contents, roll counts, and rack positions." : "Pulling floor areas, rack positions, skids, and material stored inside."}
        />
      ) : (
      <div className="storage-layout">
        <aside className="storage-list-panel">
          <label className="storage-search"><Search size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={`Search ${isSkidPage ? "skid, roll, or rack" : "floor, rack, skid, or roll"}...`} /></label>
          {!isSkidPage && (
            <div className="storage-location-tabs" role="tablist" aria-label="Location groups">
              <button className={locationTab === "all" ? "active" : ""} type="button" onClick={() => setLocationTab("all")}>All</button>
              <button className={locationTab === "floor" ? "active" : ""} type="button" onClick={() => setLocationTab("floor")}>Floor</button>
              <button className={locationTab === "racks" ? "active" : ""} type="button" onClick={() => setLocationTab("racks")}>Racks</button>
            </div>
          )}
          <div className="storage-list">
            {isSkidPage ? filtered.map((row) => {
                const active = String(row.id) === String(selected?.id);
                return (
                  <button className={active ? "active" : ""} type="button" onClick={() => { setSelectedId(String(row.id)); setSuccess(""); setError(""); }} key={row.id}>
                    <span className={`storage-status-dot ${row.status}`} />
                    <div>
                      <strong>{row.skid_number}</strong>
                      <span>{row.current_location_display}</span>
                      <small>{row.roll_count} rolls / {formatFeet(row.total_remaining_feet)}</small>
                    </div>
                    <ChevronRight size={17} />
                  </button>
                );
              }) : (
                <div className="rack-grouped-list">
                  {filteredFloors.length > 0 && (
                    <details className="rack-aisle-group floor-location-group" defaultOpen>
                      <summary>
                        <span>Group</span>
                        <strong>Floor</strong>
                        <em>{filteredFloors.length} floor location{filteredFloors.length === 1 ? "" : "s"}</em>
                      </summary>
                      <div className="floor-location-items rack-number-items">
                        {filteredFloors.map((row) => {
                          const active = String(row.id) === String(selected?.id);
                          return (
                            <button className={active ? "active" : ""} type="button" onClick={() => { setSelectedId(String(row.id)); setSuccess(""); setError(""); }} key={row.id}>
                              <span className={`storage-status-dot ${row.status}`} />
                              <div>
                                <strong>{row.name}</strong>
                                <span>{row.full_path || "Floor location"}</span>
                                <small>{row.skid_count} skids / {row.roll_count} rolls / {formatFeet(row.total_remaining_feet)}</small>
                              </div>
                              <ChevronRight size={17} />
                            </button>
                          );
                        })}
                      </div>
                    </details>
                  )}
                  {rackGroups.map((aisle) => (
                    <details className="rack-aisle-group" defaultOpen key={aisle.key}>
                      <summary>
                        <span>Aisle</span>
                        <strong>{aisle.key}</strong>
                        <em>{aisle.racks.length} rack{aisle.racks.length === 1 ? "" : "s"} / {aisle.skidCount} skids / {aisle.rollCount} rolls</em>
                      </summary>
                      {aisle.numbers.map((number) => (
                        <details className="rack-number-group" defaultOpen key={`${aisle.key}-${number.key}`}>
                          <summary>
                            <span>Rack Number</span>
                            <strong>{number.key}</strong>
                            <em>{number.racks.length} location{number.racks.length === 1 ? "" : "s"}</em>
                          </summary>
                          <div className="rack-number-items">
                            {number.racks.map((row) => {
                              const active = String(row.id) === String(selected?.id);
                              return (
                                <button className={active ? "active" : ""} type="button" onClick={() => { setSelectedId(String(row.id)); setSuccess(""); setError(""); }} key={row.id}>
                                  <span className={`storage-status-dot ${row.status}`} />
                                  <div>
                                    <strong>{row.rack_code}</strong>
                                    <span>{row.storage_location_display || row.location_detail || "Location not assigned"}</span>
                                    <small>{row.skid_count} skids / {row.roll_count} rolls</small>
                                  </div>
                                  <ChevronRight size={17} />
                                </button>
                              );
                            })}
                          </div>
                        </details>
                      ))}
                    </details>
                  ))}
                </div>
              )}
            {!dataQuery.isLoading && !filtered.length && (isSkidPage || !filteredFloors.length) && <p className="storage-empty">No {isSkidPage ? "skids" : "locations"} match this search.</p>}
          </div>
        </aside>
      </div>
      )}

      {selected && (
        <div className="storage-detail-overlay" role="presentation" onMouseDown={closeSelectedDetail}>
          <main
            className={`storage-detail-panel ${isSkidPage ? "skid-detail-panel" : ""} has-selection`}
            role="dialog"
            aria-modal="true"
            aria-label={`${isSkidPage ? selected.skid_number : selectedIsFloor ? selected.name : selected.rack_code} details`}
            onMouseDown={(event) => event.stopPropagation()}
          >
              <header className="storage-detail-header">
                <button className="storage-mobile-back" type="button" onClick={closeSelectedDetail} aria-label={`Back to ${isSkidPage ? "skids" : "locations"}`}><ChevronLeft size={20} /></button>
                <div>
                  <span className={`storage-state ${selected.status}`}>{selectedIsFloor ? "Floor" : labelize(selected.status)}</span>
                  <h3>{isSkidPage ? selected.skid_number : selectedIsFloor ? selected.name : selected.rack_code}</h3>
                  <p><MapPin size={15} /> {isSkidPage ? selected.current_location_display : selectedIsFloor ? selected.full_path : selected.storage_location_display || selected.location_detail || "Location not assigned"}</p>
                </div>
                {!isSkidPage && !selectedIsFloor && <div>
                  {isAdmin && <button className="icon-command" type="button" onClick={() => { setFormRecord(selected); setError(""); }} title="Edit"><Edit3 size={18} /><span>Edit</span></button>}
                  {isAdmin && <button className="icon-command" type="button" onClick={() => { setPrintRecord(selected); setError(""); }} title="Print label"><Printer size={18} /><span>Print</span></button>}
                </div>}
              </header>

              <section className="storage-facts">
                <div><span>{isSkidPage ? "Rolls" : "Skids"}</span><strong>{isSkidPage ? selected.roll_count : selected.skid_count}</strong></div>
                <div><span>{isSkidPage ? "Rack" : "Total Rolls"}</span><strong>{isSkidPage ? selected.current_rack_code || "Floor" : selected.roll_count}</strong></div>
                <div><span>Material</span><strong>{isSkidPage ? formatFeet(selected.total_remaining_feet) : selectedIsFloor ? formatFeet(selected.total_remaining_feet) : formatInventoryTotals(selected.inventory_totals, selected.total_remaining_feet)}</strong></div>
                <div><span>{selectedIsFloor ? "Type" : "Last Move"}</span><strong>{selectedIsFloor ? "Floor" : formatDate(selected.last_movement?.created_at)}</strong></div>
              </section>

              {!selectedIsFloor && <section className="storage-quick-actions">
                {isSkidPage ? (
                  <>
                    <button className="primary" type="button" onClick={() => openWorkflow("add-roll")} disabled={selected.status !== "active"}><Camera size={20} /><span><strong>Scan Roll</strong><small>Add directly to skid</small></span></button>
                    <button className="storage-move-primary" type="button" onClick={() => openWorkflow("move-to-rack")} disabled={selected.status !== "active"}><Warehouse size={20} /><span><strong>To Rack</strong><small>Scan rack QR</small></span></button>
                    <button className="storage-floor-primary" type="button" onClick={() => { setFloorMoveOpen(true); setError(""); }} disabled={busy || !canMoveSelectedSkidToFloor}><MapPin size={20} /><span><strong>To Floor</strong><small>Plant, off-site, aisle</small></span></button>
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
              </section>}

              <section className="storage-contents">
                <header><div><strong>{isSkidPage ? "Rolls on this skid" : selectedIsFloor ? "Skids on this floor" : "Skids in this rack"}</strong><span>Current active contents</span></div><b>{isSkidPage ? selected.roll_count : selected.skid_count}</b></header>
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
                      {!selectedIsFloor && <div className="storage-row-actions"><button type="button" onClick={() => openWorkflow("remove-skid", skid.skid_number)}>Remove</button></div>}
                    </article>
                  ))}
                  {!(isSkidPage ? selected.rolls?.length : selected.skids?.length) && <p className="storage-empty">No active contents.</p>}
                </div>
              </section>

              {!isSkidPage && (
                <section className="storage-contents">
                  <header><div><strong>{selectedIsFloor ? "Material on this floor" : "Material in this rack"}</strong><span>{selectedIsFloor ? "Loose material and rolls sitting on floor skids" : "Loose material and rolls stored on skids"}</span></div><b>{selected.roll_count}</b></header>
                  <div>
                    {(selectedIsFloor ? selected.rolls || [] : rackRolls).map((roll) => (
                      <article key={`${roll.storage_skid_number || "loose"}-${roll.id}`}>
                        <span className={`storage-status-dot ${roll.status}`} />
                        <div><strong>{rollLabel(roll)}</strong><span>{[roll.storage_skid_number || (selectedIsFloor ? "Direct on floor" : "Direct in rack"), roll.material_master_type_code || roll.material_name, roll.width_inches ? `${formatInches(roll.width_inches)} wide` : ""].filter(Boolean).join(" / ")}</span></div>
                        <b>{roll.unit === "lf" ? formatFeet(roll.length_feet ?? roll.quantity) : `${Number(roll.quantity || 0).toLocaleString()} ${roll.unit}`}</b>
                        <div className="storage-row-actions">
                          <button type="button" onClick={() => onOpenRoll?.(roll)}>Edit Roll</button>
                          {canDeleteMaterialRoll(currentUser) && (
                            <button className="storage-delete-roll" type="button" onClick={() => { setDeleteError(""); setDeleteCandidate(roll); }}><Trash2 size={13} /> Remove Inventory</button>
                          )}
                        </div>
                      </article>
                    ))}
                    {!selected.roll_count && <p className="storage-empty">No active rolls in this {selectedIsFloor ? "floor location" : "rack"}.</p>}
                  </div>
                </section>
              )}

              {!isSkidPage && !selectedIsFloor && <section className="storage-history-section">
                <header><strong>Movement History</strong><span>Permanent audit trail</span></header>
                <MovementHistory rows={historyQuery.data || []} loading={historyQuery.isLoading} />
              </section>}
          </main>
        </div>
      )}

      {formRecord !== undefined && <StorageForm mode={mode} record={formRecord} locations={dataQuery.data?.locations || []} busy={busy} error={error} onSave={saveRecord} onClose={() => { setFormRecord(undefined); setError(""); }} />}
      {printRecord && <PrintDialog mode={mode} record={printRecord} presses={dataQuery.data?.presses || []} busy={busy} error={error} onPrint={printLabel} onClose={() => { setPrintRecord(null); setError(""); }} />}
      {offlineFormsOpen && <OfflineMovementForms onClose={() => setOfflineFormsOpen(false)} />}
      {floorMoveOpen && selected && (
        <FloorMoveDialog
          skid={selected}
          options={floorOptions}
          busy={busy}
          error={error}
          onMove={moveSelectedSkidToFloor}
          onClose={() => { setFloorMoveOpen(false); setError(""); }}
        />
      )}
      {workflow && selected && (
        <WorkflowDialog
          mode={mode}
          action={workflow}
          record={selected}
          racks={dataQuery.data?.racks || []}
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
