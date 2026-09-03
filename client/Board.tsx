import { useEffect, useState } from "react";
import {
  canMove,
  red,
  suits,
  type BoardView,
  type Card,
  type CardAction,
  type Source,
  type Destination,
} from "../shared/solitaire.js";
export const symbols = {
  spades: "♠",
  hearts: "♥",
  clubs: "♣",
  diamonds: "♦",
};
const suitNames = {
  spades: "пик",
  hearts: "червей",
  clubs: "треф",
  diamonds: "бубен",
};
const rank = (r: number) =>
  ({ 1: "A", 11: "J", 12: "Q", 13: "K" })[r] ?? String(r);
export function PlayingCard({
  card,
  small = false,
}: {
  card: Card;
  small?: boolean;
}) {
  return (
    <span
      className={`playing-card ${red(card) ? "red" : "black"} ${small ? "small" : ""}`}
    >
      <span className="card-corner">
        {rank(card.rank)}
        <b>{symbols[card.suit]}</b>
      </span>
      <span className="card-suit">{symbols[card.suit]}</span>
      <span className="card-corner bottom">
        {rank(card.rank)}
        <b>{symbols[card.suit]}</b>
      </span>
    </span>
  );
}
export function Board({
  board,
  readonly = false,
  disabled = false,
  revision,
  errorId,
  onAction,
}: {
  board: BoardView;
  readonly?: boolean;
  disabled?: boolean;
  revision: number;
  errorId: number;
  onAction?: (action: CardAction) => void;
}) {
  const [selected, setSelected] = useState<Source | null>(null),
    [rejected, setRejected] = useState(false);
  useEffect(() => setSelected(null), [revision]);
  useEffect(() => {
    if (!errorId) return;
    setRejected(true);
    const t = setTimeout(() => setRejected(false), 500);
    return () => clearTimeout(t);
  }, [errorId]);
  const interactive = !readonly && !disabled;
  function choose(from: Source) {
    if (!interactive) return;
    setSelected((old) =>
      JSON.stringify(old) === JSON.stringify(from) ? null : from,
    );
  }
  function move(to: Destination, from = selected) {
    if (!interactive || !from) return;
    onAction?.({ type: "move", from, to });
  }
  function drop(event: React.DragEvent, to: Destination) {
    event.preventDefault();
    if (!interactive) return;
    try {
      const raw = event.dataTransfer.getData("application/x-solitaire");
      if (raw) {
        const data = JSON.parse(raw);
        if (data.origin === "own") move(to, data.from);
      }
    } catch {
      /* Foreign drags are ignored. */
    }
  }
  const targetClass = (to: Destination) =>
    interactive && selected && canMove(board, selected, to)
      ? " legal-target"
      : "";
  function handlers(from: Source) {
    return {
      draggable: interactive,
      onDragStart: (event: React.DragEvent) => {
        if (!interactive) {
          event.preventDefault();
          return;
        }
        setSelected(from);
        event.dataTransfer.setData(
          "application/x-solitaire",
          JSON.stringify({ origin: "own", from }),
        );
        event.dataTransfer.effectAllowed = "move";
      },
    };
  }
  return (
    <div
      className={`solitaire-board ${readonly ? "opponent-board" : ""} ${rejected ? "rejected" : ""} ${disabled ? "board-waiting" : ""}`}
      onKeyDown={(e) => {
        if (e.key === "Escape") setSelected(null);
      }}
    >
      <div className="board-top">
        <button
          className={`card-slot stock ${board.stockCount ? "card-back" : ""}`}
          disabled={!interactive}
          onClick={() => {
            setSelected(null);
            onAction?.({ type: "draw" });
          }}
          aria-label={board.stockCount ? "Взять карту" : "Перевернуть сброс"}
        >
          <span>{board.stockCount ? "♠" : "↻"}</span>
          <small>{board.stockCount || "Снова"}</small>
        </button>
        <button
          className={`card-slot waste ${selected?.type === "waste" ? "selected" : ""}`}
          disabled={!interactive || !board.waste}
          onClick={() => choose({ type: "waste" })}
          aria-label="Карта сброса"
          {...handlers({ type: "waste" })}
        >
          {board.waste ? (
            <PlayingCard card={board.waste} />
          ) : (
            <span className="slot-label">Сброс</span>
          )}
        </button>
        <div />
        {suits.map((suit, column) => (
          <button
            key={suit}
            aria-label={`Основание ${suitNames[suit]}`}
            className={`card-slot foundation${targetClass({ type: "foundation", column })}`}
            disabled={!interactive}
            onClick={() => move({ type: "foundation", column })}
            onDragOver={(e) => {
              if (interactive) e.preventDefault();
            }}
            onDrop={(e) => drop(e, { type: "foundation", column })}
          >
            {board.foundations[column].length ? (
              <PlayingCard card={board.foundations[column].at(-1)!} />
            ) : (
              <span
                className={
                  suit === "hearts" || suit === "diamonds" ? "red" : ""
                }
              >
                {symbols[suit]}
                <small>A → K</small>
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="tableau">
        {board.tableau.map((col, column) => {
          const target: Destination = { type: "tableau", column };
          return (
            <div
              className={`tableau-column${targetClass(target)}`}
              key={column}
              style={{
                minHeight: `calc(var(--card-h) + ${(col.hidden + Math.max(0, col.cards.length - 1)) * 1} * var(--overlap))`,
              }}
              onDragOver={(e) => {
                if (interactive) e.preventDefault();
              }}
              onDrop={(e) => drop(e, target)}
            >
              <button
                className="card-slot empty-column"
                aria-label={`Столбец ${column + 1}`}
                disabled={!interactive}
                onClick={() => move(target)}
              >
                K
              </button>
              {Array.from({ length: col.hidden }, (_, i) => (
                <div
                  className="tableau-card card-back hidden-card"
                  key={`hidden-${i}`}
                  style={{ top: `calc(${i} * var(--overlap))` }}
                  aria-label="Закрытая карта"
                />
              ))}
              {col.cards.map((card, index) => {
                const from: Source = { type: "tableau", column, index };
                const isSelected =
                  selected?.type === "tableau" &&
                  selected.column === column &&
                  selected.index <= index;
                return (
                  <button
                    key={`${card.suit}-${card.rank}`}
                    className={`tableau-card ${isSelected ? "selected" : ""}`}
                    style={{
                      top: `calc(${col.hidden + index} * var(--overlap))`,
                    }}
                    disabled={!interactive}
                    aria-label={`${rank(card.rank)} ${suitNames[card.suit]}, столбец ${column + 1}`}
                    {...handlers(from)}
                    onClick={() => {
                      if (
                        selected &&
                        !(
                          selected.type === "tableau" &&
                          selected.column === column
                        )
                      )
                        move(target);
                      else choose(from);
                    }}
                  >
                    <PlayingCard card={card} />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
