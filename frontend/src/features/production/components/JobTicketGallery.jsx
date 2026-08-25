import { useMemo } from "react";
import { AlertTriangle, Image as ImageIcon } from "lucide-react";
import { AuthenticatedImage, PdfPreview, isPdfUrl } from "../../../shared/components/FilePreview";

const RECENT_USAGE_DAYS = 90;
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

function ticketUsageStats(ticket, usageRows = [], finishedRows = [], now = new Date()) {
  const hasSummary = ticket.recent_usage_90d !== undefined || ticket.finished_on_hand_quantity !== undefined;
  if (hasSummary) {
    const recentUsage = numeric(ticket.recent_usage_90d);
    const monthlyUsage = numeric(ticket.recent_monthly_usage) || recentUsage / 3;
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

export default function JobTicketGallery({ rows, selectedId, usageRows = [], finishedRows = [], onSelect }) {
  const sortedTickets = useMemo(() => {
    const now = new Date();
    return (rows ?? [])
      .map((ticket) => ({ ticket, stats: ticketUsageStats(ticket, usageRows, finishedRows, now) }))
      .sort((a, b) => {
        const usageDelta = b.stats.recentUsage - a.stats.recentUsage;
        if (Math.abs(usageDelta) > 0.001) return usageDelta;
        const stockDelta = a.stats.onHand - b.stats.onHand;
        if (Math.abs(stockDelta) > 0.001) return stockDelta;
        return String(a.ticket.job_name || a.ticket.ticket_number || "").localeCompare(String(b.ticket.job_name || b.ticket.ticket_number || ""), undefined, { numeric: true });
      });
  }, [rows, usageRows, finishedRows]);

  if (!rows.length) return <p className="empty-row">No job tickets match this view.</p>;

  return (
    <div className="job-ticket-gallery">
      {sortedTickets.map(({ ticket, stats }) => {
        const image = primaryImage(ticket);
        const imageIsDocument = image?.isDocument || isPdfUrl(image?.url);
        return (
          <button
            className={`job-ticket-card ${String(selectedId) === String(ticket.id) ? "active" : ""} ${stats.lowStockLevel ? `stock-${stats.lowStockLevel}` : ""}`}
            type="button"
            key={ticket.id}
            onClick={() => onSelect(ticket)}
          >
            <div className="job-ticket-card-image">
              {image?.url && !imageIsDocument ? (
                <AuthenticatedImage src={image.url} alt={image.name || ticket.job_name} />
              ) : image?.url ? (
                <PdfPreview url={image.url} title={image.name || ticket.job_name || "Job PDF"} compact />
              ) : (
                <div>
                  <ImageIcon size={28} />
                  <span>No Image</span>
                </div>
              )}
              <span className="job-ticket-card-badge">{ticketMeta(ticket)}</span>
              {imageSourceLabel(image) && <span className="job-ticket-source-badge">{imageSourceLabel(image)}</span>}
              {stats.lowStockLevel && (
                <span className={`job-ticket-stock-flag ${stats.lowStockLevel}`}>
                  <AlertTriangle size={12} /> {stats.lowStockLevel === "critical" ? "No stock" : "Low stock"}
                </span>
              )}
            </div>
            <div className="job-ticket-card-body">
              <strong>{ticket.job_name || "Untitled Job"}</strong>
              <span>{customerName(ticket)}</span>
              <div className="job-ticket-usage-row">
                <span>90d use <strong>{quantityLabel(stats.recentUsage)}</strong></span>
                <span>Stock <strong>{quantityLabel(stats.onHand)}</strong></span>
              </div>
              <em>{stats.monthsOnHand !== null ? `${Number(stats.monthsOnHand.toFixed(1)).toLocaleString()} months on hand` : image?.name || "Open job packet"}</em>
            </div>
          </button>
        );
      })}
    </div>
  );
}
