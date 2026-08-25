import { useEffect, useRef, useState } from "react";

function numberValue(value) {
  const next = Number(value);
  return Number.isFinite(next) ? next : 0;
}

function easeOut(value) {
  return 1 - Math.pow(1 - value, 3);
}

function easingValue(value, mode) {
  if (mode === "linear") return value;
  return easeOut(value);
}

function formatNumber(value, decimals = 0) {
  return Number(value).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export default function AnimatedNumber({
  value,
  suffix = "",
  className = "",
  decimals = 0,
  durationMs = 950,
  initialDurationMs = 950,
  easing = "easeOut",
  ariaLabel = "",
}) {
  const initial = numberValue(value);
  const [displayValue, setDisplayValue] = useState(initial);
  const displayRef = useRef(initial);
  const frameRef = useRef(null);
  const initialCatchupDoneRef = useRef(false);

  useEffect(() => {
    const target = numberValue(value);
    const from = displayRef.current;
    const activeDurationMs = initialCatchupDoneRef.current ? durationMs : initialDurationMs;

    if (frameRef.current) cancelAnimationFrame(frameRef.current);

    if (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches) {
      displayRef.current = target;
      setDisplayValue(target);
      return undefined;
    }

    if (Math.abs(target - from) < 0.001 || activeDurationMs <= 0) {
      displayRef.current = target;
      setDisplayValue(target);
      if (target > 0 || activeDurationMs <= 0) initialCatchupDoneRef.current = true;
      return undefined;
    }

    const startedAt = performance.now();
    const step = (now) => {
      const progress = Math.min(1, (now - startedAt) / activeDurationMs);
      const next = from + (target - from) * easingValue(progress, easing);
      displayRef.current = next;
      setDisplayValue(next);
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(step);
      } else if (!initialCatchupDoneRef.current) {
        initialCatchupDoneRef.current = true;
      }
    };

    frameRef.current = requestAnimationFrame(step);
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
    };
  }, [decimals, durationMs, initialDurationMs, easing, value]);

  const formatted = formatNumber(displayValue, decimals);

  return (
    <span className={`animated-number ${className}`.trim()} aria-label={ariaLabel || `${formatted}${suffix ? ` ${suffix.trim()}` : ""}`}>
      <span className="animated-number-value">{formatted}</span>
      {suffix && <span className="animated-number-suffix">{suffix}</span>}
    </span>
  );
}
