import { LoaderCircle, QrCode } from "lucide-react";

function FlexDieLoadingScreen({ scanned = false, compact = false, error = "" }) {
  return (
    <section className={`flex-die-loading-screen ${compact ? "compact" : ""}`} role="status" aria-live="polite">
      <div className="flex-die-loading-mark">
        <QrCode size={compact ? 24 : 30} />
        <LoaderCircle className="flex-die-loading-spinner" size={compact ? 48 : 62} />
      </div>
      <div className="flex-die-loading-copy">
        <span>{scanned ? "Scanned folder link" : "Tooling library"}</span>
        <h2>{scanned ? "Opening Flex Die" : "Loading Flex Dies"}</h2>
        <p>{error || (scanned ? "Loading the current folder information..." : "Fetching the die list, labels, and reorder details...")}</p>
      </div>
      {!error && (
        <div className="flex-die-loading-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
    </section>
  );
}

export default FlexDieLoadingScreen;
