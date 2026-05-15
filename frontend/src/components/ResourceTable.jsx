import { formatCell } from "../lib/format";

function columnLabel(resource, column) {
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
