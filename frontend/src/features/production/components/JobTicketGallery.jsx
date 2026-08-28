import { useMemo } from "react";
import { AlertTriangle, Barcode, CalendarCheck2, CalendarPlus, LoaderCircle, SlidersHorizontal, X } from "lucide-react";
import { buildScheduledRepeatMap, currentScheduleRowsForTicket, scheduleDateValue, scheduleLocationLabel, scheduleQuantity, scheduleRecommendationForTicket } from "../utils/scheduleRecommendations";
import JobTicketArtworkPreview from "./JobTicketArtworkPreview";

const RECENT_USAGE_DAYS = 90;
const RECENT_ORDER_DAYS = 30;
const LOW_STOCK_MONTHS = 1;
const ON_HAND_STATUSES = new Set(["available", "allocated", "on_hold"]);

function primaryImage(ticket) {
  const images = Array.isArray(ticket.job_images) ? ticket.job_images : [];
  return (
    images.find((image) => image.slot === "general" && image.url) ||
    images.find((image) => image.url) ||
    null
  );
}

function imageSourceLabel(image) {
  return image?.source || "";
}

function customerName(ticket) {
  return ticket.customer_display || ticket.customer_name || "No customer";
}

function ticketMeta(ticket) {
  return ticket.product_code ? `TSM ${ticket.product_code}` : "No TSM ID";
}

function customerOwner(ticket) {
  return String(ticket.customer_account_owner || ticket.account_owner || "").trim();
}

function customerOptionLabel(customer) {
  return [customer.name, customer.customer_code ? `ID ${customer.customer_code}` : ""].filter(Boolean).join(" / ");
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

function numeric(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(text) ? new Date(`${text}T00:00:00`) : new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

function usageDate(row) {
  return parseDateValue(row?.used_at || row?.date || row?.used_date);
}

function usageMatchesTicket(row, ticket) {
  if (sameId(row.job_ticket, ticket.id)) return true;
  if (sameText(row.job_ticket_number, ticket.ticket_number)) return true;
  if (sameText(row.product_code, ticket.product_code)) return true;
  if (sameText(row.legacy_job_ticket_id, ticket.ticket_number)) return true;
  if (sameText(row.legacy_job_ticket_id, ticket.product_code)) return true;
  return false;
}

function finishedMatchesTicket(row, ticket) {
  return sameId(row.job_ticket, ticket.id) || sameText(row.job_ticket_number, ticket.ticket_number);
}

function shipmentDate(row) {
  return parseDateValue(row?.shipped_date || row?.run_date || row?.updated_at || row?.created_at);
}

function shipmentQuantity(row) {
  return numeric(row.quantity);
}

function quantityLabel(value) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number <= 0) return "0";
  if (number >= 1000) return Math.round(number).toLocaleString();
  return Number(number.toFixed(1)).toLocaleString();
}

function scheduleDateLabel(value) {
  const date = parseDateValue(value);
  if (!date) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function stockoutInfo(monthlyUsage, onHand, backendBusinessDays = null) {
  const monthly = numeric(monthlyUsage);
  const stock = numeric(onHand);
  const serverDays = Number(backendBusinessDays);
  if (monthly <= 0) {
    return { days: Number.POSITIVE_INFINITY, label: "No recent usage", tone: "quiet" };
  }
  if (stock <= 0) {
    return { days: 0, label: "0 business days", tone: "urgent" };
  }
  const days = Number.isFinite(serverDays) && serverDays < 9999999
    ? Math.max(0, Math.floor(serverDays))
    : Math.max(0, Math.floor(stock / (monthly / 21)));
  return {
    days,
    label: `${days.toLocaleString()} business day${days === 1 ? "" : "s"}`,
    tone: days <= 5 ? "urgent" : days <= 15 ? "watch" : "good",
  };
}

function JobTicketInlineLoading({ label = "Loading tickets", detail = "Pulling matching job tickets and stock cues." }) {
  return (
    <div className="job-ticket-gallery-loading job-barcode-inline-loading" role="status" aria-live="polite" aria-busy="true">
      <div className="job-barcode-inline-main">
        <div className="job-barcode-inline-mark" aria-hidden="true">
          <Barcode size={24} />
          <span className="job-barcode-inline-scan" />
        </div>
        <div className="job-barcode-inline-copy">
          <strong>{label}</strong>
          <span>{detail}</span>
        </div>
        <LoaderCircle className="job-barcode-inline-spinner" size={18} aria-hidden="true" />
      </div>
      <div className="job-barcode-inline-lines" aria-hidden="true">
        {[0, 1, 2].map((index) => <i key={index} style={{ "--barcode-delay": `${index * 100}ms` }} />)}
      </div>
    </div>
  );
}

function recentOrderCountForTicket(ticket, usageRows = [], finishedRows = [], now = new Date()) {
  const summary = Number(ticket.recent_order_count_30d);
  if (Number.isFinite(summary)) return Math.max(0, summary);

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RECENT_ORDER_DAYS);

  const importedOrderCount = usageRows.reduce((count, row) => {
    if (!usageMatchesTicket(row, ticket)) return count;
    const date = usageDate(row);
    if (!date || date < cutoff || date > now) return count;
    return count + 1;
  }, 0);

  const shippedOrderCount = finishedRows.reduce((count, row) => {
    if (!finishedMatchesTicket(row, ticket)) return count;
    if (String(row.status || "").toLowerCase() !== "shipped") return count;
    const date = shipmentDate(row);
    if (!date || date < cutoff || date > now) return count;
    return count + 1;
  }, 0);

  return importedOrderCount + shippedOrderCount;
}

function ticketUsageStats(ticket, usageRows = [], finishedRows = [], now = new Date()) {
  const hasSummary = ticket.recent_usage_90d !== undefined || ticket.finished_on_hand_quantity !== undefined;
  if (hasSummary) {
    const summaryMonthlyUsage = numeric(ticket.recent_monthly_usage);
    const recentUsage = numeric(ticket.recent_usage_90d) || summaryMonthlyUsage * 3;
    const monthlyUsage = summaryMonthlyUsage || recentUsage / 3;
    const onHand = numeric(ticket.finished_on_hand_quantity);
    const monthsOnHand = ticket.stock_months_on_hand === null || ticket.stock_months_on_hand === undefined
      ? (monthlyUsage > 0 ? onHand / monthlyUsage : null)
      : numeric(ticket.stock_months_on_hand);
    const isLowStock = recentUsage > 0 && onHand <= monthlyUsage * LOW_STOCK_MONTHS;
    const lowStockLevel = ticket.low_stock_level || (isLowStock && onHand <= 0 ? "critical" : isLowStock ? "low" : "");
    return {
      recentUsage,
      monthlyUsage,
      onHand,
      monthsOnHand,
      lowStockLevel,
    };
  }

  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - RECENT_USAGE_DAYS);

  const importedUsage = usageRows.reduce((sum, row) => {
    if (!usageMatchesTicket(row, ticket)) return sum;
    const date = usageDate(row);
    if (!date || date < cutoff || date > now) return sum;
    return sum + numeric(row.quantity);
  }, 0);

  const matchingFinished = finishedRows.filter((row) => finishedMatchesTicket(row, ticket));
  const shippedUsage = matchingFinished.reduce((sum, row) => {
    if (row.status !== "shipped") return sum;
    const date = shipmentDate(row);
    if (!date || date < cutoff || date > now) return sum;
    return sum + shipmentQuantity(row);
  }, 0);

  const onHand = matchingFinished.reduce((sum, row) => {
    if (row.is_active === false || !ON_HAND_STATUSES.has(String(row.status || "").toLowerCase())) return sum;
    return sum + numeric(row.quantity);
  }, 0);

  const recentUsage = importedUsage + shippedUsage;
  const monthlyUsage = recentUsage / 3;
  const monthsOnHand = monthlyUsage > 0 ? onHand / monthlyUsage : null;
  const isLowStock = recentUsage > 0 && onHand <= monthlyUsage * LOW_STOCK_MONTHS;
  const lowStockLevel = isLowStock && onHand <= 0 ? "critical" : isLowStock ? "low" : "";

  return {
    recentUsage,
    monthlyUsage,
    onHand,
    monthsOnHand,
    lowStockLevel,
  };
}

export default function JobTicketGallery({
  rows,
  selectedId,
  usageRows = [],
  finishedRows = [],
  scheduleRows = [],
  customers = [],
  customerFilter = "",
  ownerFilter = "",
  sortMode = "usage",
  totalCount = 0,
  loading = false,
  initialLoading = false,
  onCustomerFilterChange,
  onOwnerFilterChange,
  onSortModeChange,
  onClearFilters,
  onSelect,
}) {
  const scheduledRepeatMap = useMemo(() => buildScheduledRepeatMap(scheduleRows), [scheduleRows]);
  const customerOptions = useMemo(() => (
    [...(customers ?? [])]
      .filter((customer) => customer?.id && customer.is_active !== false)
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { numeric: true }))
  ), [customers]);
  const ownerOptions = useMemo(() => {
    const owners = new Set();
    (customers ?? []).forEach((customer) => {
      const owner = String(customer?.account_owner || "").trim();
      if (owner) owners.add(owner);
    });
    (rows ?? []).forEach((ticket) => {
      const owner = customerOwner(ticket);
      if (owner) owners.add(owner);
    });
    return Array.from(owners).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [customers, rows]);
  const filtersActive = Boolean(customerFilter || ownerFilter);
  const sortedTickets = useMemo(() => {
    const now = new Date();
    return (rows ?? [])
      .map((ticket) => {
        const stats = ticketUsageStats(ticket, usageRows, finishedRows, now);
        const stockout = stockoutInfo(stats.monthlyUsage, stats.onHand, ticket.stockout_business_days);
        const recentOrderCount30d = recentOrderCountForTicket(ticket, usageRows, finishedRows, now);
        const lowPredictability = stats.monthlyUsage > 0.001 && recentOrderCount30d <= 1;
        const activeScheduleRows = currentScheduleRowsForTicket(ticket, scheduleRows);
        const currentScheduleCount = Math.max(activeScheduleRows.length, numeric(ticket.current_schedule_count));
        const scheduled = currentScheduleCount > 0;
        return {
          ticket,
          stats,
          stockout,
          recentOrderCount30d,
          lowPredictability,
          activeScheduleRows,
          currentScheduleCount,
          scheduled,
          scheduleCue: scheduleRecommendationForTicket(ticket, scheduledRepeatMap, stats),
        };
      })
      .sort((a, b) => {
        const aHasUsage = a.stats.monthlyUsage > 0.001;
        const bHasUsage = b.stats.monthlyUsage > 0.001;
        if (aHasUsage !== bHasUsage) return aHasUsage ? -1 : 1;
        if (a.scheduled !== b.scheduled) return a.scheduled ? 1 : -1;
        if (sortMode === "runout") {
          if (a.lowPredictability !== b.lowPredictability) return a.lowPredictability ? 1 : -1;
          const runoutDelta = a.stockout.days - b.stockout.days;
          if (Math.abs(runoutDelta) > 0.001) return runoutDelta;
          const usageDelta = b.stats.monthlyUsage - a.stats.monthlyUsage;
          if (Math.abs(usageDelta) > 0.001) return usageDelta;
        } else {
          const usageDelta = b.stats.monthlyUsage - a.stats.monthlyUsage;
          if (Math.abs(usageDelta) > 0.001) return usageDelta;
          const runoutDelta = a.stockout.days - b.stockout.days;
          if (Math.abs(runoutDelta) > 0.001 && (a.stats.lowStockLevel || b.stats.lowStockLevel)) return runoutDelta;
        }
        const gapDelta = (b.stats.monthlyUsage - b.stats.onHand) - (a.stats.monthlyUsage - a.stats.onHand);
        if (Math.abs(gapDelta) > 0.001 && (a.stats.lowStockLevel || b.stats.lowStockLevel)) return gapDelta;
        if (a.scheduleCue.recommended !== b.scheduleCue.recommended) {
          return a.scheduleCue.recommended ? -1 : 1;
        }
        if (a.stats.lowStockLevel !== b.stats.lowStockLevel) {
          if (a.stats.lowStockLevel === "critical") return -1;
          if (b.stats.lowStockLevel === "critical") return 1;
          if (a.stats.lowStockLevel === "low") return -1;
          if (b.stats.lowStockLevel === "low") return 1;
        }
        const stockDelta = a.stats.onHand - b.stats.onHand;
        if (Math.abs(stockDelta) > 0.001) return stockDelta;
        return String(a.ticket.job_name || a.ticket.ticket_number || "").localeCompare(String(b.ticket.job_name || b.ticket.ticket_number || ""), undefined, { numeric: true });
      });
  }, [rows, usageRows, finishedRows, scheduleRows, scheduledRepeatMap, sortMode]);

  return (
    <section className="job-ticket-gallery-shell">
      <div className="job-ticket-filter-bar">
        <div>
          <SlidersHorizontal size={16} />
          <span>Filters</span>
          <strong>{rows.length.toLocaleString()} shown{totalCount ? ` / ${totalCount.toLocaleString()} total` : ""}</strong>
          {loading && (
            <em className="job-ticket-filter-loading">
              <LoaderCircle size={12} />
              Updating results
            </em>
          )}
        </div>
        <label>
          <span>Customer</span>
          <select value={customerFilter} onChange={(event) => onCustomerFilterChange?.(event.target.value)}>
            <option value="">All customers</option>
            {customerOptions.map((customer) => (
              <option value={customer.id} key={customer.id}>{customerOptionLabel(customer)}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Sales Person</span>
          <select value={ownerFilter} onChange={(event) => onOwnerFilterChange?.(event.target.value)}>
            <option value="">All sales people</option>
            {ownerOptions.map((owner) => (
              <option value={owner} key={owner}>{owner}</option>
            ))}
            <option value="__unassigned__">Unassigned</option>
          </select>
        </label>
        <label>
          <span>Sort</span>
          <select value={sortMode} onChange={(event) => onSortModeChange?.(event.target.value)}>
            <option value="usage">High usage</option>
            <option value="runout">Business days until out</option>
          </select>
        </label>
        {filtersActive && (
          <button
            className="ghost-btn"
            type="button"
            onClick={() => {
              if (onClearFilters) {
                onClearFilters();
              } else {
                onCustomerFilterChange?.("");
                onOwnerFilterChange?.("");
              }
            }}
          >
            <X size={14} /> Clear
          </button>
        )}
      </div>

      {initialLoading && !rows.length ? (
        <JobTicketInlineLoading />
      ) : !rows.length ? (
        <p className="empty-row">No job tickets match this view.</p>
      ) : (
        <div className={`job-ticket-gallery-wrap ${loading ? "is-refreshing" : ""}`}>
          <div className="job-ticket-gallery">
          {sortedTickets.map(({ ticket, stats, stockout, recentOrderCount30d, lowPredictability, activeScheduleRows, currentScheduleCount, scheduled, scheduleCue }) => {
            const image = primaryImage(ticket);
            const owner = customerOwner(ticket);
            const primarySchedule = activeScheduleRows[0] ?? null;
            const scheduleLabel = primarySchedule ? scheduleLocationLabel(primarySchedule) : `${currentScheduleCount} active schedule${currentScheduleCount === 1 ? "" : "s"}`;
            const scheduleMeta = primarySchedule
              ? [
                scheduleDateLabel(scheduleDateValue(primarySchedule)),
                scheduleQuantity(primarySchedule) ? `${quantityLabel(scheduleQuantity(primarySchedule))} labels` : "",
                currentScheduleCount > 1 ? `+${currentScheduleCount - 1} more` : "",
              ].filter(Boolean).join(" / ")
              : "";
            const showRecommendation = !scheduled && scheduleCue.recommended;
            return (
              <button
                className={`job-ticket-card ${String(selectedId) === String(ticket.id) ? "active" : ""} ${stats.lowStockLevel ? `stock-${stats.lowStockLevel}` : ""} ${showRecommendation ? "schedule-recommended" : ""} ${scheduled ? "is-scheduled" : ""}`}
                type="button"
                key={ticket.id}
                onClick={() => onSelect(ticket)}
              >
                <div className="job-ticket-card-image">
                  <JobTicketArtworkPreview image={image} title={ticket.job_name || "Job image"} emptyLabel="No Image" compact />
                  <span className="job-ticket-card-badge">{ticketMeta(ticket)}</span>
                  {imageSourceLabel(image) && <span className="job-ticket-source-badge">{imageSourceLabel(image)}</span>}
                  {stats.lowStockLevel && (
                    <span className={`job-ticket-stock-flag ${stats.lowStockLevel}`}>
                      <AlertTriangle size={12} /> {stats.lowStockLevel === "critical" ? "No stock" : "Low stock"}
                    </span>
                  )}
                  {scheduled && (
                    <span className="job-ticket-scheduled-flag">
                      <CalendarCheck2 size={12} />
                      <span>Scheduled</span>
                    </span>
                  )}
                  {showRecommendation && (
                    <span
                      className="job-ticket-schedule-cue"
                      title={`Recommended to schedule: avg/month ${quantityLabel(scheduleCue.monthlyUsage)} is above stock ${quantityLabel(scheduleCue.onHand)}, and repeat ${scheduleCue.repeatLabel} is already on the schedule.`}
                    >
                      <CalendarPlus size={12} />
                      <span>Plan</span>
                    </span>
                  )}
                </div>
                <div className="job-ticket-card-body">
                  <strong>{ticket.job_name || "Untitled Job"}</strong>
                  <span>{customerName(ticket)}</span>
                  {owner && <span className="job-ticket-card-owner">Sales: {owner}</span>}
                  {scheduled && (
                    <span className="job-ticket-schedule-status-card">
                      Scheduled <strong>{scheduleLabel}</strong>
                      {scheduleMeta && <em>{scheduleMeta}</em>}
                    </span>
                  )}
                  <div className="job-ticket-usage-row">
                    <span>3mo avg <strong>{quantityLabel(stats.monthlyUsage)}</strong></span>
                    <span>Stock <strong>{quantityLabel(stats.onHand)}</strong></span>
                  </div>
                  <span className={`job-ticket-runout-tag ${stockout.tone}`}>
                    Stock Runs Out In <strong>{stockout.label}</strong>
                  </span>
                  {lowPredictability && (
                    <span className="job-ticket-demand-confidence">
                      {recentOrderCount30d === 1 ? "1 order last 30d" : `${recentOrderCount30d} orders last 30d`}
                      <strong>Low predictability</strong>
                    </span>
                  )}
                  {scheduleCue.recommended ? (
                    <em className="job-ticket-card-recommendation">Avg/month above stock / repeat {scheduleCue.repeatLabel} scheduled</em>
                  ) : (
                    <em>{stats.monthsOnHand !== null ? `${Number(stats.monthsOnHand.toFixed(1)).toLocaleString()} months on hand` : image?.name || "Open job packet"}</em>
                  )}
                </div>
              </button>
            );
          })}
          </div>
        </div>
      )}
    </section>
  );
}
