export const suits = ["spades", "hearts", "clubs", "diamonds"] as const;
export type Suit = (typeof suits)[number];
export interface Card {
  suit: Suit;
  rank: number;
}
export interface Column {
  down: Card[];
  up: Card[];
}
export interface Board {
  stock: Card[];
  waste: Card[];
  tableau: Column[];
  foundations: Card[][];
  revealed: number;
}
export interface BoardView {
  stockCount: number;
  waste: Card | null;
  tableau: { hidden: number; cards: Card[] }[];
  foundations: Card[][];
  revealed: number;
  score: number;
}
export type Source =
  | { type: "waste" }
  | { type: "tableau"; column: number; index: number };
export type Destination = { type: "tableau" | "foundation"; column: number };
export type CardAction =
  | { type: "draw" }
  | { type: "move"; from: Source; to: Destination };
export const red = (c: Card) => c.suit === "hearts" || c.suit === "diamonds";
export const score = (b: Board) =>
  b.foundations.reduce((n, f) => n + f.length, 0);
export function orderedDeck(): Card[] {
  return suits.flatMap((suit) =>
    Array.from({ length: 13 }, (_, i) => ({ suit, rank: i + 1 })),
  );
}
export function deal(deck: Card[]): Board {
  if (
    deck.length !== 52 ||
    new Set(deck.map((c) => `${c.suit}:${c.rank}`)).size !== 52 ||
    deck.some((c) => !suits.includes(c.suit) || c.rank < 1 || c.rank > 13)
  )
    throw new Error("Нужна стандартная колода");
  const cards = deck.map((c) => ({ ...c }));
  const tableau = Array.from({ length: 7 }, (_, i) => {
    const part = cards.splice(0, i + 1);
    return { down: part.slice(0, -1), up: part.slice(-1) };
  });
  return {
    stock: cards,
    waste: [],
    tableau,
    foundations: [[], [], [], []],
    revealed: 0,
  };
}
// Only this explicit projection may cross the network. No hidden card identifiers or seeds.
export function boardView(b: Board): BoardView {
  return {
    stockCount: b.stock.length,
    waste: b.waste.at(-1) ?? null,
    tableau: b.tableau.map((c) => ({
      hidden: c.down.length,
      cards: c.up.map((v) => ({ ...v })),
    })),
    foundations: b.foundations.map((f) => f.map((c) => ({ ...c }))),
    revealed: b.revealed,
    score: score(b),
  };
}
export function selectedCards(b: BoardView, from: Source): Card[] {
  if (from.type === "waste") return b.waste ? [b.waste] : [];
  if (
    !Number.isInteger(from.column) ||
    !Number.isInteger(from.index) ||
    from.index < 0
  )
    return [];
  return b.tableau[from.column]?.cards.slice(from.index) ?? [];
}
export function canMove(b: BoardView, from: Source, to: Destination): boolean {
  if (!Number.isInteger(to.column) || to.column < 0) return false;
  const cards = selectedCards(b, from),
    first = cards[0];
  if (
    !first ||
    cards.some(
      (c, i) =>
        i > 0 &&
        (cards[i - 1].rank !== c.rank + 1 || red(cards[i - 1]) === red(c)),
    )
  )
    return false;
  if (to.type === "foundation") {
    const f = b.foundations[to.column];
    return (
      !!f &&
      cards.length === 1 &&
      first.suit === suits[to.column] &&
      first.rank === f.length + 1
    );
  }
  const target = b.tableau[to.column];
  if (!target || (from.type === "tableau" && from.column === to.column))
    return false;
  const top = target.cards.at(-1);
  return top
    ? top.rank === first.rank + 1 && red(top) !== red(first)
    : target.hidden === 0 && first.rank === 13;
}
export function automaticDestination(
  board: BoardView,
  from: Source,
): Destination | null {
  const foundation = suits
    .map((_, column): Destination => ({ type: "foundation", column }))
    .find((to) => canMove(board, from, to));
  if (foundation) return foundation;
  const tableau = board.tableau
    .map((_, column): Destination => ({ type: "tableau", column }))
    .filter((to) => canMove(board, from, to));
  return tableau.length === 1 ? tableau[0] : null;
}
export function canAutoFinish(board: Board): boolean {
  return (
    board.stock.length === 0 &&
    board.tableau.every((column) => column.down.length === 0)
  );
}

// Auto-finish is only entered after every hidden card has been revealed. At that
// point the result is fixed, so cards can be presented in foundation order
// without running a solver or exposing any hidden information to the client.
export function autoFoundationBatch(board: Board, limit = 4): Board | null {
  const next: Board = structuredClone(board);
  let moved = 0;
  const take = (suit: Suit, rank: number): Card | null => {
    const waste = next.waste.findIndex(
      (card) => card.suit === suit && card.rank === rank,
    );
    if (waste >= 0) return next.waste.splice(waste, 1)[0];
    const stock = next.stock.findIndex(
      (card) => card.suit === suit && card.rank === rank,
    );
    if (stock >= 0) return next.stock.splice(stock, 1)[0];
    for (const column of next.tableau) {
      const index = column.up.findIndex(
        (card) => card.suit === suit && card.rank === rank,
      );
      if (index >= 0) return column.up.splice(index, 1)[0];
    }
    return null;
  };
  for (let column = 0; column < suits.length && moved < limit; column++) {
    const rank = next.foundations[column].length + 1;
    if (rank > 13) continue;
    const card = take(suits[column], rank);
    if (!card) continue;
    next.foundations[column].push(card);
    moved++;
  }
  return moved ? next : null;
}
export function applyAction(board: Board, action: CardAction): Board | null {
  if (
    action.type === "move" &&
    !canMove(boardView(board), action.from, action.to)
  )
    return null;
  if (
    action.type === "draw" &&
    board.stock.length === 0 &&
    board.waste.length === 0
  )
    return null;
  const b: Board = structuredClone(board);
  if (action.type === "draw") {
    if (b.stock.length) b.waste.push(b.stock.pop()!);
    else {
      b.stock = b.waste.reverse();
      b.waste = [];
    }
    return b;
  }
  const cards =
    action.from.type === "waste"
      ? [b.waste.pop()!]
      : b.tableau[action.from.column].up.splice(action.from.index);
  if (action.to.type === "foundation")
    b.foundations[action.to.column].push(...cards);
  else b.tableau[action.to.column].up.push(...cards);
  if (action.from.type === "tableau") {
    const col = b.tableau[action.from.column];
    if (!col.up.length && col.down.length) {
      col.up.push(col.down.pop()!);
      b.revealed++;
    }
  }
  return b;
}
