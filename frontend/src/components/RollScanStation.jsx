import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Camera, CheckCircle2, ClipboardCheck, PackageCheck, RotateCcw, Search, X } from "lucide-react";
import { labelize } from "../lib/format";

function compact(value) {
  return String(value ?? "").trim().toLowerCase();
}

function rollQuantity(roll) {
  return Number(roll?.length_feet ?? roll?.quantity ?? 0) || 0;
}

function rollLabel(roll) {
  return roll?.serial_number || roll?.source_roll_tag_number || roll?.lot_number || roll?.name || roll?.code || "";
}

function locationLabel(row) {
  return row?.full_path || row?.location_full_path || row?.name || row?.code || "";
}

function matchRoll(rows, scan) {
  const value = compact(scan);
  if (!value) return null;
  const candidates = rows ?? [];
  const exact = candidates.find((row) => [
    row.serial_number,
    row.source_roll_tag_number,
    row.lot_number,
    row.name,
    row.code,
  ].some((field) => compact(field) === value));
  if (exact) return exact;
  return candidates.find((row) => [
    row.serial_number,
    row.source_roll_tag_number,
    row.lot_number,
    row.name,
    row.code,
  ].some((field) => compact(field).includes(value)));
}

function matchLocation(locations, scan) {
  const value = compact(scan);
  if (!value) return null;
  return (locations ?? []).find((row) => [
    row.id,
    row.code,
    row.name,
    row.full_path,
    row.location_full_path,
  ].some((field) => compact(field) === value));
}

export default function RollScanStation({ rows, locations, submitting, error, currentUser, onSubmit, onSelect }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState("check-in");
  const [rollScan, setRollScan] = useState("");
  const [locationScan, setLocationScan] = useState("");
  const [remaining, setRemaining] = useState("");
  const [operator, setOperator] = useState(currentUser?.name || "");
  const [notes, setNotes] = useState("");
  const [cameraTarget, setCameraTarget] = useState("");
  const [cameraError, setCameraError] = useState("");
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const cameraActiveRef = useRef(false);

  const matchedRoll = useMemo(() => matchRoll(rows, rollScan), [rollScan, rows]);
  const matchedLocation = useMemo(() => matchLocation(locations, locationScan), [locationScan, locations]);
  const needsLocation = mode === "check-in";
  const canSubmit = Boolean(matchedRoll) && (!needsLocation || locationScan.trim()) && !submitting;

  useEffect(() => {
    if (matchedRoll) setRemaining(String(rollQuantity(matchedRoll)));
  }, [matchedRoll?.id]);

  useEffect(() => () => stopCamera(), []);

  function stopCamera() {
    cameraActiveRef.current = false;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    setCameraTarget("");
  }

  async function scanLoop(target, detector) {
    if (!cameraActiveRef.current || !videoRef.current) return;
    try {
      const codes = await detector.detect(videoRef.current);
      const value = codes?.[0]?.rawValue || "";
      if (value) {
        if (target === "roll") setRollScan(value);
        if (target === "location") setLocationScan(value);
        stopCamera();
        return;
      }
    } catch (error) {
      setCameraError(error.message || "Camera scan failed.");
      stopCamera();
      return;
    }
    requestAnimationFrame(() => scanLoop(target, detector));
  }

  async function startCamera(target) {
    setCameraError("");
    if (!window.BarcodeDetector || !navigator.mediaDevices?.getUserMedia) {
      setCameraError("Camera barcode scanning is not available in this browser. Use the scan field or manual entry.");
      return;
    }
    try {
      const detector = new window.BarcodeDetector({
        formats: ["code_128", "code_39", "qr_code", "data_matrix", "pdf417", "ean_13"],
      });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      cameraActiveRef.current = true;
      setCameraTarget(target);
      requestAnimationFrame(() => {
        if (!videoRef.current) return;
        videoRef.current.srcObject = stream;
        videoRef.current.play?.();
        scanLoop(target, detector);
      });
    } catch (error) {
      setCameraError(error.message || "Could not open the camera.");
      stopCamera();
    }
  }

  function submit(event) {
    event.preventDefault();
    if (!canSubmit) return;
    onSubmit?.({
      action: mode,
      roll: matchedRoll,
      payload: {
        location: matchedLocation?.id || "",
        location_text: locationScan.trim(),
        remaining_quantity: remaining === "" ? rollQuantity(matchedRoll) : Number(remaining),
        used_by: operator,
        notes,
      },
    });
    if (mode === "check-out") {
      setRollScan("");
      setLocationScan("");
      setNotes("");
    }
  }

  return (
    <section className={`roll-scan-station ${open ? "open" : ""}`}>
      <button className="roll-scan-toggle" type="button" onClick={() => setOpen((value) => !value)}>
        <Search size={16} />
        <span>Scan Roll</span>
      </button>

      {open && (
        <form className="roll-scan-panel" onSubmit={submit}>
          <div className="roll-scan-mode-tabs" role="tablist" aria-label="Roll scanner action">
            <button type="button" className={mode === "check-in" ? "active" : ""} onClick={() => setMode("check-in")}>
              <RotateCcw size={15} /> Check In
            </button>
            <button type="button" className={mode === "check-out" ? "active" : ""} onClick={() => setMode("check-out")}>
              <ClipboardCheck size={15} /> Check Out
            </button>
            <button type="button" className={mode === "hold" ? "active" : ""} onClick={() => setMode("hold")}>
              <AlertTriangle size={15} /> Hold / QC
            </button>
          </div>

          <label className="roll-scan-field">
            <span>Roll ID</span>
            <div>
              <input value={rollScan} onChange={(event) => setRollScan(event.target.value)} placeholder="Scan or enter roll tag" autoComplete="off" autoFocus />
              <button type="button" onClick={() => startCamera("roll")}><Camera size={15} /></button>
            </div>
          </label>

          {matchedRoll ? (
            <button className="roll-scan-found" type="button" onClick={() => onSelect?.(matchedRoll)}>
              <CheckCircle2 size={17} />
              <div>
                <strong>{rollLabel(matchedRoll)}</strong>
                <span>{[matchedRoll.material_name || matchedRoll.name, `${rollQuantity(matchedRoll).toLocaleString()} ${matchedRoll.unit || "lf"}`, labelize(matchedRoll.status)].filter(Boolean).join(" / ")}</span>
                <em>{matchedRoll.location_full_path || matchedRoll.location_name || "No location"}</em>
              </div>
            </button>
          ) : rollScan ? (
            <div className="roll-scan-missing">
              <AlertTriangle size={16} />
              <span>No roll matched this scan.</span>
            </div>
          ) : null}

          <label className="roll-scan-field">
            <span>Location</span>
            <div>
              <input value={locationScan} onChange={(event) => setLocationScan(event.target.value)} placeholder="Scan location or type shelf" autoComplete="off" />
              <button type="button" onClick={() => startCamera("location")}><Camera size={15} /></button>
            </div>
          </label>

          {locationScan && (
            <div className={`roll-scan-location ${matchedLocation ? "ready" : "new"}`}>
              {matchedLocation ? <CheckCircle2 size={16} /> : <PackageCheck size={16} />}
              <span>{matchedLocation ? locationLabel(matchedLocation) : `New location: ${locationScan}`}</span>
            </div>
          )}

          {mode === "check-in" && (
            <label className="roll-scan-field">
              <span>Remaining Feet</span>
              <input type="number" min="0" step="0.001" value={remaining} onChange={(event) => setRemaining(event.target.value)} />
            </label>
          )}

          <label className="roll-scan-field">
            <span>Operator</span>
            <input value={operator} onChange={(event) => setOperator(event.target.value)} placeholder="Name or initials" />
          </label>

          <label className="roll-scan-field wide">
            <span>Note</span>
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional note" />
          </label>

          {cameraTarget && (
            <div className="roll-scan-camera">
              <video ref={videoRef} playsInline muted />
              <button type="button" onClick={stopCamera}><X size={16} /> Stop Camera</button>
            </div>
          )}

          {(cameraError || error) && <p className="roll-scan-error">{cameraError || error}</p>}

          <button className="primary-btn roll-scan-submit" type="submit" disabled={!canSubmit}>
            {submitting ? "Saving..." : mode === "check-in" ? "Put Roll In" : mode === "check-out" ? "Take Roll Out" : "Place On Hold"}
          </button>
        </form>
      )}
    </section>
  );
}
