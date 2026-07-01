import { useMemo, useState } from "react";
import { BarChart3, Search, X } from "lucide-react";
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
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const filteredRows = useMemo(() => rows.filter((row) => {
    const date = String(row.used_date || row.created_at || "").slice(0, 10);
    const text = `${row.reference} ${row.coater_roll_tag_number} ${row.production_schedule} ${row.job_ticket_number} ${row.inventory_serial} ${row.used_by} ${row.notes}`.toLowerCase();
    return (!search || text.includes(search.toLowerCase()))
      && (!dateFrom || date >= dateFrom)
      && (!dateTo || date <= dateTo);
  }), [dateFrom, dateTo, rows, search]);
  const totals = summary(filteredRows);
  const largest = Math.max(...filteredRows.map((row) => Number(row.quantity ?? 0)).filter(Number.isFinite), 1);
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
          <div><span>Records</span><strong>{filteredRows.length}</strong></div>
          <div><span>Types</span><strong>{Object.keys(totals.byType).map(labelize).join(", ") || "--"}</strong></div>
        </div>

        <div className="usage-history-filters">
          <label><Search size={15} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search schedule ID, roll, job, or operator" /></label>
          <label><span>From</span><input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} /></label>
          <label><span>To</span><input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} /></label>
        </div>

        <div className="usage-chart">
          {filteredRows.length ? filteredRows.map((row) => {
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
