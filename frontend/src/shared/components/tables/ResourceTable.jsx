import { formatCell } from "../../../lib/format";

function columnLabel(resource, column) {
  const friendlyLabels = {
    recipe: "Label Layout",
    recipe_name: "Label Layout",
    recipe_option: "Press Setup Option",
    recipe_option_name: "Press Setup Option",
    master_type_code: "Material Type",
    allowed_face_material_summary: "Face",
    allowed_liner_material_summary: "Liner",
    allowed_adhesive_material_summary: "Adhesive",
    allowed_silicone_material_summary: "Silicone",
    allowed_coating_material_summary: "Coating",
  };
  if (friendlyLabels[column]) return friendlyLabels[column];
  if (column === "inventory_total_feet") return "Inventory Feet";
  const field = (resource.fields ?? []).find((item) => item.name === column);
  return field?.label ?? column.replace(/_/g, " ");
}

export default function ResourceTable({ resource, rows, selectedId, onSelect, rowActions = [] }) {
  const columns = resource.columns ?? ["name"];
  const hasActions = rowActions.length > 0;

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className={`col-${column}`}>{columnLabel(resource, column)}</th>
            ))}
            {hasActions && <th className="col-actions">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              className={selectedId === row.id ? "selected" : ""}
              onClick={() => onSelect(row)}
            >
              {columns.map((column) => (
                <td key={column} className={`col-${column}`} data-label={columnLabel(resource, column)}>{formatCell(row, column) || "--"}</td>
              ))}
              {hasActions && (
                <td className="col-actions" data-label="Actions">
                  <div className="table-row-actions">
                    {rowActions.map((action) => (
                      <button
                        className={action.className || "ghost-btn xs"}
                        type="button"
                        key={action.label}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.onClick(row);
                        }}
                      >
                        {action.label}
                      </button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty-row">No records match this view.</p>}
    </div>
  );
}
