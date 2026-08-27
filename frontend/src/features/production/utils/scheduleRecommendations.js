const CURRENT_SCHEDULE_STATUSES = new Set(["unscheduled", "scheduled", "ready", "running", "on_hold"]);
const CLOSED_TICKET_STATUSES = new Set(["complete", "cancelled", "inactive"]);
const CURRENT_SCHEDULE_STATUS_RANK = {
  running: 0,
  ready: 1,
  scheduled: 2,
  unscheduled: 3,
  on_hold: 4,
};

function numeric(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function sameId(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

function sameText(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  const left = String(a).trim().toLowerCase();
  const right = String(b).trim().toLowerCase();
  return Boolean(left && right && left === right);
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

function stockoutBusinessDays(stats = {}) {
  const monthlyUsage = numeric(stats.monthlyUsage);
  const onHand = numeric(stats.onHand);
  if (monthlyUsage <= 0) return Number.POSITIVE_INFINITY;
  if (onHand <= 0) return 0;
  return Math.floor(onHand / (monthlyUsage / 21));
}

export function isCurrentScheduleRow(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  return !status || CURRENT_SCHEDULE_STATUSES.has(status);
}

export function scheduleMatchesTicket(row, ticket) {
  return (
    sameId(row?.job_ticket, ticket?.id) ||
    sameId(row?.job_ticket_id, ticket?.id) ||
    sameText(row?.job_ticket_number, ticket?.ticket_number) ||
    sameText(row?.job_product_code, ticket?.product_code)
  );
}

export function scheduleDateValue(row) {
  return row?.scheduled_date || row?.order_date || row?.due_date || row?.run_date || "";
}

export function scheduleQuantity(row) {
  return numeric(row?.quantity_to_ship) + numeric(row?.quantity_to_stock);
}

export function scheduleLocationLabel(row) {
  const status = String(row?.status || "").trim().toLowerCase();
  const press = titleText(row?.press_name) || (status === "on_hold" ? "Held" : "Unassigned");
  const position = row?.press_sequence ? `#${row.press_sequence}` : "";
  return [press, position].filter(Boolean).join(" ");
}

function currentScheduleSort(a, b) {
  const statusDelta = (CURRENT_SCHEDULE_STATUS_RANK[String(a?.status || "").toLowerCase()] ?? 5) - (CURRENT_SCHEDULE_STATUS_RANK[String(b?.status || "").toLowerCase()] ?? 5);
  if (statusDelta) return statusDelta;
  const pressDelta = String(a?.press_name || "").localeCompare(String(b?.press_name || ""), undefined, { numeric: true });
  if (pressDelta) return pressDelta;
  const sequenceDelta = numeric(a?.press_sequence) - numeric(b?.press_sequence);
  if (sequenceDelta) return sequenceDelta;
  return String(scheduleDateValue(a)).localeCompare(String(scheduleDateValue(b)));
}

export function currentScheduleRowsForTicket(ticket, scheduleRows = []) {
  return (scheduleRows ?? [])
    .filter((row) => isCurrentScheduleRow(row) && scheduleMatchesTicket(row, ticket))
    .sort(currentScheduleSort);
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
  const sortByRunout = options.sortBy === "runout";
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
        stockoutBusinessDays: stockoutBusinessDays(stats),
        scheduled: scheduledTicketIds.has(String(candidate.id)),
      };
    })
    .filter((item) => !item.scheduled)
    .filter((item) => item.stats.recentUsage > 0.001)
    .sort((a, b) => {
      if (sortByRunout) {
        const runoutDelta = a.stockoutBusinessDays - b.stockoutBusinessDays;
        if (Math.abs(runoutDelta) > 0.001) return runoutDelta;
      }
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
