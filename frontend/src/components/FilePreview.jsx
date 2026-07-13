import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { fetchFile, isApiUrl } from "../api";

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

function useProtectedObjectUrl(url) {
  const [resolvedUrl, setResolvedUrl] = useState("");
  const protectedUrl = isApiUrl(url);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = "";
    const controller = new AbortController();

    setResolvedUrl("");
    if (!url) return undefined;
    if (!protectedUrl) {
      setResolvedUrl(url);
      return undefined;
    }

    async function load() {
      try {
        const response = await fetchFile(url, { cache: "no-store", signal: controller.signal });
        const blob = await response.blob();
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setResolvedUrl(objectUrl);
      } catch (error) {
        if (!cancelled && error?.name !== "AbortError") {
          console.warn("Could not load protected file preview.", error);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, protectedUrl]);

  return resolvedUrl;
}

export function AuthenticatedImage({ src, alt = "", className = "", ...props }) {
  const resolvedSrc = useProtectedObjectUrl(src);
  if (!src) return null;
  if (!resolvedSrc) return <span className={className} aria-hidden="true" />;
  return <img className={className || undefined} src={resolvedSrc} alt={alt} {...props} />;
}

export function PdfPreview({ url, title = "PDF preview", compact = false, showOpenLink = !compact }) {
  const resolvedUrl = useProtectedObjectUrl(url);
  if (!url || !resolvedUrl) return null;

  return (
    <div className={`pdf-preview ${compact ? "compact" : ""}`}>
      <iframe src={pdfEmbedUrl(resolvedUrl)} title={title} loading="lazy" />
      <span className="pdf-preview-badge">
        <FileText size={13} />
        PDF
      </span>
      {showOpenLink && (
        <a href={resolvedUrl} target="_blank" rel="noreferrer">
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

  return <AuthenticatedImage className={className} src={url} alt={title} />;
}
