import { Image as ImageIcon } from "lucide-react";
import { PdfPreview, isPdfUrl } from "./FilePreview";

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

export default function JobTicketGallery({ rows, selectedId, onSelect }) {
  if (!rows.length) return <p className="empty-row">No job tickets match this view.</p>;

  return (
    <div className="job-ticket-gallery">
      {rows.map((ticket) => {
        const image = primaryImage(ticket);
        const imageIsDocument = image?.isDocument || isPdfUrl(image?.url);
        return (
          <button
            className={`job-ticket-card ${String(selectedId) === String(ticket.id) ? "active" : ""}`}
            type="button"
            key={ticket.id}
            onClick={() => onSelect(ticket)}
          >
            <div className="job-ticket-card-image">
              {image?.url && !imageIsDocument ? (
                <img src={image.url} alt={image.name || ticket.job_name} />
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
            </div>
            <div className="job-ticket-card-body">
              <strong>{ticket.job_name || "Untitled Job"}</strong>
              <span>{customerName(ticket)}</span>
              <em>{image?.name || "Open job packet"}</em>
            </div>
          </button>
        );
      })}
    </div>
  );
}
