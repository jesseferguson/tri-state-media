import { Barcode, LoaderCircle } from "lucide-react";

const defaultLines = ["Records", "Lookups", "Images", "Activity"];

function BarcodeLoadingScreen({
  eyebrow = "Loading",
  title = "Loading Page",
  detail = "Pulling records and linked data.",
  tone = "default",
  lines = defaultLines,
}) {
  return (
    <section className={`barcode-loading-screen ${tone}`} role="status" aria-live="polite" aria-busy="true">
      <div className="barcode-loading-panel">
        <div className="barcode-loading-hero">
          <div className="barcode-loading-mark" aria-hidden="true">
            <Barcode size={64} strokeWidth={1.7} />
            <span className="barcode-loading-scan" />
          </div>
          <div className="barcode-loading-copy">
            <span>{eyebrow}</span>
            <h2>{title}</h2>
            <p>{detail}</p>
          </div>
          <LoaderCircle className="barcode-loading-spinner" size={24} aria-hidden="true" />
        </div>

        <div className="barcode-loading-progress" aria-hidden="true">
          <span />
        </div>

        <div className="barcode-loading-grid" aria-hidden="true">
          {lines.map((line, index) => (
            <div className="barcode-loading-row" key={line}>
              <span>{line}</span>
              <i style={{ "--barcode-delay": `${index * 120}ms` }} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

export default BarcodeLoadingScreen;
