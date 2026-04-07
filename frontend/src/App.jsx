import { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";

function App() {
  const [listType, setListType] = useState("base");
  const [grid, setGrid] = useState({ columns: [], rows: [] });
  const [loading, setLoading] = useState(false);
  const [savingCell, setSavingCell] = useState(null);
  const [effectiveDate, setEffectiveDate] = useState(new Date().toISOString().slice(0, 10));
  const [increasePercent, setIncreasePercent] = useState(0);
  const cellRefs = useRef({});

  const columnIndexByKey = useMemo(
    () => Object.fromEntries(grid.columns.map((c, i) => [c.key, i])),
    [grid.columns]
  );

  const loadGrid = async () => {
    setLoading(true);
    const res = await fetch(`${API_BASE}/grid?listType=${encodeURIComponent(listType)}`);
    const json = await res.json();
    setGrid(json);
    setLoading(false);
  };

  useEffect(() => {
    loadGrid();
  }, [listType]);

  const saveCell = async (row, col, nextPrice) => {
    const parsed = Number(nextPrice);
    if (Number.isNaN(parsed)) return;
    setSavingCell(`${row.client.id}:${col.key}`);
    await fetch(`${API_BASE}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientId: row.client.id,
        productId: col.productId,
        formatId: col.formatId,
        price: parsed,
        effectiveDate
      })
    });
    await loadGrid();
    setSavingCell(null);
  };

  const handleKeyNav = (event, rowIndex, colIndex) => {
    const next =
      event.key === "ArrowRight"
        ? [rowIndex, colIndex + 1]
        : event.key === "ArrowLeft"
          ? [rowIndex, colIndex - 1]
          : event.key === "ArrowDown" || event.key === "Enter"
            ? [rowIndex + 1, colIndex]
            : event.key === "ArrowUp"
              ? [rowIndex - 1, colIndex]
              : null;

    if (!next) return;
    event.preventDefault();
    const [nr, nc] = next;
    const key = `${nr}:${nc}`;
    if (cellRefs.current[key]) {
      cellRefs.current[key].focus();
      cellRefs.current[key].select();
    }
  };

  const applyIncrease = async () => {
    await fetch(`${API_BASE}/increase`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listType,
        percentage: Number(increasePercent),
        effectiveDate
      })
    });
    await loadGrid();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Price Management</p>
          <h1>Price Matrix</h1>
        </div>
        <div className="chip">{grid.rows.length} clients</div>
      </header>

      <section className="control-panel">
        <label className="field">
          <span>List type</span>
          <select value={listType} onChange={(e) => setListType(e.target.value)}>
            <option value="base">Base</option>
            <option value="mas_impuestos">Mas Impuestos</option>
          </select>
        </label>

        <label className="field">
          <span>Effective date</span>
          <input type="date" value={effectiveDate} onChange={(e) => setEffectiveDate(e.target.value)} />
        </label>

        <label className="field">
          <span>Increase %</span>
          <input
            type="number"
            step="0.1"
            value={increasePercent}
            onChange={(e) => setIncreasePercent(e.target.value)}
          />
        </label>

        <button className="primary-btn" onClick={applyIncrease}>Apply Increase</button>
      </section>

      <section className="sheet-panel">
        <div className="sheet-head">
          <h2>Editable Price Grid</h2>
          <p>Use arrows/enter to move. Changes save on blur.</p>
        </div>

        {savingCell && <div className="saving-indicator">Saving changes...</div>}

        {loading ? (
          <p className="loading">Loading grid...</p>
        ) : (
          <div className="grid-wrap">
            <table className="sheet">
              <thead>
                <tr>
                  <th className="sticky-col">Client</th>
                  {grid.columns.map((col) => (
                    <th key={col.key}>{col.product} / {col.format}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row, rowIndex) => (
                  <tr
                    key={row.client.id}
                    className={row.client.name.toLowerCase().includes("vip") ? "important-row" : ""}
                  >
                    <td className="sticky-col">{row.client.name}</td>
                    {grid.columns.map((col) => {
                      const colIndex = columnIndexByKey[col.key];
                      const cell = row.cells[col.key];
                      const key = `${rowIndex}:${colIndex}`;
                      const activeSave = savingCell === `${row.client.id}:${col.key}`;
                      return (
                        <td key={col.key} className={activeSave ? "cell-saving" : ""}>
                          <input
                            ref={(el) => (cellRefs.current[key] = el)}
                            defaultValue={cell?.price ?? ""}
                            onBlur={(e) => saveCell(row, col, e.target.value)}
                            onKeyDown={(e) => handleKeyNav(e, rowIndex, colIndex)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

export default App;
