import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, RefreshCcw } from "lucide-react";
import AnimatedNumber from "./AnimatedNumber";

const firebaseBase = "https://realtime2-94ff8-default-rtdb.firebaseio.com";
const maxValidSpeedFpm = 700;
const refreshMs = 180000;
const sidebarFootageAnimationMs = Math.max(30000, refreshMs - 5000);
const cacheMaxAgeMs = 120000;
const cacheKey = "tsm_sidebar_press_speeds_v1";
const dailyLimit = 420;
const dailyFootageFuzzFt = 5;
const minDtSeconds = 60;
const shiftStartHour = 5;
const shiftStartMinute = 0;
const shiftEndHour = 2;
const shiftEndMinute = 20;

const presses = [
  { key: "18AZT", name: "18 Aztech", speedNode: "/18Aztech_CURRENT_SPEED", dailyNode: "/18Aztech_SPEED", color: "#c600e0" },
  { key: "ETI", name: "ETI", speedNode: "/ETI_CURRENT_SPEED", dailyNode: "/ETI_SPEED", color: "#16a34a" },
  { key: "SLIT", name: "Slitter", speedNode: "/SLITTER_CURRENT_SPEED", dailyNode: "/SLITTER_SPEED", color: "#ef4444" },
  { key: "13NIL", name: "13 Nilpeter", speedNode: "/13Nilpeter_CURRENT_SPEED", dailyNode: "/13Nilpeter_SPEED", color: "#2563eb" },
  { key: "17NIL", name: "17 Nilpeter", speedNode: "/17Nilpeter_CURRENT_SPEED", dailyNode: "/17Nilpeter_SPEED", color: "#eab308" },
  { key: "13AZT", name: "13 Aztech", speedNode: "/13Aztech_CURRENT_SPEED", dailyNode: "/13Aztech_DAILY_SPEED", color: "#f97316" },
];

function pad2(value) {
  return String(value).padStart(2, "0");
}

function formatLocalDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function speedUrl(node) {
  return `${firebaseBase}${node}.json`;
}

function dailyUrl(node) {
  return `${firebaseBase}${node}.json?orderBy="$key"&limitToLast=${dailyLimit}`;
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

function extractSpeed(payload) {
  let speed = 0;
  if (typeof payload === "number") speed = payload;
  else if (payload && typeof payload === "object") {
    speed = Number(payload.currentSpeed ?? payload.speed ?? 0) || 0;
  }
  if (!Number.isFinite(speed) || speed < 0 || speed > maxValidSpeedFpm) return 0;
  return speed;
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

function dailyFootageTotal(payload, start, end) {
  return filterDailyRows(normalizeDailyList(payload), start, end)
    .reduce((sum, row) => sum + row.footage, 0);
}

function readCache() {
  if (typeof window === "undefined" || !window.localStorage) return null;
  try {
    const payload = JSON.parse(window.localStorage.getItem(cacheKey) || "null");
    if (!payload?.updatedAt || !Array.isArray(payload.speeds)) return null;
    return payload;
  } catch {
    return null;
  }
}

function saveCache(payload) {
  if (typeof window === "undefined" || !window.localStorage) return;
  window.localStorage.setItem(cacheKey, JSON.stringify(payload));
}

function toneForSpeed(speed) {
  if (speed <= 0) return "idle";
  if (speed < 70) return "slow";
  if (speed >= 300) return "running";
  return "steady";
}

function mergePressFootage(previousRows = [], nextRows = [], sameShift = true) {
  const previousByKey = new Map(previousRows.map((row) => [row.key, Number(row.total || 0)]));
  return nextRows.map((row) => ({
    ...row,
    total: sameShift ? Math.max(Number(previousByKey.get(row.key) || 0), Number(row.total || 0)) : Number(row.total || 0),
  }));
}

export default function PressSpeedSidebarWidget({ onOpenLiveFootage }) {
  const cached = useMemo(readCache, []);
  const [speeds, setSpeeds] = useState(() => cached?.speeds || presses.map((press) => ({ key: press.key, speed: 0 })));
  const [pressFootage, setPressFootage] = useState(() => cached?.pressFootage || presses.map((press) => ({ key: press.key, total: 0 })));
  const [totalFootage, setTotalFootage] = useState(() => Number(cached?.totalFootage || 0));
  const [shiftDate, setShiftDate] = useState(() => cached?.shiftDate || "");
  const [state, setState] = useState(() => cached ? "ready" : "loading");
  const loadingRef = useRef(false);
  const pressFootageRef = useRef(pressFootage);
  const shiftDateRef = useRef(shiftDate);

  useEffect(() => {
    pressFootageRef.current = pressFootage;
  }, [pressFootage]);

  useEffect(() => {
    shiftDateRef.current = shiftDate;
  }, [shiftDate]);

  const rows = useMemo(() => {
    const byKey = new Map(speeds.map((row) => [row.key, row.speed]));
    const footageByKey = new Map(pressFootage.map((row) => [row.key, row.total]));
    return presses.map((press) => ({
      ...press,
      speed: Number(byKey.get(press.key) || 0),
      total: Number(footageByKey.get(press.key) || 0),
    }));
  }, [pressFootage, speeds]);
  const animatedTotalFootage = useMemo(() => rows.reduce((sum, row) => sum + Number(row.total || 0), 0), [rows]);

  async function loadSpeeds({ force = false } = {}) {
    if (loadingRef.current) return;
    if (!force && typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const now = Date.now();
    const { start, end } = getShiftWindow();
    const currentShiftDate = formatLocalDateKey(start);
    const cache = readCache();
    if (!force && cache && cache.shiftDate === currentShiftDate && Number.isFinite(Number(cache.totalFootage)) && now - Number(cache.updatedAt || 0) < cacheMaxAgeMs) {
      setSpeeds(cache.speeds);
      setPressFootage(cache.pressFootage || presses.map((press) => ({ key: press.key, total: 0 })));
      setTotalFootage(Number(cache.totalFootage || 0));
      setShiftDate(currentShiftDate);
      setState("ready");
      return;
    }

    loadingRef.current = true;
    setState((current) => current === "ready" ? "refreshing" : "loading");
    try {
      const [speedResults, dailyResults] = await Promise.all([
        Promise.all(
          presses.map((press) =>
            fetch(speedUrl(press.speedNode), { cache: "no-store" })
              .then((response) => response.ok ? response.json() : null)
              .then((payload) => ({ key: press.key, speed: extractSpeed(payload) }))
              .catch(() => ({ key: press.key, speed: 0 }))
          )
        ),
        Promise.all(
          presses.map((press) =>
            fetch(dailyUrl(press.dailyNode), { cache: "no-store" })
              .then((response) => response.ok ? response.json() : null)
              .then((payload) => ({ key: press.key, total: dailyFootageTotal(payload, start, end) }))
              .catch(() => ({ key: press.key, total: 0 }))
          )
        ),
      ]);
      const mergedFootage = mergePressFootage(pressFootageRef.current, dailyResults, shiftDateRef.current === currentShiftDate);
      const payload = {
        speeds: speedResults,
        pressFootage: mergedFootage,
        totalFootage: mergedFootage.reduce((sum, press) => sum + press.total, 0),
        shiftDate: currentShiftDate,
        updatedAt: Date.now(),
      };
      saveCache(payload);
      setSpeeds(speedResults);
      setPressFootage(mergedFootage);
      setTotalFootage(payload.totalFootage);
      setShiftDate(currentShiftDate);
      setState("ready");
    } catch {
      setState("ready");
    } finally {
      loadingRef.current = false;
    }
  }

  useEffect(() => {
    loadSpeeds();
    const intervalId = window.setInterval(() => loadSpeeds(), refreshMs);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") loadSpeeds();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, []);

  function openLiveFootage() {
    if (typeof onOpenLiveFootage === "function") onOpenLiveFootage();
  }

  function handleWidgetKeyDown(event) {
    if (event.target?.closest?.("button")) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    openLiveFootage();
  }

  function refreshSpeeds(event) {
    event.stopPropagation();
    loadSpeeds({ force: true });
  }

  return (
    <section
      className={`press-speed-widget ${onOpenLiveFootage ? "clickable" : ""}`}
      role={onOpenLiveFootage ? "button" : undefined}
      tabIndex={onOpenLiveFootage ? 0 : undefined}
      aria-label={onOpenLiveFootage ? "Open Live Footage current press speeds and total footage" : "Current press speeds and total footage"}
      onClick={openLiveFootage}
      onKeyDown={handleWidgetKeyDown}
    >
      <header>
        <div>
          <span><Gauge size={14} /> Total Footage</span>
          <strong>
            {state === "loading" && !totalFootage
              ? "Loading"
              : <AnimatedNumber value={animatedTotalFootage} suffix="ft" className="press-speed-total-counter" durationMs={sidebarFootageAnimationMs} initialDurationMs={1200} easing="linear" />}
          </strong>
        </div>
        <button type="button" onClick={refreshSpeeds} disabled={state === "loading" || state === "refreshing"} title="Refresh press speeds and footage">
          <RefreshCcw size={13} />
        </button>
      </header>
      <div className="press-speed-list">
        {rows.map((press) => {
          const percent = Math.max(0, Math.min(100, (press.speed / maxValidSpeedFpm) * 100));
          return (
            <div className={`press-speed-row ${toneForSpeed(press.speed)}`} key={press.key}>
              <i style={{ background: press.color }} />
              <strong>{press.name}</strong>
              <span className="press-speed-row-metrics">
                <em>{Math.round(press.speed).toLocaleString()} FPM</em>
                <AnimatedNumber value={press.total} suffix="ft" className="press-speed-row-counter" durationMs={sidebarFootageAnimationMs} initialDurationMs={1200} easing="linear" />
              </span>
              <b><small style={{ width: `${percent}%`, background: press.color }} /></b>
            </div>
          );
        })}
      </div>
    </section>
  );
}
