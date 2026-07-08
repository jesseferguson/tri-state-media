import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, Clock3, Gauge, Goal, Moon, QrCode, RefreshCcw, Sun, Timer, TrendingUp, Zap } from "lucide-react";
import AnimatedNumber from "./AnimatedNumber";

const firebaseBase = "https://realtime2-94ff8-default-rtdb.firebaseio.com";
const dailyLimit = 520;
const maxValidSpeedFpm = 700;
const minDtSeconds = 60;
const companyGoalFootage = 400000;
const shiftStartHour = 5;
const shiftStartMinute = 0;
const shiftEndHour = 2;
const shiftEndMinute = 59;
const runningThresholdFpm = 10;
const strongRunThresholdFpm = 80;
const dashboardRefreshMs = 30000;

export const pressDashboardPresses = [
  { key: "18AZT", name: "18 Aztech", dailyNode: "/18Aztech_SPEED", speedNode: "/18Aztech_CURRENT_SPEED" },
  { key: "ETI", name: "ETI", dailyNode: "/ETI_SPEED", speedNode: "/ETI_CURRENT_SPEED" },
  { key: "SLIT", name: "Slitter", dailyNode: "/SLITTER_SPEED", speedNode: "/SLITTER_CURRENT_SPEED" },
  { key: "13NIL", name: "13 Nilpeter", dailyNode: "/13Nilpeter_SPEED", speedNode: "/13Nilpeter_CURRENT_SPEED" },
  { key: "17NIL", name: "17 Nilpeter", dailyNode: "/17Nilpeter_SPEED", speedNode: "/17Nilpeter_CURRENT_SPEED" },
  { key: "13AZT", name: "13 Aztech", dailyNode: "/13Aztech_DAILY_SPEED", speedNode: "/13Aztech_CURRENT_SPEED" },
];

function formatInt(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return Math.round(number).toLocaleString();
}

function formatOne(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "--";
  return number.toLocaleString(undefined, { maximumFractionDigits: 1 });
}

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatTime(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(minutes) {
  const safe = Math.max(0, Math.round(Number(minutes) || 0));
  if (safe < 60) return `${safe}m`;
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return mins ? `${hours}h ${mins}m` : `${hours}h`;
}

function formatHourLabel(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "--";
  return date.toLocaleTimeString([], { hour: "numeric" }).replace(" ", "");
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
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

function getShiftSchedule(now = new Date()) {
  const { start: shiftStart } = getShiftWindow(now);
  const firstStart = new Date(shiftStart);
  firstStart.setHours(6, 0, 0, 0);
  const firstEnd = new Date(shiftStart);
  firstEnd.setHours(16, 30, 0, 0);
  const secondStart = new Date(shiftStart);
  secondStart.setHours(12, 0, 0, 0);
  const secondEnd = new Date(shiftStart);
  secondEnd.setHours(22, 30, 0, 0);
  const overlapStart = new Date(secondStart);
  const overlapEnd = new Date(firstEnd);
  const time = now.getTime();
  return {
    firstStart,
    firstEnd,
    secondStart,
    secondEnd,
    overlapStart,
    overlapEnd,
    firstActive: time >= firstStart.getTime() && time <= firstEnd.getTime(),
    secondActive: time >= secondStart.getTime() && time <= secondEnd.getTime(),
    overlapActive: time >= overlapStart.getTime() && time <= overlapEnd.getTime(),
  };
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
    const maxPossibleFt = maxValidSpeedFpm * (dtSec / 60) + 5;
    if (row.footage > maxPossibleFt) return;
    kept.push(row);
    prevTs = row.ts;
  });

  return kept;
}

function extractSpeed(payload) {
  let speed = 0;
  if (typeof payload === "number") speed = payload;
  else if (payload && typeof payload === "object") {
    speed = Number(payload.currentSpeed ?? payload.speed ?? payload.fpm ?? 0) || 0;
  }
  if (!Number.isFinite(speed) || speed < 0 || speed > maxValidSpeedFpm) return 0;
  return speed;
}

function extractUpdatedAt(payload) {
  if (!payload || typeof payload !== "object") return "";
  const raw = payload.updatedAt ?? payload.updated_at ?? payload.timestamp ?? payload.lastUpdated ?? "";
  if (!raw) return "";
  const date = new Date(Number(raw) > 100000000000 ? Number(raw) : Number(raw) * 1000);
  if (Number.isNaN(date.getTime())) return String(raw);
  return formatTime(date);
}

function normalizeDeviceStatus(payload) {
  if (!payload || typeof payload !== "object") {
    return {
      hasData: false,
      stale: true,
      message: "",
      checkedInText: "",
      ageMinutes: null,
    };
  }
  const device = payload.device && typeof payload.device === "object" ? payload.device : {};
  const rawTimestamp = Number(payload.timestamp ?? 0);
  const timestampSeconds = rawTimestamp > 100000000000 ? rawTimestamp / 1000 : rawTimestamp;
  const timestampMs = timestampSeconds > 0 ? timestampSeconds * 1000 : 0;
  const ageMs = timestampMs > 0 ? Date.now() - timestampMs : Infinity;
  const stale = !Number.isFinite(ageMs) || ageMs > 5 * 60 * 1000;
  const lastHttp = Number(device.lastHttp ?? 0);
  const lastMessage = String(device.lastMessage || "").trim();
  const senderAgeSec = Number(device.senderAgeSec ?? 0);
  const senderStale = Number.isFinite(senderAgeSec) && senderAgeSec > 120;
  const wifiDown = device.wifi === false;
  let message = "";
  if (stale) {
    message = timestampMs > 0
      ? `ETI has not checked in for ${Math.max(1, Math.round(ageMs / 60000))} min. The wheel may still be counting locally.`
      : "ETI has not checked in yet.";
  } else if (wifiDown) {
    message = "ETI is counting, but WiFi is disconnected.";
  } else if (senderStale) {
    message = "ETI sender is restarting because Firebase stopped responding.";
  } else if (lastHttp && (lastHttp < 200 || lastHttp >= 300)) {
    message = lastMessage ? `Last Firebase send problem: ${lastMessage}.` : `Last Firebase send problem: HTTP ${lastHttp}.`;
  }
  return {
    hasData: true,
    stale,
    wifiDown,
    senderStale,
    lastHttp,
    lastMessage,
    message,
    checkedInText: timestampMs > 0 ? formatTime(new Date(timestampMs)) : "",
    ageMinutes: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 60000)) : null,
    senderRestarts: Number(device.senderRestarts || 0),
    bufferedDaily: Number(device.bufferedDaily || 0),
    heap: Number(device.heap || 0),
  };
}

function buildBuckets(rows, start, effectiveNow, minutesPerBucket) {
  const buckets = [];
  let cursor = new Date(start);
  while (cursor.getTime() < effectiveNow.getTime()) {
    const bucketStart = new Date(cursor);
    const bucketEnd = new Date(Math.min(addMinutes(bucketStart, minutesPerBucket).getTime(), effectiveNow.getTime()));
    const total = rows.reduce((sum, row) => {
      const rowMs = row.ts * 1000;
      if (rowMs >= bucketStart.getTime() && rowMs < bucketEnd.getTime()) return sum + row.footage;
      return sum;
    }, 0);
    const duration = Math.max(1, (bucketEnd.getTime() - bucketStart.getTime()) / 60000);
    const avgFpm = total / duration;
    buckets.push({
      start: bucketStart,
      end: bucketEnd,
      total,
      avgFpm,
      status: total <= 0 ? "down" : avgFpm >= strongRunThresholdFpm ? "run" : "slow",
    });
    cursor = bucketEnd;
  }
  return buckets;
}

function computeMetrics(rows, currentSpeed, now = new Date()) {
  const { start, end } = getShiftWindow(now);
  const effectiveNow = new Date(Math.min(now.getTime(), end.getTime()));
  const elapsedMinutes = Math.max(1, (effectiveNow.getTime() - start.getTime()) / 60000);
  const totalFootage = rows.reduce((sum, row) => sum + Number(row.footage || 0), 0);
  const timeline = buildBuckets(rows, start, effectiveNow, 15);
  const hourly = buildBuckets(rows, start, effectiveNow, 60);
  const runtimeMinutes = timeline.reduce((sum, bucket) => {
    if (bucket.status === "down") return sum;
    return sum + Math.max(0, (bucket.end.getTime() - bucket.start.getTime()) / 60000);
  }, 0);
  const downtimeMinutes = Math.max(0, elapsedMinutes - runtimeMinutes);
  const lastFootageRow = [...rows].reverse().find((row) => Number(row.footage) > 0);
  const lastFootageAt = lastFootageRow ? new Date(lastFootageRow.ts * 1000) : null;
  const minutesSinceFootage = lastFootageAt ? Math.max(0, (now.getTime() - lastFootageAt.getTime()) / 60000) : elapsedMinutes;
  const averageFpm = totalFootage / elapsedMinutes;
  const runningAverageFpm = runtimeMinutes > 0 ? totalFootage / runtimeMinutes : 0;
  const uptimePercent = Math.max(0, Math.min(100, (runtimeMinutes / elapsedMinutes) * 100));
  const lastHourFootage = rows.reduce((sum, row) => {
    if ((now.getTime() - row.ts * 1000) <= 60 * 60000) return sum + row.footage;
    return sum;
  }, 0);
  const lastThirtyFootage = rows.reduce((sum, row) => {
    if ((now.getTime() - row.ts * 1000) <= 30 * 60000) return sum + row.footage;
    return sum;
  }, 0);
  const status = currentSpeed >= strongRunThresholdFpm
    ? "running"
    : currentSpeed >= runningThresholdFpm
      ? "slow"
      : "down";

  return {
    start,
    end,
    effectiveNow,
    totalFootage,
    elapsedMinutes,
    runtimeMinutes,
    downtimeMinutes,
    minutesSinceFootage,
    averageFpm,
    runningAverageFpm,
    uptimePercent,
    lastHourFootage,
    lastThirtyFootage,
    lastFootageAt,
    timeline,
    hourly,
    status,
  };
}

function statusLabel(status) {
  if (status === "running") return "Running";
  if (status === "slow") return "Slow roll";
  return "Stopped";
}

function statusHelp(status, metrics) {
  if (status === "running") return `Runtime is active. Average while moving is ${formatInt(metrics.runningAverageFpm)} FPM.`;
  if (status === "slow") return "Moving, but below the strong runtime target.";
  return metrics.lastFootageAt
    ? `No footage added for ${formatDuration(metrics.minutesSinceFootage)}.`
    : "Waiting for the first footage reading this shift.";
}

function PressFootageMix({ totals = [], currentKey = "" }) {
  const totalFootage = totals.reduce((sum, item) => sum + Number(item.total || 0), 0);
  const current = totals.find((item) => item.key === currentKey) || totals[0] || { name: "This press", total: 0 };
  const others = totals.filter((item) => item.key !== currentKey);

  return (
    <section className="pod-panel pod-press-mix-panel">
      <header>
        <div>
          <span><Activity size={15} /> Press Footage</span>
          <strong>Your press is highlighted</strong>
        </div>
        <em>Other presses are shown for shop context.</em>
      </header>
      <div className="pod-current-press-total">
        <span>{current.name}</span>
        <strong>{formatInt(current.total)} ft</strong>
        <em>Current press footage</em>
      </div>
      <div className="pod-press-mix-bar" aria-label="Footage by press">
        {totals.map((item) => {
          const width = totalFootage > 0 ? Math.max(4, (Number(item.total || 0) / totalFootage) * 100) : (100 / Math.max(1, totals.length));
          return (
            <span
              className={item.key === currentKey ? "active" : ""}
              style={{ width: `${width}%` }}
              title={`${item.name}: ${formatInt(item.total)} ft`}
              key={item.key}
            />
          );
        })}
      </div>
      <div className="pod-press-mix-list">
        <article className="active">
          <span>{current.name}</span>
          <strong>{formatInt(current.total)} ft</strong>
        </article>
        {others.map((item) => (
          <article key={item.key}>
            <span>{item.name}</span>
            <strong>{formatInt(item.total)} ft</strong>
          </article>
        ))}
      </div>
    </section>
  );
}

function HourlyLineChart({ buckets = [], targetHourlyFootage = 0 }) {
  const visibleBuckets = buckets.slice(-12);
  const width = 360;
  const height = 190;
  const padX = 28;
  const padTop = 18;
  const padBottom = 42;
  const chartWidth = width - padX * 2;
  const chartHeight = height - padTop - padBottom;
  const values = visibleBuckets.map((bucket) => Number(bucket.total || 0));
  const maxValue = Math.max(100, targetHourlyFootage, ...values) * 1.16;
  const pointFor = (value, index) => {
    const x = padX + (chartWidth * index) / Math.max(1, visibleBuckets.length - 1);
    const y = padTop + chartHeight * (1 - Math.max(0, value) / maxValue);
    return { x, y };
  };
  const points = values.map(pointFor);
  const linePoints = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
  const areaPoints = points.length
    ? `${padX},${height - padBottom} ${linePoints} ${padX + chartWidth},${height - padBottom}`
    : "";
  const targetY = padTop + chartHeight * (1 - Math.max(0, targetHourlyFootage) / maxValue);
  const gridValues = [0.25, 0.5, 0.75].map((ratio) => maxValue * ratio);

  if (!visibleBuckets.length) {
    return (
      <div className="pod-line-empty">
        <Activity size={18} />
        <strong>Waiting for hourly footage</strong>
      </div>
    );
  }

  return (
    <div className="pod-line-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Hourly footage line chart">
        <defs>
          <linearGradient id="podLineFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#14b8a6" stopOpacity=".28" />
            <stop offset="100%" stopColor="#14b8a6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {gridValues.map((value) => {
          const y = padTop + chartHeight * (1 - value / maxValue);
          return (
            <g key={value}>
              <line className="pod-line-grid" x1={padX} x2={padX + chartWidth} y1={y} y2={y} />
              <text className="pod-line-axis" x={padX - 7} y={y + 4} textAnchor="end">{formatInt(value)}</text>
            </g>
          );
        })}
        <line className="pod-line-target" x1={padX} x2={padX + chartWidth} y1={targetY} y2={targetY} />
        <text className="pod-line-target-label" x={padX + chartWidth} y={Math.max(12, targetY - 7)} textAnchor="end">
          target {formatInt(targetHourlyFootage)}/hr
        </text>
        {areaPoints && <polygon className="pod-line-area" points={areaPoints} />}
        <polyline className="pod-line-stroke" points={linePoints} />
        {points.map((point, index) => (
          <g key={`${visibleBuckets[index].start.getTime()}-${index}`}>
            <circle className={values[index] >= targetHourlyFootage ? "hit" : ""} cx={point.x} cy={point.y} r="4.2" />
            <text className="pod-line-value" x={point.x} y={Math.max(12, point.y - 9)} textAnchor="middle">{formatInt(values[index])}</text>
            <text className="pod-line-label" x={point.x} y={height - 15} textAnchor="middle">{formatHourLabel(visibleBuckets[index].start)}</text>
          </g>
        ))}
      </svg>
    </div>
  );
}

function PressSelector({ onClose }) {
  return (
    <main className="press-operator-dashboard selector">
      <header className="pod-selector-header">
        <button type="button" onClick={onClose} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span><QrCode size={14} /> Press scan</span>
          <h1>Choose a press</h1>
        </div>
      </header>
      <section className="pod-press-list">
        {pressDashboardPresses.map((press) => (
          <a href={`?pressDashboard=${encodeURIComponent(press.key)}`} key={press.key}>
            <strong>{press.name}</strong>
            <span>{press.key}</span>
          </a>
        ))}
      </section>
    </main>
  );
}

export default function PressOperatorDashboard({ pressKey = "", onClose = () => {} }) {
  const controllerRef = useRef(null);
  const press = useMemo(
    () => pressDashboardPresses.find((item) => item.key.toLowerCase() === String(pressKey).toLowerCase()),
    [pressKey]
  );
  const [state, setState] = useState({
    loading: true,
    refreshing: false,
    error: "",
    rows: [],
    pressTotals: pressDashboardPresses.map((item) => ({ key: item.key, name: item.name, total: 0 })),
    speed: 0,
    deviceStatus: normalizeDeviceStatus(null),
    speedUpdatedAt: "",
    updatedAt: "",
  });

  async function loadDashboard({ quiet = false } = {}) {
    if (!press) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setState((current) => ({ ...current, loading: quiet ? current.loading : true, refreshing: quiet, error: "" }));
    const now = new Date();
    const { start, end } = getShiftWindow(now);
    try {
      const [dailyPayloads, speedPayload] = await Promise.all([
        Promise.all(pressDashboardPresses.map((item) => (
          fetchJson(dailyUrl(item.dailyNode), controller.signal).catch((error) => {
            if (error.name === "AbortError") throw error;
            return null;
          })
        ))),
        fetchJson(speedUrl(press.speedNode), controller.signal).catch(() => null),
      ]);
      let rows = [];
      const pressTotals = pressDashboardPresses.map((item, index) => {
        const itemRows = filterDailyRows(normalizeDailyList(dailyPayloads[index]), start, end);
        if (item.key === press.key) rows = itemRows;
        return {
          key: item.key,
          name: item.name,
          total: itemRows.reduce((sum, row) => sum + Number(row.footage || 0), 0),
        };
      });
      setState({
        loading: false,
        refreshing: false,
        error: "",
        rows,
        pressTotals,
        speed: extractSpeed(speedPayload),
        deviceStatus: normalizeDeviceStatus(speedPayload),
        speedUpdatedAt: extractUpdatedAt(speedPayload),
        updatedAt: formatTime(new Date()),
      });
    } catch (error) {
      if (error.name === "AbortError") return;
      setState((current) => ({
        ...current,
        loading: false,
        refreshing: false,
        error: error.message || "Could not load press dashboard.",
      }));
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
    }
  }

  useEffect(() => {
    loadDashboard();
    const intervalId = window.setInterval(() => loadDashboard({ quiet: true }), dashboardRefreshMs);
    return () => {
      controllerRef.current?.abort();
      window.clearInterval(intervalId);
    };
  }, [press?.key]);

  const metrics = useMemo(() => computeMetrics(state.rows, state.speed), [state.rows, state.speed]);
  const schedule = useMemo(() => getShiftSchedule(new Date()), [state.updatedAt]);
  const totalShiftMinutes = Math.max(1, (metrics.end.getTime() - metrics.start.getTime()) / 60000);
  const perPressTargetFpm = companyGoalFootage / pressDashboardPresses.length / totalShiftMinutes;
  const targetHourlyFootage = perPressTargetFpm * 60;
  const pressGoalFootage = companyGoalFootage / pressDashboardPresses.length;
  const projectedFootage = metrics.averageFpm * totalShiftMinutes;
  const remainingToGoal = Math.max(0, pressGoalFootage - metrics.totalFootage);
  const projectedGap = projectedFootage - pressGoalFootage;
  const currentGoalWidth = Math.min(100, Math.max(0, (metrics.totalFootage / Math.max(1, pressGoalFootage)) * 100));
  const projectedGoalWidth = Math.min(100, Math.max(0, (projectedFootage / Math.max(1, pressGoalFootage)) * 100));
  const status = metrics.status;
  const downRisk = metrics.minutesSinceFootage >= 20 ? "bad" : metrics.minutesSinceFootage >= 8 ? "warn" : "good";
  const deviceWarning = press.key === "ETI" ? (state.deviceStatus?.message || "") : "";

  if (!press) return <PressSelector onClose={onClose} />;

  return (
    <main className={`press-operator-dashboard ${status}`}>
      <header className="pod-topbar">
        <button type="button" onClick={onClose} aria-label="Back to live footage">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span><QrCode size={14} /> Scanned press dashboard</span>
          <strong>{press.name}</strong>
        </div>
        <button type="button" onClick={() => loadDashboard()} aria-label="Refresh dashboard">
          <RefreshCcw className={state.refreshing ? "spin" : ""} size={18} />
        </button>
      </header>

      {state.loading ? (
        <section className="pod-loading">
          <Activity className="spin" size={28} />
          <strong>Loading {press.name}...</strong>
          <span>Building the shift dashboard.</span>
        </section>
      ) : (
        <>
          <section className="pod-hero">
            <div className={`pod-status-pill ${status}`}>
              <i />
              <span>{statusLabel(status)}</span>
            </div>
            <div className="pod-hero-speed">
              <AnimatedNumber value={state.speed} className="pod-fpm-number" initialDurationMs={450} durationMs={900} />
              <span>FPM now</span>
            </div>
            <p>{statusHelp(status, metrics)}</p>
            <div className="pod-hero-footage">
              <small>Shift footage</small>
              <strong><AnimatedNumber value={metrics.totalFootage} suffix="ft" initialDurationMs={650} durationMs={1200} /></strong>
              <span>{formatInt(metrics.lastThirtyFootage)} ft in 30 min / {formatInt(metrics.lastHourFootage)} ft in 60 min</span>
            </div>
          </section>

          {state.error && (
            <div className="pod-alert">
              <AlertTriangle size={17} />
              <span>{state.error}</span>
            </div>
          )}

          {deviceWarning && (
            <div className={`pod-device-warning ${state.deviceStatus?.stale || state.deviceStatus?.wifiDown || state.deviceStatus?.senderStale ? "bad" : "warn"}`}>
              <AlertTriangle size={17} />
              <div>
                <strong>{state.deviceStatus?.stale ? "ETI check-in is stale" : "ETI sender notice"}</strong>
                <span>{deviceWarning}</span>
                <em>
                  {state.deviceStatus?.checkedInText ? `Last check-in ${state.deviceStatus.checkedInText}` : "No check-in time yet"}
                  {state.deviceStatus?.senderRestarts ? ` / sender restarts ${state.deviceStatus.senderRestarts}` : ""}
                  {state.deviceStatus?.bufferedDaily ? ` / buffered footage ${state.deviceStatus.bufferedDaily}` : ""}
                </em>
              </div>
            </div>
          )}

          <section className="pod-card-grid">
            <article className="pod-metric-card runtime">
              <span><Zap size={16} /> Runtime</span>
              <strong>{formatDuration(metrics.runtimeMinutes)}</strong>
              <em>Time with footage moving</em>
            </article>
            <article className={`pod-metric-card downtime ${downRisk}`}>
              <span><Timer size={16} /> Downtime</span>
              <strong>{formatDuration(metrics.downtimeMinutes)}</strong>
              <em>{metrics.lastFootageAt ? `Last footage ${formatTime(metrics.lastFootageAt)}` : "No footage yet"}</em>
            </article>
            <article className="pod-metric-card">
              <span><Gauge size={16} /> Avg Speed</span>
              <strong>{formatInt(metrics.averageFpm)} FPM</strong>
              <em>Average across the shift</em>
            </article>
            <article className="pod-metric-card">
              <span><TrendingUp size={16} /> Moving Avg</span>
              <strong>{formatInt(metrics.runningAverageFpm)} FPM</strong>
              <em>Only when footage is moving</em>
            </article>
          </section>

          <section className={`pod-forecast-card ${projectedFootage >= pressGoalFootage ? "good" : "behind"}`}>
            <div>
              <span><Goal size={16} /> Goal forecast</span>
              <strong>{formatInt(projectedFootage)} ft</strong>
              <em>{projectedGap >= 0 ? `Projected over target by ${formatInt(projectedGap)} ft` : `Projected short by ${formatInt(Math.abs(projectedGap))} ft`}</em>
            </div>
            <div className="pod-forecast-details">
              <article>
                <span>Made</span>
                <strong>{formatInt(metrics.totalFootage)} ft</strong>
              </article>
              <article>
                <span>Target</span>
                <strong>{formatInt(pressGoalFootage)} ft</strong>
              </article>
              <article>
                <span>Still needed</span>
                <strong>{formatInt(remainingToGoal)} ft</strong>
              </article>
              <div className="pod-goal-track">
                <i style={{ width: `${currentGoalWidth}%` }} />
                <b style={{ left: `${projectedGoalWidth}%` }} />
              </div>
              <small>Filled bar is made so far. Marker is projected finish.</small>
            </div>
          </section>

          <section className="pod-panel">
            <header>
              <div>
                <span><Activity size={15} /> Runtime Timeline</span>
                <strong>{formatTime(metrics.start)} - {formatTime(metrics.effectiveNow)}</strong>
              </div>
              <em>Green is moving. Red is no footage.</em>
            </header>
            <div className="pod-timeline" aria-label="Runtime timeline">
              {metrics.timeline.map((bucket) => (
                <span
                  className={bucket.status}
                  title={`${formatTime(bucket.start)} - ${formatTime(bucket.end)} / ${formatInt(bucket.total)} ft`}
                  key={`${bucket.start.getTime()}-${bucket.end.getTime()}`}
                />
              ))}
            </div>
            <div className="pod-timeline-legend">
              <span><i className="run" /> Running</span>
              <span><i className="slow" /> Slow</span>
              <span><i className="down" /> Down</span>
            </div>
          </section>

          <section className="pod-panel pod-hourly-panel">
            <header>
              <div>
                <span><Goal size={15} /> Hourly Footage</span>
                <strong>Production trend</strong>
              </div>
              <em>Red line is this press target pace.</em>
            </header>
            <HourlyLineChart buckets={metrics.hourly} targetHourlyFootage={targetHourlyFootage} />
          </section>

          <PressFootageMix totals={state.pressTotals} currentKey={press.key} />

          <section className="pod-shift-card">
            <div className="pod-shift-header">
              <Clock3 size={17} />
              <div>
                <strong>Shift Coverage</strong>
                <span>{schedule.overlapActive ? "Noon overlap is active" : "Noon overlap: 12:00 PM - 4:30 PM"}</span>
              </div>
            </div>
            <div className="pod-shift-grid">
              <article className={schedule.firstActive ? "active" : ""}>
                <Sun size={16} />
                <strong>1st Shift</strong>
                <span>6:00 AM - 4:30 PM</span>
              </article>
              <article className={schedule.secondActive ? "active" : ""}>
                <Moon size={16} />
                <strong>2nd Shift</strong>
                <span>12:00 PM - 10:30 PM</span>
              </article>
            </div>
          </section>

          <footer className="pod-footer">
            <span>Updated {state.updatedAt || "--"}</span>
            <span>{state.speedUpdatedAt ? `Speed read ${state.speedUpdatedAt}` : "Waiting for speed timestamp"}</span>
          </footer>
        </>
      )}
    </main>
  );
}
