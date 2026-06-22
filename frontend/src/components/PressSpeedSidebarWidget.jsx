import { useEffect, useMemo, useRef, useState } from "react";
import { Gauge, RefreshCcw } from "lucide-react";

const firebaseBase = "https://realtime2-94ff8-default-rtdb.firebaseio.com";
const maxValidSpeedFpm = 700;
const refreshMs = 180000;
const cacheMaxAgeMs = 120000;
const cacheKey = "tsm_sidebar_press_speeds_v1";

const presses = [
  { key: "18AZT", name: "18 Aztech", speedNode: "/18Aztech_CURRENT_SPEED", color: "#c600e0" },
  { key: "ETI", name: "ETI", speedNode: "/ETI_CURRENT_SPEED", color: "#16a34a" },
  { key: "SLIT", name: "Slitter", speedNode: "/SLITTER_CURRENT_SPEED", color: "#ef4444" },
  { key: "13NIL", name: "13 Nilpeter", speedNode: "/13Nilpeter_CURRENT_SPEED", color: "#2563eb" },
  { key: "17NIL", name: "17 Nilpeter", speedNode: "/17Nilpeter_CURRENT_SPEED", color: "#eab308" },
  { key: "13AZT", name: "13 Aztech", speedNode: "/13Aztech_CURRENT_SPEED", color: "#f97316" },
];

function speedUrl(node) {
  return `${firebaseBase}${node}.json`;
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

function timeLabel(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function toneForSpeed(speed) {
  if (speed <= 0) return "idle";
  if (speed < 70) return "slow";
  if (speed >= 300) return "running";
  return "steady";
}

export default function PressSpeedSidebarWidget({ onOpenLiveFootage }) {
  const cached = useMemo(readCache, []);
  const [speeds, setSpeeds] = useState(() => cached?.speeds || presses.map((press) => ({ key: press.key, speed: 0 })));
  const [updatedAt, setUpdatedAt] = useState(() => cached?.updatedAt || "");
  const [state, setState] = useState(() => cached ? "ready" : "loading");
  const [error, setError] = useState("");
  const loadingRef = useRef(false);

  const rows = useMemo(() => {
    const byKey = new Map(speeds.map((row) => [row.key, row.speed]));
    return presses.map((press) => ({
      ...press,
      speed: Number(byKey.get(press.key) || 0),
    }));
  }, [speeds]);

  async function loadSpeeds({ force = false } = {}) {
    if (loadingRef.current) return;
    if (!force && typeof document !== "undefined" && document.visibilityState === "hidden") return;

    const cache = readCache();
    const now = Date.now();
    if (!force && cache && now - Number(cache.updatedAt || 0) < cacheMaxAgeMs) {
      setSpeeds(cache.speeds);
      setUpdatedAt(cache.updatedAt);
      setState("ready");
      return;
    }

    loadingRef.current = true;
    setState((current) => current === "ready" ? "refreshing" : "loading");
    try {
      const results = await Promise.all(
        presses.map((press) =>
          fetch(speedUrl(press.speedNode), { cache: "no-store" })
            .then((response) => response.ok ? response.json() : null)
            .then((payload) => ({ key: press.key, speed: extractSpeed(payload) }))
            .catch(() => ({ key: press.key, speed: 0 }))
        )
      );
      const payload = { speeds: results, updatedAt: Date.now() };
      saveCache(payload);
      setSpeeds(results);
      setUpdatedAt(payload.updatedAt);
      setError("");
      setState("ready");
    } catch (loadError) {
      setError(loadError.message || "Speed data unavailable");
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
      aria-label={onOpenLiveFootage ? "Open Live Footage current press speeds" : "Current press speeds"}
      onClick={openLiveFootage}
      onKeyDown={handleWidgetKeyDown}
    >
      <header>
        <div>
          <span><Gauge size={14} /> Press Speeds</span>
          <em>{error || (updatedAt ? `Updated ${timeLabel(updatedAt)}` : "Loading current speeds")}</em>
        </div>
        <button type="button" onClick={refreshSpeeds} disabled={state === "loading" || state === "refreshing"} title="Refresh press speeds">
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
              <span>{Math.round(press.speed).toLocaleString()} FPM</span>
              <b><small style={{ width: `${percent}%`, background: press.color }} /></b>
            </div>
          );
        })}
      </div>
    </section>
  );
}
