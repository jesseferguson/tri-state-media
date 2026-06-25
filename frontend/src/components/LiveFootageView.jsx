import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Gauge, Goal, Maximize2, Minimize2, Timer } from "lucide-react";
import { requestApi } from "../api";

const firebaseBase = "https://realtime2-94ff8-default-rtdb.firebaseio.com";
const goalFootage = 400000;
const wasteBufferPercent = 0.04;
const refreshMs = 30000;
const dailyRefreshMs = 120000;
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

const presses = [
  { key: "18AZT", name: "18 Aztech", dailyNode: "/18Aztech_SPEED", speedNode: "/18Aztech_CURRENT_SPEED" },
  { key: "ETI", name: "ETI", dailyNode: "/ETI_SPEED", speedNode: "/ETI_CURRENT_SPEED" },
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
    .map((value) => ({ ts: Number(value.timestamp) || 0, footage: Number(value.footage) || 0 }))
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
  const padX = 10;
  ctx.font = "700 13px ui-sans-serif, system-ui";
  const width = ctx.measureText(text).width + padX * 2 + 12;
  const clampedX = Math.min(canvas.width - width - 8, Math.max(8, x));
  const clampedY = Math.min(canvas.height - 20, Math.max(14, y));

  ctx.save();
  ctx.fillStyle = "rgba(255,255,255,.92)";
  roundRect(ctx, clampedX, clampedY - 13, width, 26, 8);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,.12)";
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(clampedX + 12, clampedY, 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#0f172a";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, clampedX + 22, clampedY);
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
    ctx.font = `${12 * dpr}px ui-sans-serif, system-ui`;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatInt(value), padL - 10 * dpr, y);
  }

  const labelStep = Math.max(1, Math.floor(labels.length / 8));
  labels.forEach((label, index) => {
    if (index % labelStep !== 0) return;
    const x = padL + plotW * (index / Math.max(1, labels.length - 1));
    ctx.fillStyle = "#64748b";
    ctx.font = `${12 * dpr}px ui-sans-serif, system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(label, x, padT + plotH + 12 * dpr);
  });

  seriesList.forEach((series) => {
    ctx.strokeStyle = series.color;
    ctx.lineWidth = 2.6 * dpr;
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
    ctx.arc(lastX, lastY, 3.2 * dpr, 0, Math.PI * 2);
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

export default function LiveFootageView({ tvMode = false, onTvModeChange = () => {} }) {
  const canvasRef = useRef(null);
  const dailyCacheRef = useRef(null);
  const lastDailyFetchRef = useRef(0);
  const mountedRef = useRef(false);
  const activeControllerRef = useRef(null);
  const refreshRef = useRef(null);
  const chartDrawnRef = useRef(false);
  const savedArchiveIdsRef = useRef(new Set());
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
    paceText: "",
    tiles: presses.map((press, index) => ({ ...press, color: pressColor(index), speed: 0, total: 0 })),
  });

  const sortedTiles = useMemo(() => [...snapshot.tiles].sort((a, b) => b.total - a.total), [snapshot.tiles]);
  const goalHit = snapshot.adjustedFootage >= goalFootage;
  const wasteBufferPercentLabel = `${Math.round(wasteBufferPercent * 100)}%`;
  const countedProgressPercent = Math.max(0, Math.min(100, snapshot.percent));
  const wasteProgressPercent = Math.max(0, Math.min(100 - countedProgressPercent, (snapshot.currentWasteFootage / goalFootage) * 100));

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

        const companyTotal = dailyData?.companyTotal ?? 0;
        const adjustedFootage = wasteAdjustedFootage(companyTotal);
        const currentWasteFootage = Math.max(0, companyTotal - adjustedFootage);
        const remaining = Math.max(0, goalFootage - adjustedFootage);
        const percent = Math.max(0, Math.min(100, (adjustedFootage / goalFootage) * 100));
        const elapsedHours = Math.max(0.1, (effectiveNow.getTime() - start.getTime()) / 3600000);
        const shiftHours = (end.getTime() - start.getTime()) / 3600000;
        const pacePerHour = adjustedFootage / elapsedHours;
        const projected = pacePerHour * shiftHours;

        setSnapshot((current) => ({
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
          paceText: `Elapsed ${elapsedHours.toFixed(1)}h / ${shiftHours.toFixed(1)}h - pace ${formatInt(pacePerHour)}/hr - projected ${formatInt(projected)}`,
          tiles: presses.map((press, index) => ({
            ...press,
            color: pressColor(index),
            speed: extractSpeed(speedResults[index]),
            total: dailyData?.totalsByKey?.[press.key] ?? 0,
          })),
        }));
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

  return (
    <section className="live-footage-view">
      <div className="live-footage-hero">
        <div>
          <p className="eyebrow">Realtime Press Footage</p>
          <h2>Companywide Footage Race</h2>
          <span>{snapshot.rangeText || "Loading shift window..."}</span>
        </div>
        <div className="live-footage-hero-actions">
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
        <Metric icon={goalHit ? CheckCircle2 : Gauge} label="Total Footage" value={formatInt(snapshot.adjustedFootage)} note={goalHit ? "Shift goal reached" : snapshot.paceText || "Waiting for Firebase data"} tone={goalHit ? "hit" : ""} />
        <Metric icon={Goal} label="Shift Goal" value={formatInt(goalFootage)} note={`After ${wasteBufferPercentLabel} waste`} tone={goalHit ? "hit" : ""} />
        <Metric icon={Timer} label="Remaining" value={formatInt(snapshot.remaining)} note="To hit the shift goal" />
      </div>

      <div className={`live-footage-progress ${goalHit ? "goal-hit" : ""}`}>
        <div className="live-footage-progress-track">
          <span className="live-footage-progress-counted" style={{ width: `${countedProgressPercent}%` }} />
          <span className="live-footage-progress-waste" style={{ left: `${countedProgressPercent}%`, width: `${wasteProgressPercent}%` }} />
        </div>
        <p>
          {goalHit ? "Goal hit" : `${snapshot.percent.toFixed(1)}% to goal`}
          <em>{wasteBufferPercentLabel} waste: {formatInt(snapshot.currentWasteFootage)} ft held / Updated {snapshot.updatedAt || "--"}{snapshot.archiveStatus ? ` - ${snapshot.archiveStatus}` : ""}</em>
        </p>
      </div>

      {goalHit && (
        <div className="live-footage-goal-hit">
          <CheckCircle2 size={22} />
          <div>
            <strong>Shift goal hit</strong>
            <span>{formatInt(snapshot.adjustedFootage)} ft total against a {formatInt(goalFootage)} ft goal. {wasteBufferPercentLabel} waste currently held: {formatInt(snapshot.currentWasteFootage)} ft.</span>
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
                  <strong>{formatInt(tile.total)} <small>ft</small></strong>
                  <em>{formatInt(tile.speed)} FPM</em>
                </div>
              </div>
            ))}
          </div>
          <p className="live-footage-note">Speeds and daily rows over {maxValidSpeedFpm} FPM are ignored. The browser saves the finished shift locally once it reaches 2:59 AM.</p>
        </article>
      </div>
    </section>
  );
}
