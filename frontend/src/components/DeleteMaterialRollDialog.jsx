import { AlertTriangle, Trash2, X } from "lucide-react";

function rollName(roll) {
  return roll?.serial_number
    || roll?.tag_number
    || roll?.source_roll_tag_number
    || roll?.lot_number
    || `Roll ${roll?.id || ""}`;
}

export default function DeleteMaterialRollDialog({
  roll,
  deleting = false,
  error = "",
  detail = "",
  onCancel,
  onConfirm,
}) {
  if (!roll) return null;
  const name = rollName(roll);

  return (
    <section className="material-delete-overlay" role="alertdialog" aria-modal="true" aria-labelledby="material-delete-title">
      <div className="material-delete-window">
        <header>
          <span><AlertTriangle size={24} /></span>
          <button type="button" onClick={onCancel} disabled={deleting} aria-label="Close confirmation"><X size={19} /></button>
        </header>
        <div className="material-delete-copy">
          <p>Permanent inventory removal</p>
          <h2 id="material-delete-title">Remove {name}?</h2>
          <strong>Are you sure?</strong>
          <span>{detail || "This permanently removes the roll from inventory without recording its footage as usage."}</span>
          <small>This cannot be undone.</small>
        </div>
        {error && <div className="material-delete-error">{error}</div>}
        <footer>
          <button className="ghost-btn" type="button" onClick={onCancel} disabled={deleting}>No, Keep Roll</button>
          <button className="danger-btn" type="button" onClick={onConfirm} disabled={deleting}>
            <Trash2 size={17} /> {deleting ? "Removing..." : "Yes, Remove Roll"}
          </button>
        </footer>
      </div>
    </section>
  );
}
