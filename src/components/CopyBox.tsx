"use client";

export function CopyBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="card" style={{ flex: 1, minWidth: 280 }}>
      <div className="small">{label}</div>
      <div className="row" style={{ alignItems: "center", justifyContent: "space-between" }}>
        <div className="mono" style={{ wordBreak: "break-all" }}>{value}</div>
        <button
          className="btn btnSecondary"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
          }}
        >
          Copy
        </button>
      </div>
    </div>
  );
}
