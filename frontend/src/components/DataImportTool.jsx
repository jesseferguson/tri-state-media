import { AlertTriangle, CheckCircle2, DatabaseZap, Download, FileSpreadsheet, RefreshCcw, Trash2, UploadCloud } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { requestApi } from "../api";

const importOrder = ["job_tickets", "job_ticket_usage", "flex_dies", "inventory", "inventory_usage"];

const flushScopes = [
  ["setup_data", "Setup data: job tickets, schedule, flex dies, inventory, usage, quotes"],
  ["job_tickets", "Job tickets + schedule/orders"],
  ["flex_dies", "Flex dies"],
  ["inventory", "Raw inventory + usage"],
  ["inventory_usage", "Inventory usage only"],
  ["job_ticket_usage", "Job ticket usage only"],
  ["quotes", "Saved quotes"],
];

function fileNameFor(type) {
  return `${String(type || "import").replace(/_/g, "-")}-template.csv`;
}

function downloadCsv(type, csv) {
  const blob = new Blob([csv || ""], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileNameFor(type);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function ResultPanel({ result }) {
  if (!result) return null;
  const shownErrors = result.errors ?? [];
  const shownWarnings = result.warnings ?? [];
  const errorCount = result.error_count ?? shownErrors.length;
  const warningCount = result.warning_count ?? shownWarnings.length;
  return (
    <section className={`data-import-result ${errorCount ? "has-errors" : "ok"}`}>
      <header>
        {errorCount ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
        <div>
          <strong>{result.dry_run ? "Dry run finished" : "Import finished"}</strong>
          <span>{result.rows ?? 0} rows checked</span>
        </div>
      </header>
      <div className="data-import-counts">
        <span><strong>{result.created ?? 0}</strong> created</span>
        <span><strong>{result.updated ?? 0}</strong> updated</span>
        <span><strong>{result.skipped ?? 0}</strong> skipped</span>
      </div>
      {errorCount > 0 && (
        <div className="data-import-errors">
          {shownErrors.slice(0, 12).map((error, index) => (
            <p key={`${error.line}-${index}`}>Line {error.line}: {error.message}</p>
          ))}
          {errorCount > 12 && <p>{errorCount - 12} more errors not shown.</p>}
        </div>
      )}
      {warningCount > 0 && (
        <div className="data-import-warnings">
          {shownWarnings.slice(0, 8).map((warning, index) => (
            <p key={`${warning.line}-${index}`}>Line {warning.line}: {warning.message}</p>
          ))}
          {warningCount > 8 && <p>{warningCount - 8} more warnings not shown.</p>}
        </div>
      )}
    </section>
  );
}

export default function DataImportTool({ currentUser }) {
  const [templates, setTemplates] = useState({});
  const [activeType, setActiveType] = useState("job_tickets");
  const [file, setFile] = useState(null);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [flushScope, setFlushScope] = useState("setup_data");
  const [confirmation, setConfirmation] = useState("");
  const [flushResult, setFlushResult] = useState(null);
  const activeTemplate = templates[activeType];
  const canFlush = String(currentUser?.role || "").toLowerCase() === "admin";

  const orderedTemplates = useMemo(
    () => importOrder.map((key) => [key, templates[key]]).filter(([, template]) => template),
    [templates]
  );

  useEffect(() => {
    let cancelled = false;
    async function loadTemplates() {
      setLoading(true);
      setError("");
      try {
        const payload = await requestApi("data-import/templates");
        if (cancelled) return;
        setTemplates(payload || {});
      } catch (loadError) {
        if (!cancelled) setError(loadError.message || "Could not load import templates.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadTemplates();
    return () => {
      cancelled = true;
    };
  }, []);

  async function submitImport(event) {
    event.preventDefault();
    if (!file) {
      setError("Choose a CSV file first.");
      return;
    }
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("dry_run", dryRun ? "true" : "false");
      const payload = await requestApi(`data-import/${activeType}`, {
        method: "POST",
        body: formData,
      });
      setResult(payload);
    } catch (submitError) {
      setError(submitError.message || "Import failed.");
    } finally {
      setBusy(false);
    }
  }

  async function flushData(event) {
    event.preventDefault();
    if (!canFlush) return;
    setBusy(true);
    setError("");
    setFlushResult(null);
    try {
      const payload = await requestApi("data-import/flush", {
        method: "POST",
        body: JSON.stringify({
          scope: flushScope,
          confirmation,
          performed_by: currentUser?.name || "",
        }),
      });
      setFlushResult(payload);
      setConfirmation("");
    } catch (flushError) {
      setError(flushError.message || "Flush failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="data-import-tool">
      <section className="data-import-hero">
        <div>
          <p className="eyebrow">Data Setup</p>
          <h2>CSV Import Center</h2>
          <p>Bring over old-system job tickets, flex die jackets, inventory rolls, and inventory usage in controlled batches.</p>
        </div>
        <div className="data-import-hero-actions">
          <span><FileSpreadsheet size={16} /> CSV only</span>
          <span><RefreshCcw size={16} /> Dry run first</span>
        </div>
      </section>

      {error && <div className="error-box">{error}</div>}

      <section className="data-import-grid">
        <form className="data-import-panel" onSubmit={submitImport}>
          <header className="data-import-panel-head">
            <div>
              <p className="eyebrow">Import</p>
              <h3>Upload CSV</h3>
            </div>
            <button
              className="ghost-btn"
              type="button"
              disabled={!activeTemplate}
              onClick={() => downloadCsv(activeType, activeTemplate?.csv)}
            >
              <Download size={15} /> Template
            </button>
          </header>

          <div className="data-import-tabs">
            {orderedTemplates.map(([key, template]) => (
              <button className={activeType === key ? "active" : ""} type="button" key={key} onClick={() => { setActiveType(key); setResult(null); setFile(null); }}>
                {template.label}
              </button>
            ))}
            {loading && <span>Loading formats...</span>}
          </div>

          {activeTemplate && (
            <>
              <div className="data-import-format">
                <strong>{activeTemplate.label}</strong>
                <p>{activeTemplate.description}</p>
                <div className="data-import-columns">
                  {activeTemplate.columns.map((column) => <code key={column}>{column}</code>)}
                </div>
              </div>

              <label className="data-import-drop">
                <UploadCloud size={24} />
                <span>{file ? file.name : "Choose CSV file"}</span>
                <input type="file" accept=".csv,text/csv" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
              </label>

              <label className="check-field data-import-check">
                <input type="checkbox" checked={dryRun} onChange={(event) => setDryRun(event.target.checked)} />
                <span>Dry run first. Validate rows without saving.</span>
              </label>

              <div className="form-actions">
                <button className="primary-btn" type="submit" disabled={busy || !file}>
                  <UploadCloud size={16} /> {busy ? "Working..." : dryRun ? "Run Check" : "Import Data"}
                </button>
              </div>
            </>
          )}

          <ResultPanel result={result} />
        </form>

        <aside className="data-import-panel data-import-side">
          <header className="data-import-panel-head">
            <div>
              <p className="eyebrow">Format</p>
              <h3>What the CSV should look like</h3>
            </div>
          </header>
          <pre>{activeTemplate?.csv || "Loading template..."}</pre>
          <p className="data-import-note">Use the old Row ID in the row_id column. It stays with the record as a legacy reference so you can trace where imported data came from.</p>
        </aside>
      </section>

      <form className="data-import-flush" onSubmit={flushData}>
        <div>
          <p className="eyebrow">Early Setup Cleanup</p>
          <h3>Flush Test Data</h3>
          <p>This is for setup while you are still testing imports. It never deletes users, roles, customers, presses, or material data types.</p>
        </div>
        <label className="field">
          <span>Data to flush</span>
          <select value={flushScope} onChange={(event) => setFlushScope(event.target.value)} disabled={!canFlush}>
            {flushScopes.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Type DELETE DATA</span>
          <input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} placeholder="DELETE DATA" disabled={!canFlush} />
        </label>
        <button className="danger-btn" type="submit" disabled={!canFlush || busy || confirmation !== "DELETE DATA"}>
          <Trash2 size={16} /> Flush
        </button>
        {!canFlush && <p className="data-import-note">Only Admin users can flush setup data.</p>}
        {flushResult && (
          <div className="data-import-flush-result">
            <DatabaseZap size={16} />
            <span>Flushed {flushResult.scope}: {Object.entries(flushResult.deleted || {}).map(([key, value]) => `${key} ${value}`).join(", ")}</span>
          </div>
        )}
      </form>
    </section>
  );
}
