import { LoaderCircle, PackageOpen, QrCode } from "lucide-react";

export default function ScanLinkScreen({ kind = "skid" }) {
  const isRoll = kind === "roll";
  return (
    <section className="scan-link-screen" role="status" aria-live="polite">
      <div className="scan-link-loader">
        <span className="scan-link-loader-icon">
          {isRoll ? <PackageOpen size={30} /> : <QrCode size={30} />}
        </span>
        <LoaderCircle className="scan-link-spinner" size={58} />
      </div>
      <div>
        <span>Secure plant inventory</span>
        <h1>Opening {isRoll ? "Roll" : "Skid"}</h1>
        <p>Loading the current record and location...</p>
      </div>
      <div className="scan-link-loading-bars" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
    </section>
  );
}
