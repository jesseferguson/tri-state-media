import { useEffect, useState } from "react";
import { FileText, Image as ImageIcon, LoaderCircle } from "lucide-react";
import { AuthenticatedFileLink, AuthenticatedImage, isPdfUrl } from "../../../shared/components/FilePreview";

export default function JobTicketArtworkPreview({
  image,
  title = "Job image",
  emptyLabel = "No job image",
  compact = false,
}) {
  const url = image?.url || "";
  const isDocument = Boolean(image?.isDocument) || isPdfUrl(url);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
  }, [url]);

  if (!url) {
    return (
      <div className="job-ticket-artwork-empty">
        <ImageIcon size={compact ? 26 : 30} />
        <span>{emptyLabel}</span>
      </div>
    );
  }

  if (isDocument) {
    return (
      <div className="job-ticket-artwork-preview document">
        <div className="job-ticket-document-tile">
          <FileText size={compact ? 28 : 38} />
          <strong>PDF artwork</strong>
          <span>{image?.name || title}</span>
          {!compact && (
            <AuthenticatedFileLink className="job-ticket-document-open" href={url}>
              Open PDF
            </AuthenticatedFileLink>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`job-ticket-artwork-preview image ${loaded ? "loaded" : "loading"} ${failed ? "failed" : ""}`}>
      {!loaded && (
        <div className="job-ticket-image-loading" aria-hidden="true">
          <LoaderCircle size={compact ? 18 : 22} />
          <span>{failed ? "Image unavailable" : "Loading image"}</span>
        </div>
      )}
      <AuthenticatedImage
        className="job-ticket-artwork-image"
        src={url}
        alt={image?.name || title}
        onLoad={() => setLoaded(true)}
        onError={() => {
          setFailed(true);
          setLoaded(false);
        }}
      />
    </div>
  );
}
