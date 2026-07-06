import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Camera, CheckCircle2, Filter, History, MapPin, PackageCheck, Save, Search, X } from "lucide-react";
import { fetchCollection, postRecordAction, updateRecord } from "../api";
import { formatInches, labelize } from "../lib/format";
import ScanLinkScreen from "./ScanLinkScreen";

const activeJobKey = "tsm_active_material_job_v1";

function sameId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return String(left) === String(right);
}

function footage(row) {
  return Number(row?.length_feet ?? row?.quantity ?? 0) || 0;
}

function locationName(row) {
  return row?.current_location_display || row?.location_full_path || row?.location_name || "Plant Floor";
}

function widthName(row) {
  return row?.width_inches ? `${formatInches(row.width_inches)} wide` : "No width";
}

function materialName(row) {
  return row?.material_master_type_code || row?.material_family || row?.material_name || row?.name || "Material";
}

function readActiveJob() {
  try {
    return JSON.parse(window.localStorage.getItem(activeJobKey) || "null");
  } catch {
    return null;
  }
}

function runDateForRolls(rolls) {
  const counts = new Map();
  rolls.forEach((roll) => {
    const date = String(roll.run_date || roll.created_at || "").slice(0, 10);
    if (date) counts.set(date, (counts.get(date) || 0) + 1);
  });
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] || "";
}

function extractRollTagId(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  try {
    const url = new URL(text);
    return url.searchParams.get("rollTagId") || "";
  } catch {
    const match = /(?:rollTagId=)?(\d+)/i.exec(text);
    return match?.[1] || "";
  }
}

function inventoryGroups(rows, mode) {
  const groups = new Map();
  rows.forEach((row) => {
    const key = mode === "location" ? locationName(row) : widthName(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  });
  return Array.from(groups.entries()).sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }));
}

function ActiveInventory({ rows, groupMode, selectedId, relatedRollIds, onSelect }) {
  return (
    <div className="material-handling-groups">
      {inventoryGroups(rows, groupMode).map(([group, groupRows]) => (
        <section key={group}>
          <header>
            <div>{groupMode === "location" ? <MapPin size={15} /> : <Filter size={15} />}<strong>{group}</strong></div>
            <span>{groupRows.length} roll{groupRows.length === 1 ? "" : "s"}</span>
            <b>{Math.round(groupRows.reduce((sum, row) => sum + footage(row), 0)).toLocaleString()} ft</b>
          </header>
          <div>
            {groupRows.map((row) => (
              <button className={sameId(row.id, selectedId) ? "active" : ""} type="button" key={row.id} onClick={() => onSelect(row)}>
                <span className={`material-roll-status ${row.status}`} />
                <div>
                  <strong>{row.serial_number || row.source_roll_tag_number || row.lot_number}</strong>
                  <span>{[materialName(row), widthName(row), locationName(row)].join(" / ")}</span>
                </div>
                <b>{Math.round(footage(row)).toLocaleString()} ft</b>
                <em>{relatedRollIds.has(String(row.source_roll_tag || "")) ? "Same run" : labelize(row.status)}</em>
              </button>
            ))}
          </div>
        </section>
      ))}
      {!rows.length && <p className="material-handling-empty">No active rolls match these filters.</p>}
    </div>
  );
}

function UsageHistory({ rows, rolls, search }) {
  const events = [
    ...rolls.map((roll) => ({
      ...roll,
      id: `roll-${roll.id}`,
      used_date: roll.run_date || roll.created_at,
      reference: roll.schedule_tag_number,
      inventory_serial: roll.tag_number,
      quantity: roll.length_feet,
      unit: "ft",
      used_by: roll.operator,
      job_name: "Master roll documented",
    })),
    ...rows,
  ];
  const filtered = events.filter((row) => {
    const text = `${row.used_date} ${row.reference} ${row.production_schedule} ${row.job_ticket_number} ${row.job_name} ${row.inventory_serial} ${row.used_by} ${row.notes}`.toLowerCase();
    return !search || text.includes(search.toLowerCase());
  });
  const byDate = new Map();
  filtered.forEach((row) => {
    const date = String(row.used_date || row.created_at || "").slice(0, 10) || "No date";
    if (!byDate.has(date)) byDate.set(date, []);
    byDate.get(date).push(row);
  });
  return (
    <div className="material-handling-history">
      {Array.from(byDate.entries()).sort(([a], [b]) => b.localeCompare(a)).map(([date, dateRows]) => (
        <section key={date}>
          <header><strong>{date}</strong><span>{dateRows.length} event{dateRows.length === 1 ? "" : "s"}</span></header>
          <div>
            {dateRows.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.inventory_serial || row.coater_roll_tag_number || row.reference || "Material usage"}</strong>
                  <span>{[row.job_ticket_number || row.reference, row.used_by, row.notes].filter(Boolean).join(" / ")}</span>
                </div>
                <b>{Number(row.quantity || 0).toLocaleString()} {row.unit || "lf"}</b>
              </article>
            ))}
          </div>
        </section>
      ))}
      {!filtered.length && <p className="material-handling-empty">No historical usage matches this search.</p>}
    </div>
  );
}

function RollDetail({ roll, locations, schedules, activeJob, currentUser, saving, error, notice, onSave, onConsume }) {
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState(() => ({
    lot_number: roll.lot_number || "",
    width_inches: roll.width_inches || "",
    location: roll.location || "",
    notes: roll.notes || "",
  }));
  const [useForm, setUseForm] = useState(() => ({
    production_schedule: activeJob?.scheduleId || "",
    mode: "full",
    used_feet: "",
    used_by: currentUser?.name || "",
    poor_run: false,
    notes: "",
  }));
  const available = footage(roll);
  const entered = Number(useForm.used_feet || 0);
  const buffered = useForm.mode === "partial" ? Math.min(available, entered * 1.03) : available;

  useEffect(() => {
    setEditForm({
      lot_number: roll.lot_number || "",
      width_inches: roll.width_inches || "",
      location: roll.location || "",
      notes: roll.notes || "",
    });
    setEditing(false);
  }, [roll.id]);

  return (
    <aside className="material-handling-detail">
      <header>
        <div><span>Selected Roll</span><strong>{roll.serial_number || roll.source_roll_tag_number || roll.lot_number}</strong></div>
        <b>{Math.round(available).toLocaleString()} ft active</b>
      </header>
      <div className="material-handling-roll-facts">
        <div><span>Material</span><strong>{materialName(roll)}</strong></div>
        <div><span>Width</span><strong>{widthName(roll)}</strong></div>
        <div><span>Location</span><strong>{locationName(roll)}</strong></div>
        <div><span>Status</span><strong>{labelize(roll.status)}</strong></div>
      </div>

      <button className="ghost-btn" type="button" onClick={() => setEditing((value) => !value)}>
        <Save size={15} /> {editing ? "Close Roll Editor" : "Edit Roll"}
      </button>
      {editing && (
        <form className="material-handling-edit" onSubmit={(event) => { event.preventDefault(); onSave(editForm); }}>
          <label><span>Lot Number</span><input value={editForm.lot_number} onChange={(event) => setEditForm((form) => ({ ...form, lot_number: event.target.value }))} /></label>
          <label><span>Width</span><input type="number" step="0.001" value={editForm.width_inches} onChange={(event) => setEditForm((form) => ({ ...form, width_inches: event.target.value }))} /></label>
          <label className="wide"><span>Location</span><select value={editForm.location || ""} onChange={(event) => setEditForm((form) => ({ ...form, location: event.target.value }))}><option value="">No location</option>{locations.map((location) => <option value={location.id} key={location.id}>{location.full_path || location.name}</option>)}</select></label>
          <label className="wide"><span>Roll Notes</span><textarea value={editForm.notes} onChange={(event) => setEditForm((form) => ({ ...form, notes: event.target.value }))} /></label>
          <button className="primary-btn wide" type="submit" disabled={saving}>Save Roll</button>
        </form>
      )}

      <form className="material-consume-form" onSubmit={(event) => { event.preventDefault(); onConsume(useForm); }}>
        <header><PackageCheck size={17} /><div><span>Use On A Job</span><strong>{activeJob?.label || "Choose scheduled job"}</strong></div></header>
        <label className="wide">
          <span>Scheduled Job</span>
          <select value={useForm.production_schedule} onChange={(event) => setUseForm((form) => ({ ...form, production_schedule: event.target.value }))}>
            <option value="">No job selected</option>
            {schedules.map((schedule) => <option value={schedule.id} key={schedule.id}>{schedule.job_ticket_number || schedule.job_name || `Schedule ${schedule.id}`} / {schedule.press_name || "No press"}</option>)}
          </select>
        </label>
        <div className="material-consume-modes">
          <button className={useForm.mode === "full" ? "active" : ""} type="button" onClick={() => setUseForm((form) => ({ ...form, mode: "full" }))}>Run Roll Out</button>
          <button className={useForm.mode === "partial" ? "active" : ""} type="button" onClick={() => setUseForm((form) => ({ ...form, mode: "partial" }))}>Partial Roll</button>
        </div>
        {useForm.mode === "partial" && (
          <label className="wide"><span>Footage Used</span><input type="number" min="0.01" max={available} step="0.01" value={useForm.used_feet} onChange={(event) => setUseForm((form) => ({ ...form, used_feet: event.target.value }))} required /></label>
        )}
        <div className="material-consume-preview">
          <span>Inventory deduction</span>
          <strong>{Math.round(buffered).toLocaleString()} ft</strong>
          <small>{useForm.mode === "partial" ? `${Math.round(entered).toLocaleString()} ft entered + 3% safety buffer` : "Uses all remaining footage"}</small>
        </div>
        <label><span>Operator</span><input value={useForm.used_by} onChange={(event) => setUseForm((form) => ({ ...form, used_by: event.target.value }))} /></label>
        <label className="check"><input type="checkbox" checked={useForm.poor_run} onChange={(event) => setUseForm((form) => ({ ...form, poor_run: event.target.checked }))} /><span>Poor run / needs note</span></label>
        <label className="wide"><span>Run Note</span><textarea value={useForm.notes} onChange={(event) => setUseForm((form) => ({ ...form, notes: event.target.value }))} placeholder="Why the roll came off or any quality issue" /></label>
        {(error || notice) && <p className={error ? "error" : "success"}>{error || notice}</p>}
        <button className="primary-btn wide" type="submit" disabled={saving || (useForm.mode === "partial" && entered <= 0)}>
          {saving ? "Saving Usage..." : useForm.mode === "full" ? "Use Entire Roll" : "Save Partial Usage"}
        </button>
      </form>
    </aside>
  );
}

export default function MaterialHandlingView({ currentUser, linkedRollTagId = "", onLinkedRollTagChange }) {
  const queryClient = useQueryClient();
  const [selectedInventoryId, setSelectedInventoryId] = useState("");
  const [groupMode, setGroupMode] = useState(() => window.localStorage.getItem("tsm_material_group_mode") || "width");
  const [view, setView] = useState("active");
  const [search, setSearch] = useState("");
  const [activeJob, setActiveJob] = useState(() => readActiveJob());
  const [notice, setNotice] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const scannerRef = useRef(null);

  const dataQuery = useQuery({
    queryKey: ["material-handling-data"],
    queryFn: async () => {
      const [tags, inventory, usage, locations, schedules] = await Promise.all([
        fetchCollection("coater-roll-tags", { ordering: "-created_at", pageSize: 1000, fetchAll: true }),
        fetchCollection("raw-materials", { ordering: "-received_date,-id", filters: { material_type: "coated_stock" }, pageSize: 1000, fetchAll: true }),
        fetchCollection("material-usages", { ordering: "-used_date,-created_at", pageSize: 1000, fetchAll: true }),
        fetchCollection("locations", { ordering: "name", pageSize: 1000, fetchAll: true }),
        fetchCollection("production-schedule", { ordering: "scheduled_date,press_sequence", pageSize: 500, fetchAll: true }),
      ]);
      return {
        tags: tags.results ?? [],
        inventory: inventory.results ?? [],
        usage: usage.results ?? [],
        locations: locations.results ?? [],
        schedules: (schedules.results ?? []).filter((row) => ["scheduled", "ready", "running", "on_hold"].includes(row.status)),
      };
    },
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const data = dataQuery.data ?? { tags: [], inventory: [], usage: [], locations: [], schedules: [] };
  const linkedTag = data.tags.find((tag) => sameId(tag.id, linkedRollTagId)) ?? null;
  const linkedInventory = linkedTag
    ? data.inventory.find((row) => sameId(row.source_roll_tag, linkedTag.id) || sameId(row.id, linkedTag.logged_inventory))
    : null;
  const selectedRoll = data.inventory.find((row) => sameId(row.id, selectedInventoryId)) || linkedInventory || null;
  const focusMaterialId = selectedRoll?.material || linkedTag?.produced_material || linkedTag?.scheduled_material || "";
  const relatedTags = linkedTag
    ? data.tags.filter((tag) => sameId(tag.source_schedule, linkedTag.source_schedule || linkedTag.id))
    : [];
  const relatedRollIds = new Set(relatedTags.map((tag) => String(tag.id)));
  const majorityRunDate = runDateForRolls(relatedTags);
  const activeRows = data.inventory
    .filter((row) => row.is_active !== false && !["depleted", "scrapped"].includes(row.status) && footage(row) > 0)
    .filter((row) => !focusMaterialId || sameId(row.material, focusMaterialId))
    .filter((row) => !search || `${row.serial_number} ${row.lot_number} ${materialName(row)} ${widthName(row)} ${locationName(row)}`.toLowerCase().includes(search.toLowerCase()));
  const usageRows = data.usage.filter((row) => !focusMaterialId || sameId(row.material, focusMaterialId));
  const rollHistory = data.tags.filter((tag) => (
    tag.source_schedule
    && tag.status === "complete"
    && (!focusMaterialId || sameId(tag.produced_material || tag.scheduled_material, focusMaterialId))
  ));

  useEffect(() => {
    if (linkedInventory) setSelectedInventoryId(String(linkedInventory.id));
  }, [linkedInventory?.id]);

  useEffect(() => () => scannerRef.current?.stop?.(), []);

  async function startScanner() {
    setCameraError("");
    setCameraOpen(true);
    await new Promise((resolve) => requestAnimationFrame(resolve));
    try {
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromConstraints(
        { video: { facingMode: { ideal: "environment" } }, audio: false },
        videoRef.current,
        (result, _scanError, activeControls) => {
          const rollId = extractRollTagId(result?.getText?.());
          if (!rollId) return;
          activeControls?.stop?.();
          scannerRef.current = null;
          setCameraOpen(false);
          onLinkedRollTagChange?.(rollId);
        }
      );
      scannerRef.current = controls;
    } catch (error) {
      setCameraError(error?.message || "Camera scanning is not available. Use the phone camera on the printed QR code.");
      setCameraOpen(false);
    }
  }

  const editMutation = useMutation({
    mutationFn: async ({ roll, form }) => {
      const payload = {
        lot_number: form.lot_number,
        width_inches: form.width_inches ? Number(form.width_inches) : null,
        location: form.location ? Number(form.location) : null,
        notes: form.notes,
      };
      const saved = await updateRecord("raw-materials", roll.id, payload);
      if (roll.source_roll_tag) {
        await updateRecord("coater-roll-tags", roll.source_roll_tag, {
          result_lot_number: payload.lot_number,
          width_inches: payload.width_inches,
          location: payload.location,
          notes: payload.notes,
        });
      }
      return saved;
    },
    onSuccess: (saved) => {
      setSelectedInventoryId(String(saved.id));
      setNotice(`${saved.serial_number || saved.lot_number} was updated.`);
      queryClient.invalidateQueries({ queryKey: ["material-handling-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
    },
  });

  const consumeMutation = useMutation({
    mutationFn: ({ roll, form }) => postRecordAction("raw-materials", roll.id, "consume-roll", {
      production_schedule: form.production_schedule ? Number(form.production_schedule) : null,
      mode: form.mode,
      used_feet: form.mode === "partial" ? Number(form.used_feet) : null,
      used_by: form.used_by || currentUser?.name || "",
      poor_run: form.poor_run,
      notes: form.notes,
    }),
    onSuccess: (result) => {
      const remaining = Number(result.remainingFootage || 0);
      setNotice(`${Number(result.deductedFootage || 0).toLocaleString()} ft recorded. ${remaining.toLocaleString()} ft remains active.`);
      setSelectedInventoryId(String(result.inventory.id));
      queryClient.invalidateQueries({ queryKey: ["material-handling-data"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
      queryClient.invalidateQueries({ queryKey: ["collection", "material-usages"] });
    },
  });

  function selectRoll(row) {
    setSelectedInventoryId(String(row.id));
    setNotice("");
    if (row.source_roll_tag) onLinkedRollTagChange?.(row.source_roll_tag);
  }

  if (linkedRollTagId && dataQuery.isLoading) {
    return <ScanLinkScreen kind="roll" />;
  }

  return (
    <section className="material-handling-view">
      <header className="material-handling-hero">
        <div>
          <span>Material Handling</span>
          <h2>{selectedRoll ? materialName(selectedRoll) : "Active Material Rolls"}</h2>
          <p>{[
            majorityRunDate ? `Mostly ran ${majorityRunDate}` : "",
            linkedTag?.schedule_tag_number ? `Schedule ${linkedTag.schedule_tag_number}` : "",
            `${activeRows.length} active roll${activeRows.length === 1 ? "" : "s"}`,
          ].filter(Boolean).join(" / ")}</p>
        </div>
        <div>
          {activeJob && <span className="material-active-job"><CheckCircle2 size={14} /> {activeJob.label}</span>}
          <button className="primary-btn" type="button" onClick={startScanner}><Camera size={16} /> Scan Roll</button>
        </div>
      </header>

      {linkedTag && !linkedInventory && (
        <div className="material-pending-tag">
          <AlertTriangle size={18} />
          <div><strong>{linkedTag.tag_number} is printed but not documented.</strong><span>The coater operator must enter the actual master-roll footage before this appears in active inventory.</span></div>
        </div>
      )}
      {cameraOpen && (
        <section className="material-camera-overlay">
          <div><video ref={videoRef} playsInline muted /><button className="ghost-btn" type="button" onClick={() => { scannerRef.current?.stop?.(); setCameraOpen(false); }}><X size={16} /> Close Camera</button></div>
        </section>
      )}
      {cameraError && <p className="coater-error">{cameraError}</p>}

      <nav className="material-handling-tabs">
        <button className={view === "active" ? "active" : ""} type="button" onClick={() => setView("active")}><PackageCheck size={15} /> Active Rolls</button>
        <button className={view === "history" ? "active" : ""} type="button" onClick={() => setView("history")}><History size={15} /> Run History</button>
      </nav>

      <section className="material-handling-toolbar">
        <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={view === "active" ? "Search roll, lot, width, or location" : "Search date, job, schedule, or operator"} /></label>
        {view === "active" && (
          <div>
            <button className={groupMode === "width" ? "active" : ""} type="button" onClick={() => { setGroupMode("width"); window.localStorage.setItem("tsm_material_group_mode", "width"); }}>By Width</button>
            <button className={groupMode === "location" ? "active" : ""} type="button" onClick={() => { setGroupMode("location"); window.localStorage.setItem("tsm_material_group_mode", "location"); }}>By Location</button>
          </div>
        )}
      </section>

      <div className={`material-handling-layout ${view === "history" ? "history" : ""}`}>
        <main>
          {dataQuery.isLoading ? <p className="material-handling-empty">Loading material inventory...</p>
            : view === "active"
              ? <ActiveInventory rows={activeRows} groupMode={groupMode} selectedId={selectedRoll?.id} relatedRollIds={relatedRollIds} onSelect={selectRoll} />
              : <UsageHistory rows={usageRows} rolls={rollHistory} search={search} />}
        </main>
        {view === "active" && selectedRoll && (
          <RollDetail
            key={selectedRoll.id}
            roll={selectedRoll}
            locations={data.locations}
            schedules={data.schedules}
            activeJob={activeJob}
            currentUser={currentUser}
            saving={editMutation.isPending || consumeMutation.isPending}
            error={editMutation.error?.message || consumeMutation.error?.message || ""}
            notice={notice}
            onSave={(form) => editMutation.mutate({ roll: selectedRoll, form })}
            onConsume={(form) => consumeMutation.mutate({ roll: selectedRoll, form })}
          />
        )}
      </div>
    </section>
  );
}

export { activeJobKey };
