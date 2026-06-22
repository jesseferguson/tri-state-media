import { formatCell } from "../lib/format";

function columnLabel(resource, column) {
  const friendlyLabels = {
    recipe: "Label Layout",
    recipe_name: "Label Layout",
    recipe_option: "Press Setup Option",
    recipe_option_name: "Press Setup Option",
    allowed_face_material_summary: "Face Types",
    allowed_liner_material_summary: "Liner Types",
    allowed_adhesive_material_summary: "Adhesive Types",
    allowed_silicone_material_summary: "Silicone Types",
    allowed_coating_material_summary: "Coating Types",
  };
  if (friendlyLabels[column]) return friendlyLabels[column];
  if (column === "inventory_total_feet") return "Inventory Feet";
  const field = (resource.fields ?? []).find((item) => item.name === column);
  return field?.label ?? column.replace(/_/g, " ");
}

export default function ResourceTable({ resource, rows, selectedId, onSelect }) {
  const columns = resource.columns ?? ["name"];

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column} className={`col-${column}`}>{columnLabel(resource, column)}</th>
            ))}
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
                <td key={column} className={`col-${column}`}>{formatCell(row, column) || "--"}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="empty-row">No records match this view.</p>}
    </div>
  );
}
