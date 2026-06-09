import { useEffect, useMemo, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
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
  const fileInputRef = useRef(null);
  const fileTargetRef = useRef("");
  const streamRef = useRef(null);
  const scannerControlsRef = useRef(null);
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
    scannerControlsRef.current?.stop?.();
    scannerControlsRef.current = null;
    streamRef.current?.getTracks?.().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) {
      videoRef.current.pause?.();
      videoRef.current.srcObject = null;
    }
    setCameraTarget("");
  }

  function applyScanValue(target, value) {
    const cleanValue = String(value ?? "").trim();
    if (!cleanValue) return false;
    if (target === "roll") setRollScan(cleanValue);
    if (target === "location") setLocationScan(cleanValue);
    return true;
  }

  function cameraAccessMessage(error) {
    if (window.isSecureContext === false) {
      return "Live camera scanning requires HTTPS or localhost. Use photo scan or the scan field.";
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return "Live camera scanning is not available here. Use photo scan or the scan field.";
    }
    if (error?.name === "NotAllowedError" || error?.name === "PermissionDeniedError") {
      return "Camera permission was blocked. Allow camera access for this site or use the scan field.";
    }
    if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
      return "No camera was found on this device. Use the scan field or manual entry.";
    }
    if (error?.name === "NotReadableError" || error?.name === "TrackStartError") {
      return "The camera is already in use by another app. Close the other app and try again.";
    }
    return error?.message || "Could not open the camera.";
  }

  function openPhotoScanner(target) {
    fileTargetRef.current = target;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  }

  async function scanImageFile(event) {
    const file = event.target.files?.[0];
    const target = fileTargetRef.current;
    if (!file || !target) return;
    setCameraError("");
    const imageUrl = URL.createObjectURL(file);
    try {
      const scanner = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 120,
      });
      const image = new Image();
      image.src = imageUrl;
      const result = await scanner.decodeFromImageElement(image);
      if (!applyScanValue(target, result?.getText?.())) {
        setCameraError("No barcode was found in that image. Try a clearer photo or use the scan field.");
      }
    } catch {
      setCameraError("No barcode was found in that image. Try a clearer photo or use the scan field.");
    } finally {
      URL.revokeObjectURL(imageUrl);
      fileTargetRef.current = "";
      event.target.value = "";
    }
  }

  async function waitForCameraElement() {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    if (videoRef.current) return videoRef.current;
    await new Promise((resolve) => setTimeout(resolve, 0));
    return videoRef.current;
  }

  async function startCamera(target) {
    stopCamera();
    setCameraError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(cameraAccessMessage());
      openPhotoScanner(target);
      return;
    }
    if (window.isSecureContext === false) {
      setCameraError(cameraAccessMessage());
      openPhotoScanner(target);
      return;
    }
    try {
      cameraActiveRef.current = true;
      setCameraTarget(target);
      const video = await waitForCameraElement();
      if (!cameraActiveRef.current || !video) return;

      const scanner = new BrowserMultiFormatReader(undefined, {
        delayBetweenScanAttempts: 120,
        delayBetweenScanSuccess: 300,
      });
      const controls = await scanner.decodeFromConstraints(
        {
          audio: false,
          video: {
            facingMode: { ideal: "environment" },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        },
        video,
        (result, _scanError, activeControls) => {
          if (applyScanValue(target, result?.getText?.())) {
            activeControls?.stop?.();
            stopCamera();
          }
        }
      );
      if (!cameraActiveRef.current) {
        controls?.stop?.();
        return;
      }
      scannerControlsRef.current = controls;
      streamRef.current = video.srcObject;
    } catch (error) {
      setCameraError(cameraAccessMessage(error));
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
          <input
            ref={fileInputRef}
            className="roll-scan-file-input"
            type="file"
            accept="image/*"
            capture="environment"
            tabIndex="-1"
            onChange={scanImageFile}
          />

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
              <button type="button" onClick={() => startCamera("roll")} aria-label="Scan roll with camera" title="Scan roll with camera"><Camera size={15} /></button>
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
              <button type="button" onClick={() => startCamera("location")} aria-label="Scan location with camera" title="Scan location with camera"><Camera size={15} /></button>
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
