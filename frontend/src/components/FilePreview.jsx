import { FileText } from "lucide-react";

export function isPdfUrl(url) {
  let text = String(url || "").toLowerCase();
  try {
    text = decodeURIComponent(text);
  } catch {
    // Some signed storage URLs contain partial escape sequences. The raw URL is still enough for extension checks.
  }
  return text.includes(".pdf");
}

function pdfEmbedUrl(url) {
  const separator = String(url || "").includes("#") ? "&" : "#";
  return `${url}${separator}toolbar=0&navpanes=0&scrollbar=0&view=Fit&zoom=page-fit`;
}

export function PdfPreview({ url, title = "PDF preview", compact = false, showOpenLink = !compact }) {
  if (!url) return null;

  return (
    <div className={`pdf-preview ${compact ? "compact" : ""}`}>
      <iframe src={pdfEmbedUrl(url)} title={title} loading="lazy" />
      <span className="pdf-preview-badge">
        <FileText size={13} />
        PDF
      </span>
      {showOpenLink && (
        <a href={url} target="_blank" rel="noreferrer">
          Open PDF
        </a>
      )}
    </div>
  );
}

export function FilePreview({ url, title = "File preview", isDocument = false, compact = false, className = "" }) {
  if (!url) return null;
  if (isDocument || isPdfUrl(url)) {
    return (
      <div className={className}>
        <PdfPreview url={url} title={title} compact={compact} />
      </div>
    );
  }

  return <img className={className} src={url} alt={title} />;
}
