import { useMemo, useState } from "react";
import Button from "./Button";
import { EmptyState, Spinner } from "./Feedback";

function readValue(row, column) {
  if (typeof column.accessor === "function") {
    return column.accessor(row);
  }
  return row?.[column.accessor || column.id];
}

export default function DataTable({
  columns = [],
  rows = [],
  getRowId = (row, index) => row?.id || index,
  isLoading = false,
  emptyTitle = "No records found",
  emptyDescription,
  sort,
  onSort,
  pagination,
  actionsLabel = "Actions",
  renderActions,
  className = "",
  caption,
}) {
  const [internalSort, setInternalSort] = useState(null);
  const activeSort = sort || internalSort;
  const sortedRows = useMemo(() => {
    if (onSort || !activeSort?.columnId) {
      return rows;
    }
    const column = columns.find((item) => item.id === activeSort.columnId);
    if (!column) {
      return rows;
    }
    const direction = activeSort.direction === "desc" ? -1 : 1;
    return [...rows].sort((left, right) =>
      String(readValue(left, column) ?? "").localeCompare(
        String(readValue(right, column) ?? ""),
        undefined,
        { numeric: true }
      ) * direction
    );
  }, [activeSort, columns, onSort, rows]);

  function handleSort(column) {
    const nextSort = {
      columnId: column.id,
      direction:
        activeSort?.columnId === column.id && activeSort.direction === "asc"
          ? "desc"
          : "asc",
    };
    if (onSort) {
      onSort(nextSort);
    } else {
      setInternalSort(nextSort);
    }
  }

  if (isLoading) {
    return (
      <div className="ui-card ui-card--loading ui-empty-state" aria-busy="true">
        <Spinner label="Loading table" />
        <span>Loading records…</span>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="ui-card ui-card--empty">
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  return (
    <div className={className}>
      <div className="ui-table-shell">
        <table className="ui-table ui-table--responsive">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.id}
                  scope="col"
                  aria-sort={
                    column.sortable && activeSort?.columnId === column.id
                      ? activeSort.direction === "desc"
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                >
                  {column.sortable ? (
                    <button
                      type="button"
                      className="ui-table__sort"
                      onClick={() => handleSort(column)}
                    >
                      {column.header}
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              ))}
              {renderActions ? <th scope="col">{actionsLabel}</th> : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIndex) => (
              <tr key={getRowId(row, rowIndex)}>
                {columns.map((column) => (
                  <td key={column.id} data-label={column.header}>
                    {column.cell
                      ? column.cell(row)
                      : String(readValue(row, column) ?? "")}
                  </td>
                ))}
                {renderActions ? (
                  <td data-label={actionsLabel}>{renderActions(row)}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination ? (
        <nav className="ui-table-pagination" aria-label="Table pagination">
          <span>
            Page {pagination.page} of {Math.max(pagination.pages, 1)}
          </span>
          <div className="ui-modal__actions">
            <Button
              size="sm"
              variant="secondary"
              disabled={pagination.page <= 1}
              onClick={() => pagination.onPageChange(pagination.page - 1)}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={pagination.page >= pagination.pages}
              onClick={() => pagination.onPageChange(pagination.page + 1)}
            >
              Next
            </Button>
          </div>
        </nav>
      ) : null}
    </div>
  );
}
