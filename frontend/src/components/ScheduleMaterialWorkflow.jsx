import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Barcode,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  Plus,
  Save,
  X,
} from "lucide-react";
import { createRecord, fetchCollection, postRecordAction, updateRecord } from "../api";
import { formatInches, labelize } from "../lib/format";

function sameId(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return false;
  return String(left) === String(right);
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function feet(value) {
  return `${Math.round(number(value)).toLocaleString()} ft`;
}

function inventoryFeet(row) {
  return number(row?.length_feet ?? row?.quantity);
}

function rollCode(row) {
  return row?.source_roll_tag_number || row?.serial_number || row?.lot_number || row?.code || "Roll";
}

function localDateValue(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function shiftDateTimes(reportDate, setting) {
  const startTime = String(setting?.shift_start_time || "05:00").slice(0, 5);
  const endTime = String(setting?.shift_end_time || "02:20").slice(0, 5);
  const start = new Date(`${reportDate}T${startTime}:00`);
  const end = new Date(`${reportDate}T${endTime}:00`);
  if (setting?.end_on_next_day !== false || end <= start) end.setDate(end.getDate() + 1);
  const toLocalInput = (value) => {
    const offset = value.getTimezoneOffset() * 60_000;
    return new Date(value.getTime() - offset).toISOString().slice(0, 16);
  };
  return { start: toLocalInput(start), end: toLocalInput(end) };
}

function compatibleInventory(schedule, ticket, rows) {
  const requiredMaster = ticket?.material_master_type
    || ticket?.material_spec_master_type
    || schedule?.job_material_master_type
    || schedule?.job_material_spec_master_type;
  return (rows ?? []).filter((row) => {
    if (row.material_type !== "coated_stock") return false;
    if (requiredMaster && !sameId(row.material_master_type, requiredMaster)) return false;
    if (row.is_active === false || ["depleted", "scrapped", "on_hold"].includes(row.status)) return false;
    return inventoryFeet(row) > 0;
  });
}

function ScanCamera({ onResult, onClose }) {
  const videoRef = useRef(null);
  const controlsRef = useRef(null);
  const resultRef = useRef(onResult);
  const [error, setError] = useState("");

  useEffect(() => {
    resultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    let active = true;
    async function start() {
      try {
        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
          setError("Camera scanning requires HTTPS or localhost. A USB scanner or manual entry still works.");
          return;
        }
        const reader = new BrowserMultiFormatReader(undefined, {
          delayBetweenScanAttempts: 100,
          delayBetweenScanSuccess: 300,
        });
        const controls = await reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result, _scanError, currentControls) => {
            const value = result?.getText?.();
            if (value && active) {
              currentControls?.stop?.();
              resultRef.current(value);
            }
          },
        );
        if (!active) controls?.stop?.();
        else controlsRef.current = controls;
      } catch (scanError) {
        setError(scanError?.name === "NotAllowedError"
          ? "Camera permission was blocked. Allow camera access or use the scan field."
          : "Could not open the camera. Use the scan field or a USB scanner.");
      }
    }
    start();
    return () => {
      active = false;
      controlsRef.current?.stop?.();
      controlsRef.current = null;
      if (videoRef.current?.srcObject) {
        videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div className="schedule-roll-camera">
      <video ref={videoRef} playsInline muted />
      <button type="button" onClick={onClose}><X size={16} /> Close</button>
      {error && <p>{error}</p>}
    </div>
  );
}

function AssignmentCard({ assignment, active, onUse }) {
  return (
    <article className={`schedule-assigned-roll ${assignment.status} ${active ? "active" : ""}`}>
      <div className="schedule-assigned-roll-mark">
        {assignment.status === "rejected" ? <AlertTriangle size={18} /> : <PackageCheck size={18} />}
      </div>
      <div>
        <strong>{assignment.source_roll_tag || assignment.inventory_serial || assignment.inventory_lot}</strong>
        <span>
          {[assignment.material_master_type_code || assignment.material_code, assignment.supplier_name || "Tri-State Media", assignment.inventory_width_inches ? `${formatInches(assignment.inventory_width_inches)} wide` : ""]
            .filter(Boolean).join(" / ")}
        </span>
        <em>{assignment.carton_lot_code ? `Carton stamp ${assignment.carton_lot_code}` : assignment.inventory_location || "No location"}</em>
      </div>
      <div>
        <b>{feet(assignment.used_footage)} used</b>
        <span>{feet(assignment.inventory_length_feet ?? assignment.inventory_quantity)} left</span>
      </div>
      {assignment.status === "active" && (
        <button className="ghost-btn xs" type="button" onClick={() => onUse(assignment)}>
          Record Use
        </button>
      )}
      {assignment.quality_note && <p>{assignment.quality_note}</p>}
    </article>
  );
}

export default function ScheduleMaterialWorkflow({
  schedule,
  ticket,
  inventoryRows,
  currentUser,
}) {
  const queryClient = useQueryClient();
  const [sourceMode, setSourceMode] = useState("tsm");
  const [scanValue, setScanValue] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const [purchaseId, setPurchaseId] = useState("");
  const [cartonLot, setCartonLot] = useState("");
  const [quickPurchaseOpen, setQuickPurchaseOpen] = useState(false);
  const [quickPurchase, setQuickPurchase] = useState({
    material: "",
    supplier: "",
    vendor_lot: "",
    width_inches: "",
    length_feet: "",
  });
  const [notice, setNotice] = useState("");
  const [actionError, setActionError] = useState("");
  const [usageAssignment, setUsageAssignment] = useState(null);
  const [usageMode, setUsageMode] = useState("partial");
  const [usageFeet, setUsageFeet] = useState("");
  const [markBad, setMarkBad] = useState(false);
  const [usageNote, setUsageNote] = useState("");
  const [targetFootage, setTargetFootage] = useState(String(schedule.target_footage || ""));
  const [reportOpen, setReportOpen] = useState(false);
  const [reportDate, setReportDate] = useState(localDateValue());
  const [reportForm, setReportForm] = useState({
    shift_start: "",
    shift_end: "",
    total_footage: "",
    good_footage: "",
    material_footage: "",
    outcome: "end_shift",
    notes: "",
  });

  const compatible = useMemo(
    () => compatibleInventory(schedule, ticket, inventoryRows),
    [schedule, ticket, inventoryRows],
  );
  const tsmRows = compatible.filter((row) => Boolean(row.source_roll_tag));
  const purchasedRows = compatible.filter((row) => !row.source_roll_tag);
  const requiredMaster = ticket?.material_master_type
    || ticket?.material_spec_master_type
    || schedule?.job_material_master_type
    || schedule?.job_material_spec_master_type;

  const assignmentQuery = useQuery({
    queryKey: ["production-material-assignments", schedule.id],
    queryFn: () => fetchCollection("production-material-assignments", {
      filters: { production_schedule: schedule.id },
      ordering: "-assigned_at",
      pageSize: 150,
    }).then((result) => result.results),
  });
  const reportQuery = useQuery({
    queryKey: ["production-shift-reports", schedule.id],
    queryFn: () => fetchCollection("production-shift-reports", {
      filters: { production_schedule: schedule.id },
      ordering: "-shift_end",
      pageSize: 100,
    }).then((result) => result.results),
  });
  const settingQuery = useQuery({
    queryKey: ["production-shift-settings"],
    queryFn: () => fetchCollection("production-shift-settings", { pageSize: 10 }).then((result) => result.results),
  });
  const materialQuery = useQuery({
    queryKey: ["schedule-compatible-materials", requiredMaster],
    queryFn: () => fetchCollection("materials", {
      filters: { material_type: "coated_stock", master_type: requiredMaster },
      ordering: "code",
      pageSize: 250,
    }).then((result) => result.results),
    enabled: Boolean(requiredMaster),
  });
  const supplierQuery = useQuery({
    queryKey: ["schedule-material-suppliers"],
    queryFn: () => fetchCollection("suppliers", {
      ordering: "name",
      pageSize: 1000,
      fetchAll: true,
    }).then((result) => result.results),
  });

  useEffect(() => {
    setTargetFootage(String(schedule.target_footage || ""));
  }, [schedule.target_footage]);

  useEffect(() => {
    const times = shiftDateTimes(reportDate, settingQuery.data?.[0]);
    setReportForm((current) => ({ ...current, shift_start: times.start, shift_end: times.end }));
  }, [reportDate, settingQuery.data]);

  function refreshWorkflow() {
    queryClient.invalidateQueries({ queryKey: ["production-material-assignments", schedule.id] });
    queryClient.invalidateQueries({ queryKey: ["production-shift-reports", schedule.id] });
    queryClient.invalidateQueries({ queryKey: ["collection", "production-schedule"] });
    queryClient.invalidateQueries({ queryKey: ["collection", "raw-materials"] });
  }

  const assignmentMutation = useMutation({
    mutationFn: (payload) => createRecord("production-material-assignments", payload),
    onSuccess: (saved) => {
      refreshWorkflow();
      setNotice(`${saved.inventory_serial || saved.inventory_lot} is linked to this job.`);
      setActionError("");
      setScanValue("");
      setPurchaseId("");
      setCartonLot("");
    },
    onError: (error) => setActionError(error.message),
  });

  const quickPurchaseMutation = useMutation({
    mutationFn: async () => {
      const length = Number(quickPurchase.length_feet || 0);
      const inventory = await createRecord("raw-materials", {
        material: Number(quickPurchase.material),
        supplier: quickPurchase.supplier ? Number(quickPurchase.supplier) : null,
        lot_number: quickPurchase.vendor_lot.trim(),
        width_inches: quickPurchase.width_inches ? Number(quickPurchase.width_inches) : null,
        length_feet: length,
        quantity: length,
        unit: "lf",
        status: "available",
        received_date: localDateValue(),
        notes: `Entered from scheduled order ${schedule.job_ticket_number || schedule.id} by ${currentUser?.name || "operator"}.`,
      });
      await createRecord("material-usages", {
        inventory: inventory.id,
        material: inventory.material,
        usage_type: "adjustment",
        quantity: length,
        unit: "lf",
        used_date: localDateValue(),
        used_by: currentUser?.name || "",
        reference: `Purchased roll entered for schedule ${schedule.id}`,
        production_schedule: schedule.id,
        job_ticket: schedule.job_ticket,
        notes: quickPurchase.vendor_lot.trim(),
      });
      return createRecord("production-material-assignments", {
        production_schedule: schedule.id,
        inventory: inventory.id,
        source_type: "outsourced",
        carton_lot_code: cartonLot,
        assigned_by: currentUser?.name || "",
      });
    },
    onSuccess: (saved) => {
      refreshWorkflow();
      setNotice(`${saved.inventory_serial || saved.inventory_lot} was added to inventory and linked to this job.`);
      setActionError("");
      setQuickPurchaseOpen(false);
      setQuickPurchase({ material: "", supplier: "", vendor_lot: "", width_inches: "", length_feet: "" });
      setCartonLot("");
    },
    onError: (error) => setActionError(error.message),
  });

  const scanMutation = useMutation({
    mutationFn: async (value) => {
      const response = await fetchCollection("production-material-assignments/scan-roll", {
        filters: { production_schedule: schedule.id, scan: value },
        pageSize: 0,
      });
      return response.raw;
    },
    onSuccess: (result) => {
      setCameraOpen(false);
      if (result.already_assigned) {
        setNotice(`${result.already_assigned.inventory_serial || result.already_assigned.inventory_lot} is already linked to this job.`);
        return;
      }
      assignmentMutation.mutate({
        production_schedule: schedule.id,
        inventory: result.inventory.id,
        source_type: "tsm",
        assigned_by: currentUser?.name || "",
      });
    },
    onError: (error) => {
      setCameraOpen(false);
      setActionError(error.message);
    },
  });

  const usageMutation = useMutation({
    mutationFn: ({ id, payload }) => postRecordAction("production-material-assignments", id, "record-usage", payload),
    onSuccess: (result) => {
      refreshWorkflow();
      setNotice(`${feet(result.deducted_footage)} recorded. ${feet(result.remaining_footage)} remain on the roll.`);
      setActionError("");
      setUsageAssignment(null);
      setUsageFeet("");
      setMarkBad(false);
      setUsageNote("");
    },
    onError: (error) => setActionError(error.message),
  });

  const targetMutation = useMutation({
    mutationFn: () => updateRecord("production-schedule", schedule.id, {
      target_footage: targetFootage ? Number(targetFootage) : null,
      last_updated_by: currentUser?.name || "",
    }),
    onSuccess: () => {
      refreshWorkflow();
      setNotice("Planned footage updated.");
    },
    onError: (error) => setActionError(error.message),
  });

  const reportMutation = useMutation({
    mutationFn: () => createRecord("production-shift-reports", {
      production_schedule: schedule.id,
      operator: currentUser?.name || schedule.operator || "",
      report_date: reportDate,
      shift_start: new Date(reportForm.shift_start).toISOString(),
      shift_end: new Date(reportForm.shift_end).toISOString(),
      total_footage: Number(reportForm.total_footage || 0),
      good_footage: Number(reportForm.good_footage || 0),
      material_footage: Number(reportForm.material_footage || 0),
      outcome: reportForm.outcome,
      notes: reportForm.notes,
      created_by: currentUser?.name || "",
    }),
    onSuccess: () => {
      refreshWorkflow();
      setNotice(reportForm.outcome === "job_complete" ? "Job marked complete and shift report saved." : "Shift handoff saved.");
      setReportOpen(false);
      setReportForm((current) => ({
        ...current,
        total_footage: "",
        good_footage: "",
        material_footage: "",
        notes: "",
      }));
    },
    onError: (error) => setActionError(error.message),
  });

  const assignments = assignmentQuery.data ?? [];
  const reports = reportQuery.data ?? [];
  const activeAssignments = assignments.filter((item) => item.status === "active");
  const rollsUsed = assignments.filter((item) => ["complete", "rejected"].includes(item.status));
  const total = reports.reduce((sum, row) => sum + number(row.total_footage), 0);
  const good = reports.reduce((sum, row) => sum + number(row.good_footage), 0);
  const target = number(schedule.target_footage);
  const progress = target > 0 ? Math.min(100, (good / target) * 100) : 0;
  const selectedPurchase = purchasedRows.find((row) => sameId(row.id, purchaseId));
  const compatibleMaterials = materialQuery.data ?? [];
  const suppliers = [...(supplierQuery.data ?? [])]
    .filter((row) => row.is_active !== false)
    .sort((left, right) => {
      const leftSuggested = String(left.tags || "").toLowerCase().split(",").map((tag) => tag.trim()).includes("material");
      const rightSuggested = String(right.tags || "").toLowerCase().split(",").map((tag) => tag.trim()).includes("material");
      return Number(rightSuggested) - Number(leftSuggested) || String(left.name).localeCompare(String(right.name));
    });
  const linkedAvailable = activeAssignments.reduce(
    (sum, row) => sum + number(row.inventory_length_feet ?? row.inventory_quantity),
    0,
  );
  const linkedUsed = assignments.reduce((sum, row) => sum + number(row.used_footage), 0);

  function submitScan(event) {
    event.preventDefault();
    setNotice("");
    setActionError("");
    if (scanValue.trim()) scanMutation.mutate(scanValue.trim());
  }

  function addPurchased(event) {
    event.preventDefault();
    setNotice("");
    setActionError("");
    if (!selectedPurchase || !/^\d{5}$/.test(cartonLot)) {
      setActionError("Choose a compatible roll and enter the exact 5-digit carton stamp.");
      return;
    }
    assignmentMutation.mutate({
      production_schedule: schedule.id,
      inventory: selectedPurchase.id,
      source_type: "outsourced",
      carton_lot_code: cartonLot,
      assigned_by: currentUser?.name || "",
    });
  }

  function submitUsage(event) {
    event.preventDefault();
    if (!usageAssignment) return;
    usageMutation.mutate({
      id: usageAssignment.id,
      payload: {
        mode: usageMode,
        footage_used: usageFeet,
        mark_bad: markBad,
        notes: usageNote,
        used_by: currentUser?.name || "",
      },
    });
  }

  return (
    <section className="schedule-material-workflow">
      <header className="schedule-workflow-head">
        <div>
          <span>Material For This Run</span>
          <strong>{ticket?.material_master_type_code || ticket?.material_spec_master_type_code || schedule.job_material_master_type_code || "Material type not set"}</strong>
        </div>
        <div className="schedule-source-tabs" role="tablist" aria-label="Material source">
          <button type="button" className={sourceMode === "tsm" ? "active" : ""} onClick={() => setSourceMode("tsm")}>
            <Barcode size={15} /> Scan TSM Roll
          </button>
          <button type="button" className={sourceMode === "outsourced" ? "active" : ""} onClick={() => setSourceMode("outsourced")}>
            <PackageCheck size={15} /> Purchased Roll
          </button>
        </div>
      </header>

      {sourceMode === "tsm" ? (
        <form className="schedule-scan-row" onSubmit={submitScan}>
          <label>
            <span>Roll barcode or lot number</span>
            <div>
              <Barcode size={18} />
              <input
                value={scanValue}
                onChange={(event) => setScanValue(event.target.value)}
                placeholder="Scan Code 128"
                autoFocus
                autoComplete="off"
              />
            </div>
          </label>
          <button className="ghost-btn" type="button" onClick={() => setCameraOpen(true)} title="Use phone camera">
            <Camera size={17} /> Camera
          </button>
          <button className="primary-btn" type="submit" disabled={!scanValue.trim() || scanMutation.isPending}>
            {scanMutation.isPending ? "Finding..." : "Link Roll"}
          </button>
          <p>{tsmRows.length} compatible Tri-State roll{tsmRows.length === 1 ? "" : "s"} currently available.</p>
        </form>
      ) : (
        <>
          <form className="schedule-purchased-row" onSubmit={addPurchased}>
            <label>
              <span>Compatible supplier roll</span>
              <select value={purchaseId} onChange={(event) => setPurchaseId(event.target.value)}>
                <option value="">Select supplier and roll</option>
                {purchasedRows.map((row) => (
                  <option value={row.id} key={row.id}>
                    {[row.supplier_name || "No supplier", row.material_code || row.material_name, rollCode(row), row.width_inches ? `${formatInches(row.width_inches)} wide` : "", feet(inventoryFeet(row))]
                      .filter(Boolean).join(" / ")}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>5-digit carton stamp</span>
              <input
                inputMode="numeric"
                pattern="\d{5}"
                maxLength="5"
                value={cartonLot}
                onChange={(event) => setCartonLot(event.target.value.replace(/\D/g, "").slice(0, 5))}
                placeholder="00000"
              />
            </label>
            <button className="primary-btn" type="submit" disabled={assignmentMutation.isPending}>
              <Plus size={16} /> Add Roll
            </button>
            <button className="schedule-new-purchase-toggle" type="button" onClick={() => setQuickPurchaseOpen((value) => !value)}>
              {quickPurchaseOpen ? "Use Existing Roll" : "New Roll Not Listed"}
            </button>
          </form>
          {quickPurchaseOpen && (
            <form
              className="schedule-new-purchase"
              onSubmit={(event) => {
                event.preventDefault();
                if (!quickPurchase.material || !quickPurchase.vendor_lot.trim() || number(quickPurchase.length_feet) <= 0 || !/^\d{5}$/.test(cartonLot)) {
                  setActionError("Material, vendor lot, starting footage, and the 5-digit carton stamp are required.");
                  return;
                }
                quickPurchaseMutation.mutate();
              }}
            >
              <header><div><span>New Purchased Roll</span><strong>Add it once, then use it on this job</strong></div></header>
              <label>
                <span>Compatible material</span>
                <select value={quickPurchase.material} onChange={(event) => setQuickPurchase({ ...quickPurchase, material: event.target.value })} required>
                  <option value="">Select material</option>
                  {compatibleMaterials.map((row) => <option value={row.id} key={row.id}>{[row.code, row.name].filter(Boolean).join(" / ")}</option>)}
                </select>
              </label>
              <label>
                <span>Supplier</span>
                <select value={quickPurchase.supplier} onChange={(event) => setQuickPurchase({ ...quickPurchase, supplier: event.target.value })}>
                  <option value="">No supplier selected</option>
                  {suppliers.map((row) => {
                    const suggested = String(row.tags || "").toLowerCase().split(",").map((tag) => tag.trim()).includes("material");
                    return <option value={row.id} key={row.id}>{suggested ? `Suggested / ${row.name}` : row.name}</option>;
                  })}
                </select>
              </label>
              <label>
                <span>Vendor lot number</span>
                <input value={quickPurchase.vendor_lot} onChange={(event) => setQuickPurchase({ ...quickPurchase, vendor_lot: event.target.value })} required />
              </label>
              <label>
                <span>Roll width (in)</span>
                <input type="number" min="0" step="0.001" value={quickPurchase.width_inches} onChange={(event) => setQuickPurchase({ ...quickPurchase, width_inches: event.target.value })} />
              </label>
              <label>
                <span>Starting footage</span>
                <input type="number" min="1" step="1" value={quickPurchase.length_feet} onChange={(event) => setQuickPurchase({ ...quickPurchase, length_feet: event.target.value })} required />
              </label>
              <label>
                <span>5-digit carton stamp</span>
                <input
                  inputMode="numeric"
                  pattern="\d{5}"
                  maxLength="5"
                  value={cartonLot}
                  onChange={(event) => setCartonLot(event.target.value.replace(/\D/g, "").slice(0, 5))}
                  placeholder="00000"
                  required
                />
              </label>
              <button className="primary-btn" type="submit" disabled={quickPurchaseMutation.isPending}>
                <Save size={16} /> {quickPurchaseMutation.isPending ? "Adding..." : "Add & Link Roll"}
              </button>
            </form>
          )}
        </>
      )}

      {cameraOpen && (
        <ScanCamera
          onClose={() => setCameraOpen(false)}
          onResult={(value) => {
            setScanValue(value);
            scanMutation.mutate(value);
          }}
        />
      )}

      {notice && <div className="schedule-workflow-notice"><CheckCircle2 size={16} /> {notice}</div>}
      {actionError && <div className="schedule-workflow-error"><AlertTriangle size={16} /> <span>{actionError}</span></div>}

      <div className="schedule-roll-summary">
        <div><span>Active Rolls</span><strong>{activeAssignments.length}</strong></div>
        <div><span>Rolls Used</span><strong>{rollsUsed.length}</strong></div>
        <div><span>Footage Available</span><strong>{feet(linkedAvailable)}</strong></div>
        <div><span>Used From Rolls</span><strong>{feet(linkedUsed)}</strong></div>
      </div>

      <div className="schedule-assigned-list">
        {assignments.map((assignment) => (
          <AssignmentCard
            key={assignment.id}
            assignment={assignment}
            active={sameId(assignment.id, usageAssignment?.id)}
            onUse={setUsageAssignment}
          />
        ))}
        {!assignmentQuery.isLoading && !assignments.length && (
          <p className="schedule-no-rolls">Scan or select the first roll to begin this job.</p>
        )}
      </div>

      {usageAssignment && (
        <form className="schedule-usage-form" onSubmit={submitUsage}>
          <header>
            <div>
              <span>Record Material Use</span>
              <strong>{usageAssignment.inventory_serial || usageAssignment.inventory_lot}</strong>
            </div>
            <button type="button" onClick={() => setUsageAssignment(null)} aria-label="Close usage form"><X size={17} /></button>
          </header>
          <div className="schedule-usage-mode">
            <button type="button" className={usageMode === "partial" ? "active" : ""} onClick={() => setUsageMode("partial")}>Partial Roll</button>
            <button type="button" className={usageMode === "full" ? "active" : ""} onClick={() => setUsageMode("full")}>Roll Used Up</button>
          </div>
          {usageMode === "partial" && (
            <label>
              <span>Estimated feet used</span>
              <input type="number" min="1" step="1" value={usageFeet} onChange={(event) => setUsageFeet(event.target.value)} required />
              <small>A 3% safety allowance is deducted automatically.</small>
            </label>
          )}
          <label className="schedule-bad-roll">
            <input type="checkbox" checked={markBad} onChange={(event) => setMarkBad(event.target.checked)} />
            <span><strong>Roll became unrunnable</strong><small>Place all remaining material on quality hold.</small></span>
          </label>
          <label>
            <span>{markBad ? "What went wrong? (required)" : "Operator note"}</span>
            <textarea value={usageNote} onChange={(event) => setUsageNote(event.target.value)} required={markBad} placeholder="Optional production note" />
          </label>
          <button className="primary-btn" type="submit" disabled={usageMutation.isPending}>
            <Save size={16} /> {usageMutation.isPending ? "Saving..." : "Save Usage"}
          </button>
        </form>
      )}

      <section className="schedule-shift-progress">
        <header>
          <div>
            <span>Job Progress & Shift Handoff</span>
            <strong>{target > 0 ? `${feet(good)} of ${feet(target)} good` : `${feet(good)} reported`}</strong>
          </div>
          <button className="primary-btn" type="button" onClick={() => setReportOpen((value) => !value)}>
            <ClipboardCheck size={16} /> End Shift / Job
          </button>
        </header>
        <div className="schedule-progress-track" aria-label={`${Math.round(progress)} percent complete`}>
          <i style={{ width: `${progress}%` }} />
        </div>
        <div className="schedule-progress-facts">
          <span><b>{feet(total)}</b> total run</span>
          <span><b>{feet(Math.max(0, total - good))}</b> waste</span>
          <span><b>{target > 0 ? feet(Math.max(0, target - good)) : "--"}</b> remaining</span>
        </div>
        <div className="schedule-target-row">
          <label>
            <span>Planned Footage</span>
            <input type="number" min="0" step="1" value={targetFootage} onChange={(event) => setTargetFootage(event.target.value)} placeholder="Set run target" />
          </label>
          <button className="ghost-btn" type="button" onClick={() => targetMutation.mutate()} disabled={targetMutation.isPending}>Save Target</button>
        </div>

        {reportOpen && (
          <form className="schedule-shift-form" onSubmit={(event) => { event.preventDefault(); reportMutation.mutate(); }}>
            <label>
              <span>Reporting Day</span>
              <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} required />
            </label>
            <label>
              <span>Shift Start</span>
              <input type="datetime-local" value={reportForm.shift_start} onChange={(event) => setReportForm({ ...reportForm, shift_start: event.target.value })} required />
            </label>
            <label>
              <span>Shift End</span>
              <input type="datetime-local" value={reportForm.shift_end} onChange={(event) => setReportForm({ ...reportForm, shift_end: event.target.value })} required />
            </label>
            <label>
              <span>Total Footage</span>
              <input type="number" min="0" step="1" value={reportForm.total_footage} onChange={(event) => setReportForm({ ...reportForm, total_footage: event.target.value })} required />
            </label>
            <label>
              <span>Good Footage</span>
              <input type="number" min="0" step="1" value={reportForm.good_footage} onChange={(event) => setReportForm({ ...reportForm, good_footage: event.target.value })} required />
            </label>
            <label>
              <span>Material Used</span>
              <input type="number" min="0" step="1" value={reportForm.material_footage} onChange={(event) => setReportForm({ ...reportForm, material_footage: event.target.value })} />
            </label>
            <label>
              <span>Stopping Because</span>
              <select value={reportForm.outcome} onChange={(event) => setReportForm({ ...reportForm, outcome: event.target.value })}>
                <option value="end_shift">End of shift - job continues</option>
                <option value="job_complete">Job complete</option>
              </select>
            </label>
            <label className="wide">
              <span>Handoff Note</span>
              <textarea value={reportForm.notes} onChange={(event) => setReportForm({ ...reportForm, notes: event.target.value })} placeholder="What should the next operator know?" />
            </label>
            <button className="primary-btn" type="submit" disabled={reportMutation.isPending}>
              <Save size={16} /> {reportMutation.isPending ? "Saving..." : "Save Shift Report"}
            </button>
          </form>
        )}

        {reports.length > 0 && (
          <div className="schedule-handoff-list">
            {reports.slice(0, 4).map((report) => (
              <article key={report.id}>
                <div><strong>{report.operator}</strong><span>{new Date(report.shift_end).toLocaleString()}</span></div>
                <div><b>{feet(report.good_footage)} good</b><span>{feet(report.waste_footage)} waste</span></div>
                <em>{labelize(report.outcome)}{report.notes ? ` / ${report.notes}` : ""}</em>
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
}
