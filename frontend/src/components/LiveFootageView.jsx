import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Gauge, Goal, Maximize2, Minimize2, Printer, QrCode, Save, Settings2, Timer, X } from "lucide-react";
import { fetchCollection, requestApi } from "../api";
import AnimatedNumber from "./AnimatedNumber";

const firebaseBase = "https://realtime2-94ff8-default-rtdb.firebaseio.com";
const goalFootage = 400000;
const wasteBufferPercent = 0.04;
const refreshMs = 30000;
const dailyRefreshMs = 120000;
const liveFootageAnimationMs = Math.max(30000, dailyRefreshMs - 4000);
const dailyLimit = 420;
const bucketMinutes = 10;
const maxValidSpeedFpm = 700;
const dailyFootageFuzzFt = 5;
const minDtSeconds = 60;
const shiftStartHour = 5;
const shiftStartMinute = 0;
const shiftEndHour = 2;
const shiftEndMinute = 59;
const archiveEndpoint = "live-footage-archives";
const etiDailyNode = "/ETI_SPEED";
const etiSettingsEndpoint = "live-footage/eti-settings";
const defaultEtiSettings = {
  wheelDiameterInches: 3,
  pulsesPerRevolution: 1,
  settingsCheckSeconds: 300,
  speedSendSeconds: 120,
  footageSendSeconds: 300,
  resetEnabled: false,
  resetHour: 3,
  resetMinute: 0,
};

const defaultQrLabelForm = {
  printer_press: "",
  printer_ip: "",
  printer_port: 9100,
  speed: "5",
  darkness: "11",
  copies: 1,
};

const presses = [
  { key: "18AZT", name: "18 Aztech", dailyNode: "/18Aztech_SPEED", speedNode: "/18Aztech_CURRENT_SPEED" },
  { key: "ETI", name: "ETI", dailyNode: etiDailyNode, speedNode: "/ETI_CURRENT_SPEED" },
  { key: "SLIT", name: "Slitter", dailyNode: "/SLITTER_SPEED", speedNode: "/SLITTER_CURRENT_SPEED" },
  { key: "13NIL", name: "13 Nilpeter", dailyNode: "/13Nilpeter_SPEED", speedNode: "/13Nilpeter_CURRENT_SPEED" },
  { key: "17NIL", name: "17 Nilpeter", dailyNode: "/17Nilpeter_SPEED", speedNode: "/17Nilpeter_CURRENT_SPEED" },
  { key: "13AZT", name: "13 Aztech", dailyNode: "/13Aztech_DAILY_SPEED", speedNode: "/13Aztech_CURRENT_SPEED" },
];

const palette = ["#c600e0", "#16a34a", "#ef4444", "#2563eb", "#eab308", "#f97316"];

function formatInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return Math.round(number).toLocaleString();
}

function formatShortNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  const abs = Math.abs(number);
  if (abs >= 1000000) return `${(number / 1000000).toFixed(abs >= 10000000 ? 0 : 1)}M`;
  if (abs >= 1000) return `${(number / 1000).toFixed(abs >= 100000 ? 0 : 1)}k`;
  return Math.round(number).toLocaleString();
}

function formatShortRate(value) {
  return `${formatShortNumber(value)}/hr`;
}

function formatInterval(value) {
  const seconds = Math.max(0, Number(value) || 0);
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function normalizeEtiSettings(settings = {}) {
  return {
    ...defaultEtiSettings,
    ...settings,
    wheelDiameterInches: Number(settings.wheelDiameterInches ?? defaultEtiSettings.wheelDiameterInches),
    pulsesPerRevolution: Number(settings.pulsesPerRevolution ?? defaultEtiSettings.pulsesPerRevolution),
    settingsCheckSeconds: Number(settings.settingsCheckSeconds ?? defaultEtiSettings.settingsCheckSeconds),
    speedSendSeconds: Number(settings.speedSendSeconds ?? defaultEtiSettings.speedSendSeconds),
    footageSendSeconds: Number(settings.footageSendSeconds ?? defaultEtiSettings.footageSendSeconds),
    resetEnabled: Boolean(settings.resetEnabled ?? defaultEtiSettings.resetEnabled),
    resetHour: Number(settings.resetHour ?? defaultEtiSettings.resetHour),
    resetMinute: Number(settings.resetMinute ?? defaultEtiSettings.resetMinute),
  };
}

function printerFieldsFromPress(press) {
  return {
    printer_press: press?.id ? String(press.id) : "",
    printer_ip: press?.printer_ip || "",
    printer_port: press?.printer_port || 9100,
    speed: press?.printer_speed || "5",
    darkness: press?.printer_darkness || "11",
  };
}

function readableApiError(error, fallback) {
  const rawMessage = String(error?.message || "").trim();
  if (!rawMessage) return fallback;
  try {
    const payload = JSON.parse(rawMessage);
    if (payload?.detail) return payload.detail;
    const firstValue = Object.values(payload || {})[0];
    if (Array.isArray(firstValue) && firstValue[0]) return firstValue[0];
  } catch {
    // The API helper also returns ordinary text errors.
  }
  return rawMessage;
}

function wasteAdjustedFootage(rawFootage) {
  const total = Math.max(0, Number(rawFootage) || 0);
  return total * (1 - wasteBufferPercent);
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

function formatLocalDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function emptyPace() {
  return {
    averageRate: 0,
    requiredRate: 0,
    projected: 0,
    liveRate: 0,
    statusRate: 0,
    elapsedHours: 0,
    shiftHours: 0,
    onPace: false,
    hasFootage: false,
    hasLiveRate: false,
    hasData: false,
  };
}

function paceFromFootage(adjustedFootage, start, effectiveNow, end, liveRate = 0) {
  const elapsedHours = Math.max(0.1, (effectiveNow.getTime() - start.getTime()) / 3600000);
  const shiftHours = Math.max(0.1, (end.getTime() - start.getTime()) / 3600000);
  const averageRate = adjustedFootage / elapsedHours;
  const requiredRate = goalFootage / shiftHours;
  const cleanLiveRate = Math.max(0, Number(liveRate) || 0);
  const hasFootage = adjustedFootage > 0;
  const hasLiveRate = cleanLiveRate > 0;
  const statusRate = hasFootage ? averageRate : cleanLiveRate;
  const projected = statusRate * shiftHours;
  return {
    averageRate,
    requiredRate,
    projected,
    liveRate: cleanLiveRate,
    statusRate,
    elapsedHours,
    shiftHours,
    onPace: statusRate >= requiredRate,
    hasFootage,
    hasLiveRate,
    hasData: hasFootage || hasLiveRate,
  };
}

function getShiftWindow(now = new Date()) {
  const start = new Date(now);
  start.setHours(shiftStartHour, shiftStartMinute, 0, 0);
  if (now.getTime() < start.getTime()) start.setDate(start.getDate() - 1);

  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  end.setHours(shiftEndHour, shiftEndMinute, 0, 0);
  return { start, end };
}

function dailyUrl(node) {
  return `${firebaseBase}${node}.json?orderBy="$key"&limitToLast=${dailyLimit}`;
}

function speedUrl(node) {
  return `${firebaseBase}${node}.json`;
}

async function fetchJson(url, signal) {
  const response = await fetch(url, { cache: "no-store", signal });
  if (response.status === 204) return null;
  const text = await response.text();
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeDailyList(payload) {
  if (!payload || typeof payload !== "object") return [];
  return Object.values(payload)
    .filter((value) => value && typeof value === "object" && "timestamp" in value)
    .map((value) => {
      const rawTimestamp = Number(value.timestamp) || 0;
      const timestampSeconds = rawTimestamp > 100000000000 ? rawTimestamp / 1000 : rawTimestamp;
      return { ts: timestampSeconds, footage: Number(value.footage) || 0 };
    })
    .filter((row) => row.ts > 0);
}

function filterDailyRows(rows, start, end) {
  const startMs = start.getTime();
  const endMs = end.getTime();
  const sorted = rows
    .filter((row) => row.ts > 0 && Number.isFinite(row.footage) && row.footage >= 0)
    .sort((a, b) => a.ts - b.ts);

  const kept = [];
  let prevTs = null;

  sorted.forEach((row) => {
    const rowMs = row.ts * 1000;
    if (rowMs < startMs || rowMs >= endMs) return;
    if (prevTs === null) {
      kept.push(row);
      prevTs = row.ts;
      return;
    }

    const dtSec = row.ts - prevTs;
    if (!Number.isFinite(dtSec) || dtSec <= 0 || dtSec < minDtSeconds) return;
    const maxPossibleFt = maxValidSpeedFpm * (dtSec / 60) + dailyFootageFuzzFt;
    if (row.footage > maxPossibleFt) return;

    kept.push(row);
    prevTs = row.ts;
  });

  return kept;
}

function buildBuckets(start, end) {
  const buckets = [];
  let cursor = new Date(start);
  while (cursor <= end) {
    buckets.push(new Date(cursor));
    cursor = addMinutes(cursor, bucketMinutes);
  }
  return buckets.length ? buckets : [new Date(start)];
}

function buildCumulativeBuckets(rows, start, buckets, end) {
  const bucketSum = new Array(buckets.length).fill(0);
  const startMs = start.getTime();
  const endMs = end.getTime();

  rows.forEach((row) => {
    const rowMs = row.ts * 1000;
    if (rowMs < startMs || rowMs >= endMs) return;
    const index = Math.floor((rowMs - startMs) / (bucketMinutes * 60000));
    if (index >= 0 && index < bucketSum.length) bucketSum[index] += row.footage;
  });

  let running = 0;
  return bucketSum.map((value) => {
    running += value;
    return running;
  });
}

function extractSpeed(payload) {
  let speed = 0;
  if (typeof payload === "number") speed = payload;
  else if (payload && typeof payload === "object") {
    speed = Number(payload.currentSpeed ?? payload.speed ?? 0) || 0;
  }
  if (!Number.isFinite(speed) || speed < 0 || speed > maxValidSpeedFpm) return 0;
  return speed;
}

function speedTone(speed) {
  if (speed < 70) return "bad";
  if (speed < 200) return "warn";
  if (speed >= 350) return "good";
  return "idle";
}

function pressColor(index) {
  return palette[index % palette.length];
}

function makeArchiveRecord(start, end, dailyData) {
  const pressTotals = presses.map((press) => ({
    key: press.key,
    name: press.name,
    total: Number(dailyData?.totalsByKey?.[press.key] || 0),
  }));
  const totalFootage = pressTotals.reduce((sum, press) => sum + press.total, 0);
  const shiftDate = formatLocalDateKey(start);

  return {
    shift_date: shiftDate,
    shift_start: start.toISOString(),
    shift_end: end.toISOString(),
    total_footage: totalFootage,
    goal_footage: goalFootage,
    press_totals: pressTotals,
  };
}

function normalizeArchiveRecord(record) {
  const shiftDate = record.shift_date ?? record.shiftDate ?? record.id ?? "";
  return {
    id: record.id ?? shiftDate,
    shiftDate,
    start: record.shift_start ?? record.start ?? "",
    end: record.shift_end ?? record.end ?? "",
    savedAt: record.saved_at ?? record.savedAt ?? record.updated_at ?? "",
    totalFootage: Number(record.total_footage ?? record.totalFootage ?? 0),
    pressTotals: Array.isArray(record.press_totals ?? record.pressTotals) ? (record.press_totals ?? record.pressTotals) : [],
  };
}

function roundRect(ctx, x, y, width, height, radius) {
  const rr = Math.min(radius, height / 2, width / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + width, y, x + width, y + height, rr);
  ctx.arcTo(x + width, y + height, x, y + height, rr);
  ctx.arcTo(x, y + height, x, y, rr);
  ctx.arcTo(x, y, x + width, y, rr);
  ctx.closePath();
}

function drawTag(ctx, canvas, x, y, text, color) {
  const dpr = window.devicePixelRatio || 1;
  const padX = 13 * dpr;
  ctx.font = `1000 ${18 * dpr}px ui-sans-serif, system-ui`;
  const width = ctx.measureText(text).width + padX * 2 + 14 * dpr;
  const clampedX = Math.min(canvas.width - width - 8 * dpr, Math.max(8 * dpr, x));
  const clampedY = Math.min(canvas.height - 28 * dpr, Math.max(18 * dpr, y));

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.92)";
  roundRect(ctx, clampedX, clampedY - 18 * dpr, width, 36 * dpr, 10 * dpr);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,.12)";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(clampedX + 15 * dpr, clampedY, 5.5 * dpr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, clampedX + 28 * dpr, clampedY);
  ctx.restore();
}

function drawChart(canvas, seriesList, labels) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(760, Math.round(rect.width * dpr));
  const height = Math.max(360, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const padL = 66 * dpr;
  const padR = 18 * dpr;
  const padT = 18 * dpr;
  const padB = 48 * dpr;
  const plotW = canvas.width - padL - padR;
  const plotH = canvas.height - padT - padB;

  let max = 1;
  seriesList.forEach((series) => {
    const values = series.points.filter((value) => value !== null && Number.isFinite(Number(value))).map(Number);
    if (values.length) max = Math.max(max, Math.max(...values));
  });

  ctx.strokeStyle = "rgba(15,23,42,.10)";
  ctx.lineWidth = dpr;
  for (let i = 0; i <= 5; i += 1) {
    const y = padT + (plotH * i) / 5;
    ctx.beginPath();
    ctx.moveTo(padL, y);
    ctx.lineTo(padL + plotW, y);
    ctx.stroke();

    const value = max - (max * i) / 5;
    ctx.fillStyle = "#64748b";
    ctx.font = `900 ${16 * dpr}px ui-sans-serif, system-ui`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatInt(value), padL - 10 * dpr, y);
  }

  const labelStep = Math.max(1, Math.floor(labels.length / 8));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0) return;
    const x = padL + plotW * (index / Math.max(1, labels.length - 1));
    ctx.fillStyle = "#64748b";
    ctx.font = `900 ${16 * dpr}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, x, padT + plotH + 12 * dpr);
  });

  seriesList.forEach((series) => {
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 3.6 * dpr;
    ctx.beginPath();
    let started = false;
    let lastX = padL;
    let lastY = padT + plotH;

    series.points.forEach((value, index) => {
      if (value === null || !Number.isFinite(Number(value))) return;
      const x = padL + plotW * (index / Math.max(1, labels.length - 1));
      const y = padT + plotH * (1 - Number(value) / Math.max(1, max));
      lastX = x;
      lastY = y;
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else {
        ctx.lineTo(x, y);
      }
    });
    ctx.stroke();
    ctx.fillStyle = series.color;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 4.4 * dpr, 0, Math.PI * 2);
    ctx.fill();

    const total = series.points.length ? series.points[series.points.length - 1] || 0 : 0;
    drawTag(ctx, canvas, lastX + 10 * dpr, lastY, `${series.name} ${formatInt(total)} ft`, series.color);
  });
}

function Metric({ icon: Icon, label, value, note, tone = "" }) {
  return (
    <article className={`live-footage-metric ${tone ? `live-footage-metric-${tone}` : ""}`}>
      <span><Icon size={15} /> {label}</span>
      <strong>{value}</strong>
      <em>{note}</em>
    </article>
  );
}

function PaceNote({ pace, goalHit }) {
  const safePace = pace || emptyPace();
  const tone = goalHit ? "hit" : safePace.onPace ? "good" : "bad";
  const label = goalHit ? "Goal hit" : safePace.onPace ? "On pace" : "Behind pace";
  if (!safePace.hasFootage && safePace.hasLiveRate) {
    return (
      <span className={`live-footage-pace-note ${tone}`}>
        <i />
        <b>{label}</b>
        <span><small>Live</small> {formatShortRate(safePace.liveRate)}</span>
        <span><small>Need</small> {formatShortRate(safePace.requiredRate)}</span>
        <span><small>Avg</small> Building</span>
      </span>
    );
  }
  return (
    <span className={`live-footage-pace-note ${tone}`}>
      <i />
      <b>{label}</b>
      <span><small>Avg</small> {formatShortRate(safePace.averageRate)}</span>
      <span><small>Need</small> {formatShortRate(safePace.requiredRate)}</span>
      <span><small>Projected</small> {formatShortNumber(safePace.projected)} ft</span>
    </span>
  );
}

export default function LiveFootageView({
  tvMode = false,
  onTvModeChange = () => {},
  currentUser = null,
  canManageSettings = false,
}) {
  const canvasRef = useRef(null);
  const dailyCacheRef = useRef(null);
  const lastDailyFetchRef = useRef(0);
  const mountedRef = useRef(false);
  const activeControllerRef = useRef(null);
  const refreshRef = useRef(null);
  const chartDrawnRef = useRef(false);
  const savedArchiveIdsRef = useRef(new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(defaultEtiSettings);
  const [settingsStatus, setSettingsStatus] = useState({
    loading: false,
    saving: false,
    error: "",
    notice: "",
    exists: true,
  });
  const [qrLabelsOpen, setQrLabelsOpen] = useState(false);
  const [printerPresses, setPrinterPresses] = useState([]);
  const [qrLabelForm, setQrLabelForm] = useState(defaultQrLabelForm);
  const [qrLabelStatus, setQrLabelStatus] = useState({
    loading: false,
    printingKey: "",
    error: "",
    notice: "",
  });
  const [snapshot, setSnapshot] = useState({
    state: "loading",
    error: "",
    archiveStatus: "",
    rangeText: "",
    companyTotal: 0,
    adjustedFootage: 0,
    currentWasteFootage: 0,
    remaining: goalFootage,
    percent: 0,
    updatedAt: "",
    updatedAtMs: Date.now(),
    shiftDate: "",
    paceText: "",
    pace: emptyPace(),
    tiles: presses.map((press, index) => ({ ...press, color: pressColor(index), speed: 0, total: 0 })),
  });

  const animatedSnapshot = useMemo(() => {
    const tiles = snapshot.tiles.map((tile) => ({
      ...tile,
      animatedTotal: Number(tile.total || 0),
    }));
    const companyTotal = tiles.reduce((sum, tile) => sum + tile.animatedTotal, 0);
    const adjustedFootage = wasteAdjustedFootage(companyTotal);
    const currentWasteFootage = Math.max(0, companyTotal - adjustedFootage);
    const remaining = Math.max(0, goalFootage - adjustedFootage);
    const percent = Math.max(0, Math.min(100, (adjustedFootage / goalFootage) * 100));
    return {
      ...snapshot,
      tiles,
      companyTotal,
      adjustedFootage,
      currentWasteFootage,
      remaining,
      percent,
    };
  }, [snapshot]);

  const sortedTiles = useMemo(() => [...animatedSnapshot.tiles].sort((a, b) => b.animatedTotal - a.animatedTotal), [animatedSnapshot.tiles]);
  const goalHit = animatedSnapshot.adjustedFootage >= goalFootage;
  const wasteBufferPercentLabel = `${Math.round(wasteBufferPercent * 100)}%`;
  const countedProgressPercent = Math.max(0, Math.min(100, animatedSnapshot.percent));
  const wasteProgressPercent = Math.max(0, Math.min(100 - countedProgressPercent, (animatedSnapshot.currentWasteFootage / goalFootage) * 100));
  const settingsHeaders = {
    "X-Company-User-Id": String(currentUser?.id || ""),
    "X-Company-Username": String(currentUser?.username || ""),
  };
  const selectedPrinterPress = useMemo(
    () => printerPresses.find((press) => String(press.id) === String(qrLabelForm.printer_press)),
    [printerPresses, qrLabelForm.printer_press]
  );

  async function openSettings() {
    setSettingsOpen(true);
    setSettingsStatus({ loading: true, saving: false, error: "", notice: "", exists: true });
    try {
      const payload = await requestApi(etiSettingsEndpoint, { headers: settingsHeaders });
      setSettingsForm(normalizeEtiSettings(payload?.settings));
      setSettingsStatus({
        loading: false,
        saving: false,
        error: "",
        notice: "",
        exists: payload?.exists !== false,
      });
    } catch (error) {
      setSettingsStatus({
        loading: false,
        saving: false,
        error: readableApiError(error, "Could not load ETI settings."),
        notice: "",
        exists: true,
      });
    }
  }

  function updateSetting(key, value) {
    setSettingsForm((current) => ({ ...current, [key]: value }));
    setSettingsStatus((current) => ({ ...current, error: "", notice: "" }));
  }

  function updateResetTime(value) {
    const [hour, minute] = String(value || "00:00").split(":").map(Number);
    setSettingsForm((current) => ({
      ...current,
      resetHour: Number.isFinite(hour) ? hour : 0,
      resetMinute: Number.isFinite(minute) ? minute : 0,
    }));
    setSettingsStatus((current) => ({ ...current, error: "", notice: "" }));
  }

  async function saveSettings(event) {
    event.preventDefault();
    setSettingsStatus((current) => ({ ...current, saving: true, error: "", notice: "" }));
    const payload = {
      wheelDiameterInches: Number(settingsForm.wheelDiameterInches),
      pulsesPerRevolution: Number(settingsForm.pulsesPerRevolution),
      settingsCheckSeconds: Number(settingsForm.settingsCheckSeconds),
      speedSendSeconds: Number(settingsForm.speedSendSeconds),
      footageSendSeconds: Number(settingsForm.footageSendSeconds),
      resetEnabled: Boolean(settingsForm.resetEnabled),
      resetHour: Number(settingsForm.resetHour),
      resetMinute: Number(settingsForm.resetMinute),
    };
    try {
      const result = await requestApi(etiSettingsEndpoint, {
        method: "PUT",
        headers: settingsHeaders,
        body: JSON.stringify(payload),
      });
      setSettingsForm(normalizeEtiSettings(result?.settings));
      setSettingsStatus({
        loading: false,
        saving: false,
        error: "",
        notice: `Saved. The ETI controller will apply this within ${formatInterval(payload.settingsCheckSeconds)}.`,
        exists: true,
      });
    } catch (error) {
      setSettingsStatus((current) => ({
        ...current,
        saving: false,
        error: readableApiError(error, "Could not save ETI settings."),
        notice: "",
      }));
    }
  }

  async function openQrLabels() {
    setQrLabelsOpen(true);
    setQrLabelStatus({ loading: true, printingKey: "", error: "", notice: "" });
    try {
      const payload = await fetchCollection("presses", { ordering: "name", pageSize: 500, fetchAll: true });
      const rows = payload.results || [];
      const suggested = rows.find((press) => String(press.printer_ip || "").trim()) || rows[0] || null;
      setPrinterPresses(rows);
      setQrLabelForm((current) => ({
        ...current,
        ...printerFieldsFromPress(suggested),
        copies: current.copies || 1,
      }));
      setQrLabelStatus({ loading: false, printingKey: "", error: "", notice: "" });
    } catch (error) {
      setQrLabelStatus({
        loading: false,
        printingKey: "",
        error: readableApiError(error, "Could not load printer presses."),
        notice: "",
      });
    }
  }

  function updateQrPrinterPress(pressId) {
    const press = printerPresses.find((item) => String(item.id) === String(pressId));
    setQrLabelForm((current) => ({
      ...current,
      ...printerFieldsFromPress(press),
      printer_press: pressId,
    }));
    setQrLabelStatus((current) => ({ ...current, error: "", notice: "" }));
  }

  function updateQrLabelField(key, value) {
    setQrLabelForm((current) => ({ ...current, [key]: value }));
    setQrLabelStatus((current) => ({ ...current, error: "", notice: "" }));
  }

  async function printDashboardQrLabel(press) {
    const printerIp = String(qrLabelForm.printer_ip || "").trim();
    if (!printerIp) {
      setQrLabelStatus({
        loading: false,
        printingKey: "",
        error: "Enter a printer IP before printing the QR label.",
        notice: "",
      });
      return;
    }
    setQrLabelStatus({ loading: false, printingKey: press.key, error: "", notice: "" });
    try {
      const payload = await requestApi("live-footage/press-dashboard-label", {
        method: "POST",
        headers: settingsHeaders,
        body: JSON.stringify({
          dashboard_press_key: press.key,
          printer_press: qrLabelForm.printer_press || null,
          printer_ip: printerIp,
          printer_port: qrLabelForm.printer_port,
          speed: qrLabelForm.speed,
          darkness: qrLabelForm.darkness,
          copies: qrLabelForm.copies,
          frontend_url: typeof window !== "undefined" ? window.location.origin : "",
          performed_by: currentUser?.name || currentUser?.username || "",
        }),
      });
      setQrLabelStatus({
        loading: false,
        printingKey: "",
        error: "",
        notice: `Queued ${press.name} QR label to ${payload?.printerIp || printerIp}.`,
      });
    } catch (error) {
      setQrLabelStatus({
        loading: false,
        printingKey: "",
        error: readableApiError(error, `Could not print ${press.name} QR label.`),
        notice: "",
      });
    }
  }

  async function commitArchiveRecord(record) {
    const archiveId = record.shift_date;
    if (savedArchiveIdsRef.current.has(archiveId)) return null;

    const saved = await requestApi(`${archiveEndpoint}/archive-shift`, {
      method: "POST",
      body: JSON.stringify(record),
    });

    savedArchiveIdsRef.current.add(archiveId);
    return normalizeArchiveRecord(saved);
  }

  useEffect(() => {
    mountedRef.current = true;

    async function refresh({ forceDaily = false } = {}) {
      activeControllerRef.current?.abort();
      const controller = new AbortController();
      activeControllerRef.current = controller;
      const now = new Date();
      const { start, end } = getShiftWindow(now);
      const shiftDate = formatLocalDateKey(start);
      const effectiveNow = now.getTime() > end.getTime() ? end : now;
      const rangeText = `Shift: ${start.toLocaleString()} -> ${end.toLocaleString()}`;
      const archiveWindowStart = end.getTime() - 60000;
      const archiveWindowEnd = end.getTime() + 10 * 60000;
      const isArchiveWindow = now.getTime() >= archiveWindowStart && now.getTime() <= archiveWindowEnd;
      const shouldFetchDaily = forceDaily || isArchiveWindow || !dailyCacheRef.current || Date.now() - lastDailyFetchRef.current >= dailyRefreshMs;

      let dailyData = dailyCacheRef.current;

      try {
        if (shouldFetchDaily) {
          const buckets = buildBuckets(start, effectiveNow);
          const labels = buckets.map((date) => `${pad2(date.getHours())}:${pad2(date.getMinutes())}`);
          const results = await Promise.all(
            presses.map((press) => fetchJson(dailyUrl(press.dailyNode), controller.signal).catch((error) => {
              if (error.name === "AbortError") throw error;
              return { error: error.message };
            }))
          );

          const seriesList = [];
          const totalsByKey = {};
          const errors = [];

          presses.forEach((press, index) => {
            const payload = results[index];
            if (payload?.error) {
              errors.push(`${press.name}: ${payload.error}`);
              return;
            }
            const rows = filterDailyRows(normalizeDailyList(payload), start, end);
            const points = buildCumulativeBuckets(rows, start, buckets, end);
            const total = points.length ? points[points.length - 1] : 0;
            totalsByKey[press.key] = total;
            seriesList.push({ key: press.key, name: press.name, color: pressColor(index), points });
          });

          dailyData = {
            labels,
            seriesList,
            totalsByKey,
            companyTotal: Object.values(totalsByKey).reduce((sum, value) => sum + Number(value || 0), 0),
            errors,
          };
          dailyCacheRef.current = dailyData;
          lastDailyFetchRef.current = Date.now();
        }

        const speedResults = await Promise.all(
          presses.map((press) => fetchJson(speedUrl(press.speedNode), controller.signal).catch((error) => {
            if (error.name === "AbortError") throw error;
            return null;
          }))
        );

        if (!mountedRef.current) return;

        if (canvasRef.current && dailyData && (shouldFetchDaily || !chartDrawnRef.current)) {
          drawChart(canvasRef.current, dailyData.seriesList, dailyData.labels);
          chartDrawnRef.current = true;
        }

        let archiveStatus = "";
        if (dailyData && now.getTime() >= end.getTime()) {
          const record = makeArchiveRecord(start, end, dailyData);
          if (Number(record.total_footage || 0) > 0) {
            try {
              const savedRecord = await commitArchiveRecord(record);
              archiveStatus = savedRecord
                ? `Saved ${savedRecord.shiftDate} to database at ${new Date(savedRecord.savedAt).toLocaleTimeString()}`
                : "Saved to database";
            } catch (error) {
              archiveStatus = "Database archive failed";
            }
          }
        }

        setSnapshot((current) => {
          const sameShift = current.shiftDate === shiftDate;
          const previousTotals = new Map((current.tiles || []).map((tile) => [tile.key, Number(tile.total || 0)]));
          const rawTotals = dailyData?.totalsByKey || {};
          const tiles = presses.map((press, index) => {
            const confirmedTotal = Number(rawTotals[press.key] || 0);
            const previousTotal = Number(previousTotals.get(press.key) || 0);
            return {
              ...press,
              color: pressColor(index),
              speed: extractSpeed(speedResults[index]),
              total: sameShift ? Math.max(previousTotal, confirmedTotal) : confirmedTotal,
            };
          });
          const companyTotal = tiles.reduce((sum, tile) => sum + Number(tile.total || 0), 0);
          const liveRate = tiles.reduce((sum, tile) => sum + Number(tile.speed || 0), 0) * 60;
          const adjustedFootage = wasteAdjustedFootage(companyTotal);
          const currentWasteFootage = Math.max(0, companyTotal - adjustedFootage);
          const remaining = Math.max(0, goalFootage - adjustedFootage);
          const percent = Math.max(0, Math.min(100, (adjustedFootage / goalFootage) * 100));
          const pace = paceFromFootage(adjustedFootage, start, effectiveNow, end, liveRate);
          return {
            ...current,
            state: "ready",
            error: dailyData?.errors?.length ? dailyData.errors.join("\n") : "",
            archiveStatus,
            rangeText,
            companyTotal,
            adjustedFootage,
            currentWasteFootage,
            remaining,
            percent,
            updatedAt: new Date().toLocaleTimeString(),
            updatedAtMs: Date.now(),
            shiftDate,
            pace,
            paceText: `Avg ${formatInt(pace.averageRate)}/hr / Need ${formatInt(pace.requiredRate)}/hr / Projected ${formatInt(pace.projected)}`,
            tiles,
          };
        });
      } catch (error) {
        if (!mountedRef.current || error.name === "AbortError") return;
        setSnapshot((current) => ({ ...current, state: "error", error: error.message || "Could not load live footage." }));
      } finally {
        if (activeControllerRef.current === controller) activeControllerRef.current = null;
      }
    }

    refreshRef.current = refresh;
    refresh({ forceDaily: true });
    const intervalId = window.setInterval(refresh, refreshMs);
    const resize = () => {
      if (canvasRef.current && dailyCacheRef.current) {
        drawChart(canvasRef.current, dailyCacheRef.current.seriesList, dailyCacheRef.current.labels);
        chartDrawnRef.current = true;
      }
    };
    window.addEventListener("resize", resize);

    return () => {
      mountedRef.current = false;
      refreshRef.current = null;
      activeControllerRef.current?.abort();
      activeControllerRef.current = null;
      window.clearInterval(intervalId);
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const frameId = window.requestAnimationFrame(() => {
      if (canvasRef.current && dailyCacheRef.current) {
        drawChart(canvasRef.current, dailyCacheRef.current.seriesList, dailyCacheRef.current.labels);
        chartDrawnRef.current = true;
      } else {
        chartDrawnRef.current = false;
      }
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [tvMode]);

  useEffect(() => {
    if (!settingsOpen) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [settingsOpen]);

  return (
    <section className="live-footage-view">
      <div className="live-footage-hero">
        <div>
          <p className="eyebrow">Realtime Press Footage</p>
          <h2>Companywide Footage Race</h2>
          <span>{snapshot.rangeText || "Loading shift window..."}</span>
        </div>
        <div className="live-footage-hero-actions">
          {canManageSettings && !tvMode && (
            <>
              <button className="live-footage-settings-btn" type="button" onClick={openQrLabels}>
                <QrCode size={15} /> Press QR Labels
              </button>
              <button className="live-footage-settings-btn" type="button" onClick={openSettings}>
                <Settings2 size={15} /> ETI Settings
              </button>
            </>
          )}
          <button type="button" onClick={() => {
            dailyCacheRef.current = null;
            lastDailyFetchRef.current = 0;
            chartDrawnRef.current = false;
            setSnapshot((current) => ({ ...current, state: "loading" }));
            refreshRef.current?.({ forceDaily: true });
          }}>
            <Activity size={15} /> Refresh Daily
          </button>
          <button className="live-footage-tv-btn" type="button" onClick={() => onTvModeChange(!tvMode)}>
            {tvMode ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            {tvMode ? "Exit TV Mode" : "TV Mode"}
          </button>
        </div>
      </div>

      <div className="live-footage-metrics">
        <Metric
          icon={goalHit ? CheckCircle2 : Gauge}
          label="Total Footage"
          value={<AnimatedNumber value={animatedSnapshot.adjustedFootage} className="live-footage-main-counter" durationMs={liveFootageAnimationMs} initialDurationMs={1200} easing="linear" />}
          note={<PaceNote pace={animatedSnapshot.pace} goalHit={goalHit} />}
          tone={goalHit ? "hit" : ""}
        />
        <Metric icon={Goal} label="Shift Goal" value={formatInt(goalFootage)} note={`After ${wasteBufferPercentLabel} waste`} tone={goalHit ? "hit" : ""} />
        <Metric icon={Timer} label="Remaining" value={formatInt(animatedSnapshot.remaining)} note="To hit the shift goal" />
      </div>

      <div className={`live-footage-progress ${goalHit ? "goal-hit" : ""}`}>
        <div className="live-footage-progress-track">
          <span className="live-footage-progress-counted" style={{ width: `${countedProgressPercent}%` }} />
          <span className="live-footage-progress-waste" style={{ left: `${countedProgressPercent}%`, width: `${wasteProgressPercent}%` }} />
        </div>
        <p>
          {goalHit ? "Goal hit" : `${animatedSnapshot.percent.toFixed(1)}% to goal`}
          <em>{wasteBufferPercentLabel} waste: {formatInt(animatedSnapshot.currentWasteFootage)} ft held / Updated {snapshot.updatedAt || "--"}{snapshot.archiveStatus ? ` - ${snapshot.archiveStatus}` : ""}</em>
        </p>
      </div>

      {goalHit && (
        <div className="live-footage-goal-hit">
          <CheckCircle2 size={22} />
          <div>
            <strong>Shift goal hit</strong>
            <span>{formatInt(animatedSnapshot.adjustedFootage)} ft total against a {formatInt(goalFootage)} ft goal. {wasteBufferPercentLabel} waste currently held: {formatInt(animatedSnapshot.currentWasteFootage)} ft.</span>
          </div>
        </div>
      )}

      {snapshot.error && (
        <div className="live-footage-error">
          <AlertTriangle size={15} />
          <span>{snapshot.error}</span>
        </div>
      )}

      <div className="live-footage-grid">
        <article className="live-footage-card live-footage-chart-card">
          <header>
            <strong>All Presses</strong>
            <span>Cumulative footage - full shift - {bucketMinutes}-minute buckets</span>
          </header>
          <canvas ref={canvasRef} aria-label="Cumulative press footage chart" />
        </article>

        <article className="live-footage-card">
          <header>
            <strong>Press Status</strong>
            <span>Speed + total footage</span>
          </header>
          <div className="live-footage-tiles">
            {sortedTiles.map((tile) => (
              <div className={`live-footage-tile ${speedTone(tile.speed)}`} key={tile.key}>
                <div>
                  <span style={{ background: tile.color }} />
                  <div>
                    <strong>{tile.name}</strong>
                    <em>{tile.key}</em>
                  </div>
                </div>
                <div className="live-footage-press-numbers">
                  <strong><AnimatedNumber value={tile.animatedTotal} suffix="ft" className="live-footage-press-counter" durationMs={liveFootageAnimationMs} initialDurationMs={1200} easing="linear" /></strong>
                  <em>{formatInt(tile.speed)} FPM</em>
                </div>
              </div>
            ))}
          </div>
          <p className="live-footage-note">Speeds and daily rows over {maxValidSpeedFpm} FPM are ignored. The browser saves the finished shift locally once it reaches 2:59 AM.</p>
        </article>
      </div>

      {settingsOpen && canManageSettings && (
        <div className="live-device-settings-overlay" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
          <section
            className="live-device-settings-window"
            role="dialog"
            aria-modal="true"
            aria-labelledby="eti-settings-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="live-device-settings-header">
              <div>
                <span className="live-device-settings-kicker"><Settings2 size={15} /> Admin device control</span>
                <h3 id="eti-settings-title">ETI Footage Settings</h3>
                <p>Changes are saved to Firebase and picked up by the ESP32 automatically.</p>
              </div>
              <button className="live-device-settings-close" type="button" onClick={() => setSettingsOpen(false)} aria-label="Close ETI settings">
                <X size={19} />
              </button>
            </header>

            {settingsStatus.loading ? (
              <div className="live-device-settings-loading">
                <Activity size={20} />
                <strong>Loading device settings...</strong>
              </div>
            ) : (
              <form className="live-device-settings-form" onSubmit={saveSettings}>
                {!settingsStatus.exists && (
                  <div className="live-device-settings-info">
                    <CheckCircle2 size={17} />
                    <span>The controller is using safe defaults. Saving will create its Firebase settings.</span>
                  </div>
                )}

                <div className="live-device-settings-section">
                  <div className="live-device-settings-section-title">
                    <Gauge size={18} />
                    <div>
                      <strong>Wheel calibration</strong>
                      <span>These values determine the measured feet and FPM.</span>
                    </div>
                  </div>
                  <div className="live-device-settings-fields two-column">
                    <label>
                      <span>Wheel diameter</span>
                      <div className="live-device-settings-input">
                        <input
                          type="number"
                          min="0.5"
                          max="48"
                          step="0.001"
                          value={settingsForm.wheelDiameterInches}
                          onChange={(event) => updateSetting("wheelDiameterInches", event.target.value)}
                          required
                        />
                        <small>inches</small>
                      </div>
                    </label>
                    <label>
                      <span>Pulses per revolution</span>
                      <div className="live-device-settings-input">
                        <input
                          type="number"
                          min="1"
                          max="100"
                          step="1"
                          value={settingsForm.pulsesPerRevolution}
                          onChange={(event) => updateSetting("pulsesPerRevolution", event.target.value)}
                          required
                        />
                        <small>pulses</small>
                      </div>
                    </label>
                  </div>
                </div>

                <div className="live-device-settings-section">
                  <div className="live-device-settings-section-title">
                    <Timer size={18} />
                    <div>
                      <strong>Update timing</strong>
                      <span>Longer intervals use fewer Firebase requests.</span>
                    </div>
                  </div>
                  <div className="live-device-settings-fields three-column">
                    <label>
                      <span>Check settings</span>
                      <div className="live-device-settings-input">
                        <input
                          type="number"
                          min="30"
                          max="86400"
                          step="1"
                          value={settingsForm.settingsCheckSeconds}
                          onChange={(event) => updateSetting("settingsCheckSeconds", event.target.value)}
                          required
                        />
                        <small>seconds</small>
                      </div>
                      <em>{formatInterval(settingsForm.settingsCheckSeconds)}</em>
                    </label>
                    <label>
                      <span>Send current speed</span>
                      <div className="live-device-settings-input">
                        <input
                          type="number"
                          min="5"
                          max="3600"
                          step="1"
                          value={settingsForm.speedSendSeconds}
                          onChange={(event) => updateSetting("speedSendSeconds", event.target.value)}
                          required
                        />
                        <small>seconds</small>
                      </div>
                      <em>{formatInterval(settingsForm.speedSendSeconds)}</em>
                    </label>
                    <label>
                      <span>Send daily footage</span>
                      <div className="live-device-settings-input">
                        <input
                          type="number"
                          min="30"
                          max="21600"
                          step="1"
                          value={settingsForm.footageSendSeconds}
                          onChange={(event) => updateSetting("footageSendSeconds", event.target.value)}
                          required
                        />
                        <small>seconds</small>
                      </div>
                      <em>{formatInterval(settingsForm.footageSendSeconds)}</em>
                    </label>
                  </div>
                </div>

                <div className={`live-device-reset-row ${settingsForm.resetEnabled ? "enabled" : ""}`}>
                  <div className="live-device-settings-section-title">
                    <AlertTriangle size={18} />
                    <div>
                      <strong>ESP32 daily reset</strong>
                      <span>When enabled, the controller clears ETI footage at the selected Ohio time.</span>
                    </div>
                  </div>
                  <div className="live-device-reset-controls">
                    <label className="live-device-toggle">
                      <input
                        type="checkbox"
                        checked={settingsForm.resetEnabled}
                        onChange={(event) => updateSetting("resetEnabled", event.target.checked)}
                      />
                      <span aria-hidden="true" />
                      <b>{settingsForm.resetEnabled ? "Enabled" : "Disabled"}</b>
                    </label>
                    <label className="live-device-time">
                      <span>Reset time</span>
                      <input
                        type="time"
                        value={`${pad2(settingsForm.resetHour)}:${pad2(settingsForm.resetMinute)}`}
                        onChange={(event) => updateResetTime(event.target.value)}
                        disabled={!settingsForm.resetEnabled}
                      />
                    </label>
                  </div>
                </div>

                {settingsStatus.error && (
                  <div className="live-device-settings-message error">
                    <AlertTriangle size={16} />
                    <span>{settingsStatus.error}</span>
                  </div>
                )}
                {settingsStatus.notice && (
                  <div className="live-device-settings-message success">
                    <CheckCircle2 size={16} />
                    <span>{settingsStatus.notice}</span>
                  </div>
                )}

                <footer className="live-device-settings-footer">
                  <button type="button" className="secondary" onClick={() => setSettingsOpen(false)}>Cancel</button>
                  <button type="submit" className="primary" disabled={settingsStatus.saving}>
                    {settingsStatus.saving ? <Activity className="live-device-settings-spin" size={17} /> : <Save size={17} />}
                    {settingsStatus.saving ? "Saving..." : "Save ETI Settings"}
                  </button>
                </footer>
              </form>
            )}
          </section>
        </div>
      )}

      {qrLabelsOpen && canManageSettings && (
        <div className="live-device-settings-overlay" role="presentation" onMouseDown={() => setQrLabelsOpen(false)}>
          <section
            className="live-device-settings-window press-qr-label-window"
            role="dialog"
            aria-modal="true"
            aria-labelledby="press-qr-label-title"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <header className="live-device-settings-header">
              <div>
                <span className="live-device-settings-kicker"><QrCode size={15} /> 4 x 3 scan label</span>
                <h3 id="press-qr-label-title">Press Dashboard QR Labels</h3>
                <p>Print a scan label for each press so operators can open their live phone dashboard.</p>
              </div>
              <button className="live-device-settings-close" type="button" onClick={() => setQrLabelsOpen(false)} aria-label="Close press QR labels">
                <X size={19} />
              </button>
            </header>

            {qrLabelStatus.loading ? (
              <div className="live-device-settings-loading">
                <Activity size={20} />
                <strong>Loading printer settings...</strong>
              </div>
            ) : (
              <>
                <div className="press-qr-printer-card">
                  <div className="press-qr-printer-title">
                    <Printer size={18} />
                    <div>
                      <strong>Printer</strong>
                      <span>{selectedPrinterPress?.name || "Choose the printer press or enter an IP."}</span>
                    </div>
                  </div>
                  <div className="press-qr-printer-fields">
                    <label>
                      <span>Printer press</span>
                      <select value={qrLabelForm.printer_press} onChange={(event) => updateQrPrinterPress(event.target.value)}>
                        <option value="">Manual printer IP</option>
                        {printerPresses.map((press) => (
                          <option value={press.id} key={press.id}>
                            {press.name}{press.printer_ip ? ` / ${press.printer_ip}` : " / no printer IP"}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      <span>Printer IP</span>
                      <input value={qrLabelForm.printer_ip} onChange={(event) => updateQrLabelField("printer_ip", event.target.value)} placeholder="192.168.1.100" />
                    </label>
                    <label>
                      <span>Port</span>
                      <input type="number" min="1" value={qrLabelForm.printer_port} onChange={(event) => updateQrLabelField("printer_port", event.target.value)} />
                    </label>
                    <label>
                      <span>Speed</span>
                      <input value={qrLabelForm.speed} onChange={(event) => updateQrLabelField("speed", event.target.value)} />
                    </label>
                    <label>
                      <span>Darkness</span>
                      <input value={qrLabelForm.darkness} onChange={(event) => updateQrLabelField("darkness", event.target.value)} />
                    </label>
                    <label>
                      <span>Copies</span>
                      <input type="number" min="1" max="20" value={qrLabelForm.copies} onChange={(event) => updateQrLabelField("copies", event.target.value)} />
                    </label>
                  </div>
                </div>

                {qrLabelStatus.error && (
                  <div className="live-device-settings-message error">
                    <AlertTriangle size={16} />
                    <span>{qrLabelStatus.error}</span>
                  </div>
                )}
                {qrLabelStatus.notice && (
                  <div className="live-device-settings-message success">
                    <CheckCircle2 size={16} />
                    <span>{qrLabelStatus.notice}</span>
                  </div>
                )}

                <div className="press-qr-label-list">
                  {presses.map((press) => {
                    const printing = qrLabelStatus.printingKey === press.key;
                    const dashboardUrl = typeof window !== "undefined" ? `${window.location.origin}/?pressDashboard=${press.key}` : `?pressDashboard=${press.key}`;
                    return (
                      <article key={press.key}>
                        <div>
                          <span>{press.key}</span>
                          <strong>{press.name}</strong>
                          <em>{dashboardUrl}</em>
                        </div>
                        <div className="press-qr-label-actions">
                          <a href={dashboardUrl} target="_blank" rel="noreferrer">
                            <QrCode size={16} /> Open Link
                          </a>
                          <button type="button" onClick={() => printDashboardQrLabel(press)} disabled={Boolean(qrLabelStatus.printingKey)}>
                            {printing ? <Activity className="live-device-settings-spin" size={16} /> : <Printer size={16} />}
                            {printing ? "Queueing..." : "Print QR"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
