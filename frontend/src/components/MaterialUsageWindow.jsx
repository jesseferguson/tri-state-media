import { BarChart3, X } from "lucide-react";
import { formatCell, getRecordTitle, labelize } from "../lib/format";

function usageTitle(row) {
  return [
    row.reference,
    row.coater_roll_tag_number ? `Coater ${row.coater_roll_tag_number}` : "",
    row.finished_inventory_name,
  ].filter(Boolean).join(" / ") || getRecordTitle(row);
}

function summary(rows) {
  return rows.reduce((acc, row) => {
    const qty = Number(row.quantity ?? 0);
    if (!Number.isFinite(qty)) return acc;
    const unit = row.unit || "lf";
    acc.total += qty;
    acc.units.add(unit);
    acc.byType[row.usage_type] = (acc.byType[row.usage_type] ?? 0) + qty;
    return acc;
  }, { total: 0, units: new Set(), byType: {} });
}

export default function MaterialUsageWindow({ title, rows, onClose }) {
  const totals = summary(rows);
  const largest = Math.max(...rows.map((row) => Number(row.quantity ?? 0)).filter(Number.isFinite), 1);
  const unitText = Array.from(totals.units).join(", ") || "lf";

  return (
    <section className="usage-overlay" role="dialog" aria-modal="true" aria-label="Material usage">
      <div className="usage-window compact-card">
        <header className="usage-window-head">
          <div>
            <p className="eyebrow">Material Usage</p>
            <h2>{title}</h2>
          </div>
          <button className="ghost-btn" type="button" onClick={onClose}><X size={16} /> Close</button>
        </header>

        <div className="usage-stats">
          <div><span>Total Used</span><strong>{totals.total.toLocaleString()} {unitText}</strong></div>
          <div><span>Records</span><strong>{rows.length}</strong></div>
          <div><span>Types</span><strong>{Object.keys(totals.byType).map(labelize).join(", ") || "--"}</strong></div>
        </div>

        <div className="usage-chart">
          {rows.length ? rows.map((row) => {
            const qty = Number(row.quantity ?? 0);
            const width = `${Math.max(5, Math.round((qty / largest) * 100))}%`;
            return (
              <article className="usage-bar-row" key={row.id}>
                <div>
                  <strong>{usageTitle(row)}</strong>
                  <span>{[formatCell(row, "used_date"), labelize(row.usage_type), row.used_by].filter(Boolean).join(" / ")}</span>
                </div>
                <div className="usage-bar-track" aria-hidden="true"><span style={{ width }} /></div>
                <em>{qty.toLocaleString()} {row.unit}</em>
              </article>
            );
          }) : (
            <div className="usage-empty">
              <BarChart3 size={26} />
              <strong>No usage recorded yet.</strong>
              <span>Consumption entries will appear here once material is used.</span>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
