import { formatCell, getRecordTitle } from "../lib/format";

export default function ResourceTable({ resource, rows, selectedId, onSelect }) {
  const columns = resource.columns ?? ["name"];

  return (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => <th key={col}>{col.replace(/_/g, " ")}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className={selectedId === row.id ? "selected" : ""} onClick={() => onSelect(row)}>
              {columns.map((col, index) => (
                <td key={col} title={String(formatCell(row, col))}>
                  {index === 0 ? <strong>{formatCell(row, col) || getRecordTitle(row)}</strong> : formatCell(row, col)}
                </td>
              ))}
            </tr>
          ))}
          {!rows.length && (
            <tr>
              <td colSpan={columns.length} className="empty-row">No records match this view.</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
