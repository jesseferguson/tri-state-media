import { AlertTriangle, Edit3, Eye, Image as ImageIcon, Trash2 } from "lucide-react";
import { formatInches, getRecordTitle, labelize } from "../../../lib/format";

function numberValue(value) {
  const next = Number(value ?? 0);
  return Number.isFinite(next) ? next : 0;
}

function countTone(die) {
  const active = numberValue(die?.active_die_count);
  const target = numberValue(die?.target_die_count);
  if (active < 1) return "bad";
  if (target && active < target) return "warn";
  return "ready";
}

function countText(die) {
  return `${numberValue(die.active_die_count)} active / ${numberValue(die.target_die_count)} target`;
}

function optionalLabel(value) {
  if (value === null || value === undefined || value === "") return "";
  return labelize(value);
}

function specChip(label, value) {
  return value || value === 0 ? (
    <span key={label}>
      <em>{label}</em>
      <strong>{value}</strong>
    </span>
  ) : null;
}

function DetailStack({ children }) {
  return <div className="flex-die-stack">{children}</div>;
}

export default function FlexDieTable({ rows, selectedId, onOpen, onEdit, onDelete }) {
  if (!rows.length) return <p className="empty-row">No flex dies match this view.</p>;

  return (
    <div className="flex-die-table-wrap">
      <table className="flex-die-table">
        <thead>
          <tr>
            <th>Die Jacket</th>
            <th>Count</th>
            <th>Layout</th>
            <th>Gear</th>
            <th>Material</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((die) => {
            const tone = countTone(die);
            const belowTarget = tone !== "ready";
            const imageUrl = die.dieline_image_url || die.dieline_image;
            return (
              <tr
                key={die.id}
                className={`${selectedId === die.id ? "selected" : ""} ${tone}`}
                onClick={() => onOpen(die)}
              >
                <td data-label="Die Jacket">
                  <div className="flex-die-main-cell">
                    <div>
                      <strong>{getRecordTitle(die)}</strong>
                      <span>{die.original_serial_number ? `Serial ${die.original_serial_number}` : "No original serial"}</span>
                    </div>
                    {imageUrl ? <small><ImageIcon size={12} /> Dieline</small> : <small className="muted-chip">No image</small>}
                  </div>
                </td>
                <td data-label="Count">
                  <DetailStack>
                    <span className={`flex-die-count-status ${tone}`}>
                      {belowTarget && <AlertTriangle size={13} />}
                      {countText(die)}
                    </span>
                    {belowTarget && <small className="flex-die-warning-text">{tone === "bad" ? "Needs die" : "Below target"}</small>}
                  </DetailStack>
                </td>
                <td data-label="Layout">
                  <div className="flex-die-spec-row">
                    {[
                      specChip("Size", `${formatInches(die.label_width_inches)} x ${formatInches(die.label_length_inches)}`),
                      specChip("Across", die.number_across || "--"),
                      specChip("Around", die.number_around || "--"),
                      specChip("Web", formatInches(die.web_width_inches)),
                    ]}
                  </div>
                </td>
                <td data-label="Gear">
                  <DetailStack>
                    <strong>{die.gear ? `${die.gear}T` : "--"}</strong>
                    <span>Repeat {formatInches(die.repeat_inches)}</span>
                    <span>Gap {formatInches(die.gap_across_inches)}</span>
                  </DetailStack>
                </td>
                <td data-label="Material">
                  <DetailStack>
                    <strong>{[optionalLabel(die.face_type), die.liner_type].filter(Boolean).join(" / ") || "--"}</strong>
                    <span>{[optionalLabel(die.shape_type), optionalLabel(die.cutting_type)].filter(Boolean).join(" / ") || "--"}</span>
                  </DetailStack>
                </td>
                <td data-label="Status">
                  <DetailStack>
                    <span className={`flex-die-status-tag ${die.status || "in_stock"}`}>{labelize(die.status)}</span>
                    <span>{die.current_location_full_path || die.current_location_name || "--"}</span>
                  </DetailStack>
                </td>
                <td data-label="Actions">
                  <div className="flex-die-row-actions">
                    <button className="ghost-btn xs" type="button" onClick={(event) => { event.stopPropagation(); onOpen(die); }}>
                      <Eye size={13} /> View
                    </button>
                    <button className="ghost-btn xs" type="button" onClick={(event) => { event.stopPropagation(); onEdit(die); }}>
                      <Edit3 size={13} /> Edit
                    </button>
                    <button className="danger-btn xs" type="button" onClick={(event) => { event.stopPropagation(); onDelete(die); }}>
                      <Trash2 size={13} /> Delete
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
