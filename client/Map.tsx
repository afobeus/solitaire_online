import { useEffect, useRef } from "react";
import type { Command, MatchView } from "../shared/protocol.js";
import { itemInfo } from "../shared/protocol.js";
import { timeLeft } from "./network.js";
const directionKeys: Record<string, "up" | "down" | "left" | "right"> = {
  KeyW: "up",
  ArrowUp: "up",
  KeyS: "down",
  ArrowDown: "down",
  KeyA: "left",
  ArrowLeft: "left",
  KeyD: "right",
  ArrowRight: "right",
};
export function ArenaMap({
  match,
  now,
  send,
  enabled,
}: {
  match: MatchView;
  now: number;
  send: (c: Command) => void;
  enabled: boolean;
}) {
  const { map, self } = match,
    lastMove = useRef(0);
  useEffect(() => {
    function key(event: KeyboardEvent) {
      const element = event.target as HTMLElement;
      if (document.querySelector('[role="dialog"]')) return;
      if (
        element.closest(
          'input,textarea,select,[contenteditable="true"],[role="dialog"]',
        ) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const direction = directionKeys[event.code];
      if (!direction || !enabled || self.status !== "free" || map.final) return;
      event.preventDefault();
      if (Date.now() - lastMove.current < map.moveMs + 10) return;
      lastMove.current = Date.now();
      send({ type: "move", direction });
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [enabled, self.status, map.final, map.moveMs, send]);
  const spectating = self.status === "eliminated";
  return (
    <section className="arena-panel">
      <div className="panel-heading">
        <span className="eyebrow">
          {spectating ? "Наблюдение" : "Сектор 01 · Арена"}
        </span>
        <span className="muted">
          {map.size} × {map.size}
        </span>
      </div>
      <div
        className="arena-grid"
        style={{
          gridTemplateColumns: `repeat(${map.size},minmax(0,1fr))`,
          gridTemplateRows: `repeat(${map.size},minmax(0,1fr))`,
        }}
        aria-label="Карта матча"
      >
        {Array.from({ length: map.size * map.size }, (_, index) => {
          const x = index % map.size,
            y = Math.floor(index / map.size),
            outside =
              x < map.inset ||
              y < map.inset ||
              x >= map.size - map.inset ||
              y >= map.size - map.inset;
          const visible =
            spectating ||
            Math.max(Math.abs(self.x - x), Math.abs(self.y - y)) <= map.vision;
          const next = map.nextInset,
            edge =
              next !== null &&
              x >= next &&
              y >= next &&
              x < map.size - next &&
              y < map.size - next &&
              (x === next ||
                y === next ||
                x === map.size - next - 1 ||
                y === map.size - next - 1);
          const players = map.players.filter((p) => p.x === x && p.y === y),
            loot = map.loot.find((l) => l.x === x && l.y === y),
            own = players.find((p) => p.id === self.id),
            battle = players.some((p) => p.status === "duel");
          const label = own
            ? "Вы"
            : battle
              ? "Идёт дуэль"
              : players.map((p) => p.name).join(", ") ||
                (loot
                  ? itemInfo[loot.item].name
                  : outside
                    ? "За пределами зоны"
                    : visible
                      ? "Свободная клетка"
                      : "Неизвестная клетка");
          return (
            <div
              key={index}
              className={`arena-cell ${outside ? "outside" : ""} ${visible ? "visible" : "fog"} ${edge ? "next-zone" : ""} ${own ? "own-cell" : ""}`}
              title={`${x + 1}:${y + 1} · ${label}`}
              aria-label={`${x + 1}:${y + 1} · ${label}`}
            >
              {battle ? (
                <span className="battle-marker">⚔</span>
              ) : players.length > 0 ? (
                <span
                  className={`player-token ${own ? "own" : "enemy"} ${players.some((p) => p.protected) ? "protected" : ""} ${players.every((p) => !p.connected) ? "disconnected" : ""}`}
                >
                  {own ? "♠" : players[0].name.slice(0, 1).toUpperCase()}
                </span>
              ) : loot ? (
                <span className={`loot loot-${loot.item}`}>
                  {itemInfo[loot.item].icon}
                </span>
              ) : null}
              {x === 0 && <span className="coordinate">{y + 1}</span>}
            </div>
          );
        })}
      </div>
      <div className="map-footer">
        <div className="keys">
          <kbd>W</kbd>
          <kbd>A</kbd>
          <kbd>S</kbd>
          <kbd>D</kbd>
          <span>или стрелки</span>
        </div>
        <span>Видимость: {map.vision} клетки</span>
      </div>
      {self.outsideDeadline && (
        <div className="zone-warning" role="alert">
          Вернитесь в зону — выбывание через{" "}
          {timeLeft(self.outsideDeadline, now)}
        </div>
      )}
      {map.final && (
        <div className="zone-warning final-zone">
          Финал. Перемещение остановлено — сервер подбирает пары.
        </div>
      )}
    </section>
  );
}
