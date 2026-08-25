import { Edit3, Factory, Gauge, MapPin, Palette, Printer, Scissors, Trash2 } from "lucide-react";

function value(value, fallback = "--") {
  return value === null || value === undefined || value === "" ? fallback : value;
}

function Capability({ icon: Icon, label, active }) {
  return (
    <span className={active ? "active" : ""}>
      <Icon size={14} />
      {label}
    </span>
  );
}

export default function PressTable({ rows, onEdit, onDelete }) {
  return (
    <div className="press-main-table">
      <div className="press-table-head" aria-hidden="true">
        <span>Press</span>
        <span>Production Setup</span>
        <span>Printer</span>
        <span>Actions</span>
      </div>

      {rows.map((row) => (
        <article className={`press-table-row ${row.is_active === false ? "inactive" : ""}`} key={row.id}>
          <div className="press-identity">
            <span className="press-table-icon"><Factory size={18} /></span>
            <div>
              <strong>{row.name}</strong>
              <span><MapPin size={13} /> {row.location_full_path || row.location_name || "No location assigned"}</span>
            </div>
            <b>{row.is_active === false ? "Inactive" : "Active"}</b>
          </div>

          <div className="press-production">
            <div>
              <span>Colors</span>
              <strong>{value(row.color_count, 0)}</strong>
            </div>
            <div>
              <span>Die Stations</span>
              <strong>{value(row.die_station_count, 0)}</strong>
            </div>
            <div>
              <span>Max Web</span>
              <strong>{row.max_web_width_inches ? `${row.max_web_width_inches}"` : "--"}</strong>
            </div>
            <section aria-label="Capabilities">
              <Capability icon={Palette} label="Digital" active={row.has_digital_print} />
              <Capability icon={Gauge} label="Undercut" active={row.has_undercut_capability} />
              <Capability icon={Scissors} label="Perf" active={row.has_perf_capability} />
            </section>
          </div>

          <div className={`press-printer ${row.printer_ip ? "ready" : ""}`}>
            <Printer size={17} />
            <div>
              <span>{row.printer_ip ? "Printer Ready" : "Printer Not Set"}</span>
              <strong>{row.printer_ip ? `${row.printer_ip}:${row.printer_port || 9100}` : "Add printer settings"}</strong>
              {row.printer_ip && <small>Speed {row.printer_speed || 5} / Darkness {row.printer_darkness || 11}</small>}
            </div>
          </div>

          <div className="press-table-actions">
            <button className="primary-btn xs" type="button" onClick={() => onEdit(row)}>
              <Edit3 size={14} /> Edit
            </button>
            {onDelete && (
              <button className="danger-btn xs" type="button" onClick={() => onDelete(row)}>
                <Trash2 size={14} /> Delete
              </button>
            )}
          </div>
        </article>
      ))}

      {!rows.length && <p className="empty-row">No presses match this view.</p>}
    </div>
  );
}
