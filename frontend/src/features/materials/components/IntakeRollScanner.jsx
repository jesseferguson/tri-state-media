import { useEffect, useId, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import { AlertCircle, Camera, ImagePlus, Keyboard, LoaderCircle, Search, Square } from "lucide-react";
import "./IntakeRollScanner.css";

function stopTracks(stream) {
  stream?.getTracks().forEach((track) => track.stop());
}

function releaseCamera(session) {
  if (!session) return;
  session.cancelled = true;
  try {
    session.controls?.stop();
  } finally {
    stopTracks(session.stream);
    if (session.video) {
      session.video.pause();
      session.video.srcObject = null;
    }
  }
}

function cameraMessage(error) {
  if (window.isSecureContext === false) return "Live camera scanning needs a secure HTTPS connection. Scan a photo or enter the roll tag below.";
  if (!navigator.mediaDevices?.getUserMedia) return "This browser cannot open a camera. Scan a photo or enter the roll tag below.";
  if (["NotAllowedError", "PermissionDeniedError", "SecurityError"].includes(error?.name)) return "Camera access was blocked. Allow camera access in your browser, scan a photo, or enter the roll tag below.";
  if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) return "No camera was found. Scan a saved photo or enter the roll tag below.";
  if (["NotReadableError", "TrackStartError"].includes(error?.name)) return "The camera is unavailable or being used by another app. Close the other app, scan a photo, or enter the roll tag below.";
  return "The camera could not start. Try again, scan a photo, or enter the roll tag below.";
}

const EXPECTED_FRAME_ERRORS = new Set(["NotFoundException", "ChecksumException", "FormatException"]);

export default function IntakeRollScanner({ onScan, scanning = false, error = "", onManual }) {
  const id = useId();
  const [value, setValue] = useState("");
  const [camera, setCamera] = useState(null);
  const [readingPhoto, setReadingPhoto] = useState(false);
  const [findingRoll, setFindingRoll] = useState(false);
  const [inputError, setInputError] = useState("");
  const [deviceError, setDeviceError] = useState("");
  const mountedRef = useRef(false);
  const generationRef = useRef(0);
  const cameraRef = useRef(null);
  const photoRef = useRef(null);
  const lookupLockRef = useRef(false);
  const videoRef = useRef(null);
  const inputRef = useRef(null);
  const fileRef = useRef(null);
  const callbacksRef = useRef({ onScan, scanning, onManual });
  callbacksRef.current = { onScan, scanning, onManual };
  const busy = scanning || findingRoll || readingPhoto;
  const reportedError = inputError || deviceError || error;

  // Invalidating the generation also cancels promises that cannot be aborted,
  // including a camera permission prompt and ZXing's image decode.
  function cancelMedia(updateState = true) {
    generationRef.current += 1;
    releaseCamera(cameraRef.current);
    cameraRef.current = null;
    if (photoRef.current) URL.revokeObjectURL(photoRef.current.url);
    photoRef.current = null;
    if (updateState && mountedRef.current) {
      setCamera(null);
      setReadingPhoto(false);
    }
  }

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cancelMedia(false);
    };
  }, []);

  useEffect(() => {
    if (!camera?.id) return undefined;
    const session = cameraRef.current;
    if (!session || session.id !== camera.id) return undefined;
    // A separate video element for each session prevents a late reader cleanup
    // from clearing the preview belonging to a newer camera attempt.
    session.video = videoRef.current;
    const isCurrent = () => mountedRef.current && !session.cancelled && generationRef.current === session.id;

    async function connect() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        if (!isCurrent()) { stopTracks(stream); return; }
        session.stream = stream;
        const reader = new BrowserMultiFormatReader(undefined, { delayBetweenScanAttempts: 180, delayBetweenScanSuccess: 500 });
        const controls = await reader.decodeFromStream(stream, session.video, (result, frameError, activeControls) => {
          if (!isCurrent()) { activeControls.stop(); return; }
          const text = result?.getText()?.trim();
          if (text) {
            session.controls = activeControls;
            void deliverScan(text);
          } else if (frameError && !EXPECTED_FRAME_ERRORS.has(frameError.getKind?.() || frameError.name)) {
            session.controls = activeControls;
            cancelMedia();
            setDeviceError("Camera scanning stopped. Try again, scan a photo, or enter the roll tag below.");
          }
        });
        if (!isCurrent()) { controls.stop(); return; }
        session.controls = controls;
        setCamera({ id: session.id, phase: "live" });
      } catch (cameraError) {
        if (!isCurrent()) { releaseCamera(session); return; }
        cancelMedia();
        setDeviceError(cameraMessage(cameraError));
      }
    }

    void connect();
    return () => releaseCamera(session);
  }, [camera?.id]);

  async function deliverScan(rawValue) {
    if (!mountedRef.current || callbacksRef.current.scanning || lookupLockRef.current) return;
    const text = String(rawValue ?? "").trim();
    if (!text) {
      setInputError("Enter a roll tag or QR link to find the roll.");
      inputRef.current?.focus();
      return;
    }
    lookupLockRef.current = true;
    // Release the camera before the parent looks up the roll or changes steps.
    cancelMedia();
    setValue(text);
    setInputError("");
    setDeviceError("");
    setFindingRoll(true);
    try {
      await callbacksRef.current.onScan(text);
    } catch (lookupError) {
      if (mountedRef.current) setInputError(lookupError?.message || "The roll could not be found. Try again or enter the material manually.");
    } finally {
      lookupLockRef.current = false;
      if (mountedRef.current) setFindingRoll(false);
    }
  }

  function startCamera() {
    if (busy || lookupLockRef.current) return;
    cancelMedia();
    setInputError("");
    setDeviceError("");
    if (window.isSecureContext === false || !navigator.mediaDevices?.getUserMedia) {
      setDeviceError(cameraMessage());
      return;
    }
    const session = { id: generationRef.current, cancelled: false, stream: null, controls: null, video: null };
    cameraRef.current = session;
    setCamera({ id: session.id, phase: "starting" });
  }

  function choosePhoto() {
    if (busy || lookupLockRef.current) return;
    cancelMedia();
    setInputError("");
    setDeviceError("");
    fileRef.current.value = "";
    fileRef.current.click();
  }

  async function readPhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || callbacksRef.current.scanning || lookupLockRef.current) return;
    cancelMedia();
    setInputError("");
    setDeviceError("");
    if (file.type && !file.type.startsWith("image/")) {
      setDeviceError("Choose a photo of the roll label, or enter the roll tag below.");
      return;
    }
    const photo = { id: generationRef.current, url: URL.createObjectURL(file) };
    photoRef.current = photo;
    setReadingPhoto(true);
    const isCurrent = () => mountedRef.current && generationRef.current === photo.id;
    try {
      const result = await new BrowserMultiFormatReader().decodeFromImageUrl(photo.url);
      if (!isCurrent()) return;
      const text = result?.getText()?.trim();
      if (!text) throw new Error("No barcode");
      await deliverScan(text);
    } catch {
      if (isCurrent()) setDeviceError("No readable barcode was found in that photo. Use a clear, close photo of the complete QR code or barcode, or enter the roll tag below.");
    } finally {
      if (photoRef.current === photo) {
        URL.revokeObjectURL(photo.url);
        photoRef.current = null;
      }
      if (isCurrent()) setReadingPhoto(false);
    }
  }

  const status = scanning || findingRoll ? "Finding the roll…" : readingPhoto ? "Reading the photo…" : camera?.phase === "starting" ? "Waiting for camera access…" : camera ? "Camera is on. Hold the complete QR code or barcode inside the frame." : "";

  return <div className="intake-scan">
    <p className="intake-scan-description">A Tri-State QR label finds the material, size, and lot saved with that roll. For an unrecognized supplier label, enter the material manually.</p>
    <div className="intake-scan-methods">
      {camera ? <button className="intake-scan-button is-stop" type="button" onClick={() => cancelMedia()}><Square size={17} aria-hidden="true" /> Stop camera</button>
        : <button className="intake-scan-button is-camera" type="button" onClick={startCamera} disabled={busy}><Camera size={19} aria-hidden="true" /> Start camera</button>}
      <button className="intake-scan-button" type="button" onClick={choosePhoto} disabled={busy}><ImagePlus size={19} aria-hidden="true" /> Scan a photo</button>
      <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={readPhoto} disabled={busy} hidden aria-label="Photo of roll label" />
    </div>
    <div className="intake-scan-preview" hidden={!camera}>
      <video key={camera?.id ?? "idle"} ref={videoRef} muted playsInline autoPlay aria-hidden="true" />
      <div className="intake-scan-frame" aria-hidden="true"><span /><span /><span /><span /></div>
      {camera?.phase === "starting" && <span className="intake-scan-camera-loading"><LoaderCircle size={24} className="intake-scan-spinner" aria-hidden="true" /> Opening camera</span>}
    </div>
    <p className="intake-scan-status" role="status" aria-live="polite" aria-atomic="true">{(scanning || findingRoll || readingPhoto) && <LoaderCircle size={17} className="intake-scan-spinner" aria-hidden="true" />}{status}</p>
    <div className="intake-scan-divider"><span>or enter a tag</span></div>
    <div className="intake-scan-field">
      <label htmlFor={`${id}-tag`}>Roll tag or QR link</label>
      <div className="intake-scan-input-row">
        <input ref={inputRef} id={`${id}-tag`} type="text" value={value} disabled={busy} autoComplete="off" autoCapitalize="off" spellCheck={false}
          placeholder="Scan, type, or paste the label" aria-invalid={Boolean(inputError || error)} aria-describedby={`${id}-hint${reportedError ? ` ${id}-error` : ""}`}
          onChange={(event) => { setValue(event.target.value); setInputError(""); }}
          onKeyDown={(event) => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); event.stopPropagation(); if (!busy) void deliverScan(value); } }} />
        <button className="intake-scan-button is-find" type="button" disabled={busy} onClick={() => void deliverScan(value)}><Search size={18} aria-hidden="true" /> Find roll</button>
      </div>
      <p id={`${id}-hint`} className="intake-scan-hint">A handheld scanner works in this field. Press Enter to find the roll.</p>
    </div>
    {reportedError && <div id={`${id}-error`} className="intake-scan-error" role="alert"><AlertCircle size={18} aria-hidden="true" /><p>{reportedError}</p></div>}
    <div className="intake-scan-manual">
      <span>No readable label?</span>
      <button className="intake-scan-manual-button" type="button" disabled={busy} onClick={() => { cancelMedia(); callbacksRef.current.onManual(); }}><Keyboard size={17} aria-hidden="true" /> Enter material manually</button>
    </div>
  </div>;
}
