import React from "react";

export default function GameView({ onDragOver, onDrop, occupiedCells = new Set(), shipPositions = {}, isOpponent = false }) {
  return (
    <div className="game-view-container">
      {[...Array(10).keys()].map((i) =>
        [...Array(10).keys()].map((j) => {
          const cellKey = `${i}-${j}`;
          const isOccupied = occupiedCells.has(cellKey);
          const isShip = !isOpponent && Object.values(shipPositions).some(coords => coords.some(([row, col]) => `${row}-${col}` === cellKey));
          return (
            <div
              key={cellKey}
              className={`game-cell ${isOccupied ? "occupied" : ""} ${isShip ? "ship" : ""}`}
              data-index={i * 10 + j}
              onDragOver={onDragOver}
              onDrop={onDrop}
            />
          );
        })
      )}
    </div>
  );
}