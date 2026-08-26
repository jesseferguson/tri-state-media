const CURRENT_SCHEDULE_STATUSES = new Set(["unscheduled", "scheduled", "ready", "running", "on_hold"]);
const CLOSED_TICKET_STATUSES = new Set(["complete", "cancelled", "inactive"]);

function numeric(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function titleText(value) {
  return String(value ?? "").trim();
}

export function ticketDisplayName(ticket) {
  return titleText(ticket?.job_name) || titleText(ticket?.ticket_number) || titleText(ticket?.product_code) || "Untitled Job";
}

export function ticketCustomerName(ticket) {
  return titleText(ticket?.customer_display) || titleText(ticket?.customer_name) || "No customer";
}

export function repeatKey(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return "";
  return number.toFixed(4);
}

export function repeatLabel(value) {
  const key = repeatKey(value);
  if (!key) return "";
  const number = Number(key);
  return `${Number(number.toFixed(4)).toLocaleString()} in`;
}

export function ticketStockStats(ticket, override = {}) {
  const summaryMonthlyUsage = numeric(override.monthlyUsage ?? ticket?.recent_monthly_usage);
  const recentUsage = numeric(override.recentUsage ?? ticket?.recent_usage_90d) || summaryMonthlyUsage * 3;
  const monthlyUsage = summaryMonthlyUsage || recentUsage / 3;
  const onHand = numeric(override.onHand ?? ticket?.finished_on_hand_quantity);
  const stockGap = monthlyUsage - onHand;
  return {
    recentUsage,
    monthlyUsage,
    onHand,
    stockGap,
    needsStock: monthlyUsage > 0 && stockGap > 0.001,
  };
}

export function isCurrentScheduleRow(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  return !status || CURRENT_SCHEDULE_STATUSES.has(status);
}

export function buildScheduledRepeatMap(scheduleRows = []) {
  return (scheduleRows ?? []).reduce((map, row) => {
    if (!isCurrentScheduleRow(row)) return map;
    const key = repeatKey(row?.job_repeat_inches ?? row?.repeat_inches);
    if (!key) return map;
    const rows = map.get(key) ?? [];
    rows.push(row);
    map.set(key, rows);
    return map;
  }, new Map());
}

export function scheduleRecommendationForTicket(ticket, scheduledRepeatMap, stats) {
  const stock = ticketStockStats(ticket, stats);
  const key = repeatKey(ticket?.repeat_inches);
  const scheduledRows = key ? (scheduledRepeatMap?.get(key) ?? []) : [];
  return {
    ...stock,
    repeatKey: key,
    repeatLabel: repeatLabel(key),
    scheduledRows,
    scheduledCount: scheduledRows.length,
    recommended: stock.needsStock && scheduledRows.length > 0,
  };
}

function isClosedTicket(ticket) {
  const status = String(ticket?.status || "").trim().toLowerCase();
  return CLOSED_TICKET_STATUSES.has(status);
}

export function buildSameRepeatScheduleRecommendations(ticket, tickets = [], scheduleRows = [], options = {}) {
  const limit = options.limit ?? 6;
  const sortByUsage = options.sortBy === "usage";
  const key = repeatKey(ticket?.repeat_inches);
  const scheduledRepeatMap = buildScheduledRepeatMap(scheduleRows);
  const scheduledRows = key ? (scheduledRepeatMap.get(key) ?? []) : [];
  const scheduledTicketIds = new Set(
    (scheduleRows ?? [])
      .filter(isCurrentScheduleRow)
      .map((row) => String(row?.job_ticket ?? row?.job_ticket_id ?? ""))
      .filter(Boolean)
  );

  if (!key) {
    return {
      repeatKey: "",
      repeatLabel: "",
      scheduledRows: [],
      jobs: [],
      hiddenCount: 0,
    };
  }

  const jobs = (tickets ?? [])
    .filter((candidate) => candidate && !sameId(candidate.id, ticket?.id))
    .filter((candidate) => repeatKey(candidate.repeat_inches) === key)
    .filter((candidate) => !isClosedTicket(candidate))
    .map((candidate) => {
      const stats = ticketStockStats(candidate);
      return {
        ticket: candidate,
        stats,
        scheduled: scheduledTicketIds.has(String(candidate.id)),
      };
    })
    .filter((item) => !item.scheduled)
    .filter((item) => item.stats.recentUsage > 0.001)
    .sort((a, b) => {
      if (sortByUsage) {
        const usageDelta = b.stats.monthlyUsage - a.stats.monthlyUsage;
        if (Math.abs(usageDelta) > 0.001) return usageDelta;
      }
      if (a.stats.needsStock !== b.stats.needsStock) return a.stats.needsStock ? -1 : 1;
      const gapDelta = b.stats.stockGap - a.stats.stockGap;
      if (Math.abs(gapDelta) > 0.001) return gapDelta;
      if (!sortByUsage) {
        const usageDelta = b.stats.monthlyUsage - a.stats.monthlyUsage;
        if (Math.abs(usageDelta) > 0.001) return usageDelta;
      }
      return ticketDisplayName(a.ticket).localeCompare(ticketDisplayName(b.ticket), undefined, { numeric: true });
    });

  return {
    repeatKey: key,
    repeatLabel: repeatLabel(key),
    scheduledRows,
    jobs: jobs.slice(0, limit),
    hiddenCount: Math.max(0, jobs.length - limit),
  };
}
