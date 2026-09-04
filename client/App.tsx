import { lazy, Suspense, useEffect, useState, type FormEvent } from "react";
import type {
  Command,
  Item,
  MatchView,
  RoomSummary,
} from "../shared/protocol.js";
import { itemInfo } from "../shared/protocol.js";
import { api, timeLeft, useClock, useGame, type User } from "./network.js";
import { Board, PlayingCard } from "./Board.js";
const ArenaMap = lazy(() =>
  import("./Map.js").then((module) => ({ default: module.ArenaMap })),
);
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">♠</span>
      <div>
        FEBUS<span>SOLITAIRE COLLECTION</span>
      </div>
    </div>
  );
}
function Rules() {
  return (
    <div className="rules-content">
      <p>
        Двигайтесь по арене, подбирайте предметы и оставайтесь в безопасной
        зоне. Встреча на одной клетке начинает дуэль в «Косынку».
      </p>
      <p>
        Соберите основания от туза до короля. В столбцах чередуйте цвета,
        выкладывая карты по убыванию. На пустую клетку можно положить короля.
        Выберите карту кликом, затем цель — или перетащите последовательность.
      </p>
      <p>
        За 6 минут выигрывает собравший больше карт в основаниях. Затем
        сравниваются открытые карты. При ничьей — новый расклад на 30 секунд до
        первого основания. Если очков снова нет, победителя определяет
        жеребьёвка. Решаемость расклада не гарантируется.
      </p>
      <p>
        «Перетасовка» меняет порядок оставшихся карт добора и сброса во время
        дуэли. Двойной клик автоматически отправляет карту в однозначно
        допустимую позицию. В финале оставшиеся игроки встречаются в дуэлях.
      </p>
    </div>
  );
}
function AuthScreen({ onUser }: { onUser: (u: User) => void }) {
  const [mode, setMode] = useState<"login" | "register">("login"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const { user } = await api<{ user: User }>(`auth/${mode}`, {
        username: data.get("username"),
        password: data.get("password"),
      });
      onUser(user);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="auth-layout">
      <section className="auth-intro">
        <Brand />
        <div className="auth-title">
          <span className="eyebrow">2–8 игроков · Одна арена</span>
          <h1>
            Последняя карта.
            <br />
            <em>Последний игрок.</em>
          </h1>
          <p>
            Исследуйте карту. Вступайте в дуэли.
            <br />
            Ваш следующий ход решает всё.
          </p>
        </div>
        <div className="auth-cards" aria-hidden="true">
          <div>
            <PlayingCard card={{ suit: "clubs", rank: 13 }} />
          </div>
          <div>
            <PlayingCard card={{ suit: "hearts", rank: 1 }} />
          </div>
          <div>
            <PlayingCard card={{ suit: "spades", rank: 1 }} />
          </div>
        </div>
        <div className="auth-caption">
          <span className="status-dot" />
          Пасьянс с реальными соперниками
        </div>
      </section>
      <section className="auth-form-panel">
        <div className="auth-form">
          <span className="eyebrow">Добро пожаловать на арену</span>
          <h2>
            {mode === "login" ? "Возвращайтесь в игру" : "Ваш первый ход"}
          </h2>
          <p className="muted">
            {mode === "login"
              ? "Войдите, чтобы присоединиться к матчу."
              : "Создайте аккаунт и пригласите соперника."}
          </p>
          <div className="tabs">
            <button
              className={mode === "login" ? "active" : ""}
              onClick={() => {
                setMode("login");
                setError("");
              }}
            >
              Вход
            </button>
            <button
              className={mode === "register" ? "active" : ""}
              onClick={() => {
                setMode("register");
                setError("");
              }}
            >
              Регистрация
            </button>
          </div>
          <form onSubmit={submit}>
            <label>
              Логин
              <input
                name="username"
                autoComplete="username"
                minLength={3}
                maxLength={24}
                placeholder="Ваш игровой псевдоним"
                required
              />
            </label>
            <label>
              Пароль
              <input
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={8}
                maxLength={128}
                placeholder="Не менее 8 символов"
                required
              />
            </label>
            {error && (
              <p role="alert" className="form-error">
                {error}
              </p>
            )}
            <button className="primary wide" disabled={busy}>
              {busy
                ? "Подключаемся…"
                : mode === "login"
                  ? "Войти в игру →"
                  : "Создать аккаунт →"}
            </button>
          </form>
          <p className="auth-hint">
            Для игры нужен ещё один участник.
            <br />
            Откройте второй аккаунт в другом браузере.
          </p>
          <details>
            <summary>Как играть</summary>
            <Rules />
          </details>
        </div>
      </section>
    </div>
  );
}
function Inventory({
  match,
  send,
  now,
  disabled = false,
}: {
  match: MatchView;
  send: (c: Command) => void;
  now: number;
  disabled?: boolean;
}) {
  return (
    <div className="inventory">
      <div className="panel-heading">
        <span className="eyebrow">Предметы</span>
        <span className="muted">
          {match.self.inventory.length} / {match.self.inventorySize}
        </span>
      </div>
      <div className="inventory-items">
        {Array.from({ length: match.self.inventorySize }, (_, i) => {
          const item = match.self.inventory[i];
          return item ? (
            <button
              className={`item-button item-${item}`}
              key={i}
              title={itemInfo[item].description}
              disabled={
                disabled ||
                (item === "recon" && !!match.duel) ||
                ((item === "peek" || item === "shuffle") && !match.duel)
              }
              onClick={() => send({ type: "item", item })}
            >
              <span>{itemInfo[item].icon}</span>
              <b>{itemInfo[item].name}</b>
              <small>
                {item === "peek"
                    ? "В дуэли"
                    : item === "shuffle"
                      ? "В дуэли"
                    : "На карте"}
              </small>
            </button>
          ) : (
            <div className="item-empty" key={i}>
              <span>+</span>
              <small>Пустой слот</small>
            </div>
          );
        })}
      </div>
      {match.self.reconUntil > now && (
        <small className="green">
          Разведка активна · {timeLeft(match.self.reconUntil, now)}
        </small>
      )}
    </div>
  );
}
function DuelScreen({
  match,
  user,
  now,
  send,
  online,
  errorId,
}: {
  match: MatchView;
  user: User;
  now: number;
  send: (c: Command) => void;
  online: boolean;
  errorId: number;
}) {
  const d = match.duel!,
    countdown = now < d.startAt;
  return (
    <div className="duel-screen">
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            {d.round === 2
              ? "Дополнительный раунд"
              : "Дуэль · Одинаковый расклад"}
          </span>
          <h1>Игра на выбывание</h1>
        </div>
        <div className={`duel-clock ${d.endAt - now < 15000 ? "urgent" : ""}`}>
          <span>{countdown ? "До начала" : "Осталось"}</span>
          <strong>{timeLeft(countdown ? d.startAt : d.endAt, now)}</strong>
        </div>
      </div>
      <div className="duel-inventory">
        <Inventory
          match={match}
          send={send}
          now={now}
          disabled={!online || countdown}
        />
        <p>
          {d.round === 2
            ? "Первая карта в основании принесёт победу."
            : "Собирайте основания. При равном счёте решают открытые карты."}
          <br />
          <span className="muted">Во время дуэли зона не действует.</span>
        </p>
      </div>
      <div className="duel-scroll">
        <div className="duel-fields">
          <section className="board-panel opponent-panel">
            <div className="player-heading">
              <div className="avatar enemy-avatar">{d.opponent.name[0]}</div>
              <div>
                <h3>{d.opponent.name}</h3>
                <span className="muted">
                  Соперник ·{" "}
                  {d.opponent.connected ? "в игре" : "переподключается…"}
                </span>
              </div>
              <div className="score">
                <strong>
                  {d.opponentBoard.score}
                  <small> / 52</small>
                </strong>
                <span>Открыто {d.opponentBoard.revealed} / 21</span>
              </div>
            </div>
            <div className="progress-track">
              <span
                style={{ width: `${(d.opponentBoard.score / 52) * 100}%` }}
              />
            </div>
            <Board
              board={d.opponentBoard}
              readonly
              revision={d.opponentRevision}
              errorId={0}
            />
          </section>
          <section className="board-panel own-panel">
            <div className="player-heading">
              <div className="avatar">♠</div>
              <div>
                <h3>
                  {user.username}
                  <span className="you-tag">Вы</span>
                </h3>
                <span className="muted">Ваше поле</span>
              </div>
              <div className="score">
                <strong>
                  {d.own.score}
                  <small> / 52</small>
                </strong>
                <span>Открыто {d.own.revealed} / 21</span>
              </div>
            </div>
            <div className="progress-track">
              <span style={{ width: `${(d.own.score / 52) * 100}%` }} />
            </div>
            <Board
              board={d.own}
              disabled={!online || countdown || now >= d.endAt}
              revision={d.revision + d.round * 100000}
              errorId={errorId}
              onAction={(action) =>
                send({
                  type: "card",
                  duelId: d.id,
                  round: d.round,
                  revision: d.revision,
                  action,
                })
              }
            />
          </section>
        </div>
      </div>
      {countdown && (
        <div className="countdown-overlay" aria-live="polite">
          <span>Приготовьтесь</span>
          <strong>{Math.ceil((d.startAt - now) / 1000)}</strong>
          <p>Оба поля откроются одновременно</p>
        </div>
      )}
      {d.peek && d.peek.until > now && (
        <div className="peek-strip">
          <span>
            Следующие карты соперника
            <br />
            <small>{timeLeft(d.peek.until, now)} · слева следующая</small>
          </span>
          {d.peek.cards.map((card, i) => (
            <PlayingCard key={i} card={card} small />
          ))}
        </div>
      )}
      <div className="duel-help">
        <span>↗ Перетащите, выберите кликом или сделайте двойной клик для автохода</span>
        <span>Esc — снять выделение · Возврат из оснований запрещён</span>
      </div>
    </div>
  );
}
export function App() {
  const [user, setUser] = useState<User | null>(null),
    [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(""),
    [profile, setProfile] = useState(false),
    [rules, setRules] = useState(false),
    [spectating, setSpectating] = useState(false),
    [confirmLeave, setConfirmLeave] = useState(false);
  const [rooms, setRooms] = useState<RoomSummary[]>([]),
    [roomsError, setRoomsError] = useState(""),
    [roomsLoading, setRoomsLoading] = useState(false);
  const game = useGame(user),
    now = useClock(game.offset),
    { state, status, send } = game,
    match = state.match,
    room = state.room,
    online = status === "online";
  async function loadUser() {
    try {
      const value = await api<{ user: User | null }>("me");
      setUser(value.user);
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void loadUser();
  }, []);
  useEffect(() => {
    setSpectating(false);
  }, [match?.id]);
  useEffect(() => {
    if (match?.result) void loadUser();
  }, [match?.result?.matchId]);
  useEffect(() => {
    if (!user || room || match) return;
    let disposed = false;
    async function refresh() {
      try {
        const data = await api<{ rooms: RoomSummary[] }>("rooms");
        if (!disposed) {
          setRooms(data.rooms);
          setRoomsError("");
        }
      } catch (e) {
        if (!disposed) setRoomsError((e as Error).message);
      } finally {
        if (!disposed) setRoomsLoading(false);
      }
    }
    setRoomsLoading(true);
    void refresh();
    const timer = setInterval(refresh, 5000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [user?.id, !!room, !!match]);
  useEffect(() => {
    if (!game.notice) return;
    const timer = setTimeout(game.dismiss, 8000);
    return () => clearTimeout(timer);
  }, [game.notice?.id]);
  if (loading || loadError)
    return (
      <div className="loading-screen">
        <Brand />
        <h2>{loadError || "Подключаемся к арене…"}</h2>
        {loadError && (
          <button onClick={() => void loadUser()}>Повторить</button>
        )}
      </div>
    );
  if (!user) return <AuthScreen onUser={setUser} />;
  function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    send({
      type: "room.create",
      name: String(data.get("name")),
      limit: Number(data.get("limit")),
    });
  }
  function join(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    send({
      type: "room.join",
      code: String(new FormData(e.currentTarget).get("code")),
    });
  }
  async function logout() {
    try {
      await api("auth/logout", {});
      setUser(null);
      setProfile(false);
    } catch (e) {
      game.notify((e as Error).message, true);
    }
  }
  return (
    <div className="app-shell">
      <header
        className={`app-header ${match && !match.duel && !profile ? "in-match-header" : ""}`}
      >
        <Brand />
        <nav>
          <button
            className={!profile ? "nav-active" : ""}
            onClick={() => setProfile(false)}
          >
            Арена
          </button>
          <button
            className={profile ? "nav-active" : ""}
            onClick={() => {
              setProfile(true);
              void loadUser();
            }}
          >
            Профиль
          </button>
          <button onClick={() => setRules(true)}>Правила</button>
        </nav>
        <div className="header-user">
          <span className={`connection-dot ${online ? "connected" : ""}`} />
          <span>{user.username}</span>
          <div className="mini-avatar">{user.username[0]}</div>
        </div>
      </header>
      {status !== "online" && (
        <div className="connection-banner" role="alert">
          {status === "replaced"
            ? "Игра открыта в другой вкладке."
            : status === "expired"
              ? "Сессия завершена. Войдите снова."
              : status === "connecting"
                ? "Соединяемся с сервером…"
                : "Связь потеряна. Переподключаемся; таймеры матча продолжают идти."}
          {status === "replaced" && (
            <button onClick={game.reconnect}>Вернуть управление</button>
          )}
          {status === "expired" && (
            <button
              onClick={() => {
                setUser(null);
              }}
            >
              Войти
            </button>
          )}
        </div>
      )}
      <main
        className={
          match && !match.duel && !profile
            ? "combat-main"
            : match?.duel && !profile
              ? "wide-main"
              : "main"
        }
      >
        {profile ? (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">Ваш аккаунт</span>
                <h1>{user.username}</h1>
              </div>
              <button onClick={() => setProfile(false)}>
                Вернуться в игру
              </button>
            </div>
            <div className="profile-stats">
              {[
                [user.games, "Матчей сыграно"],
                [user.wins, "Побед в матчах"],
                [user.duelWins, "Побед в дуэлях"],
              ].map(([count, label]) => (
                <div className="stat-card" key={label}>
                  <strong>{count}</strong>
                  <span>{label}</span>
                </div>
              ))}
            </div>
            <p className="muted">
              Статистика обновляется после завершения всего матча.
            </p>
            <button className="danger-button" onClick={() => void logout()}>
              Выйти из аккаунта
            </button>
          </>
        ) : match?.result ? (
          <div className="result-screen">
            <span className="result-icon">
              {match.result.winner === user.id ? "♛" : "♠"}
            </span>
            <span className="eyebrow">Матч завершён</span>
            <h1>
              {match.result.winner === user.id
                ? "Арена ваша."
                : match.result.winnerName
                  ? `Победил ${match.result.winnerName}`
                  : "Матч без победителя"}
            </h1>
            <p className="muted">{match.result.reason}</p>
            <div className="results-table">
              {match.result.players.map((p) => (
                <div key={p.id}>
                  <span
                    className={p.id === match.result!.winner ? "green" : ""}
                  >
                    {p.id === match.result!.winner ? "♛ " : ""}
                    {p.name}
                    {p.id === user.id ? " · Вы" : ""}
                  </span>
                  <span>{p.duelWins} побед в дуэлях</span>
                  <small>{p.reason}</small>
                </div>
              ))}
            </div>
            <button
              className="primary"
              onClick={() => send({ type: "match.leave" })}
            >
              Вернуться в лобби →
            </button>
          </div>
        ) : match?.duel ? (
          <DuelScreen
            match={match}
            user={user}
            now={now}
            send={send}
            online={online}
            errorId={game.notice?.error ? game.notice.id : 0}
          />
        ) : match ? (
          <div className="combat-stage">
            <Suspense
              fallback={
                <div className="arena-loading">
                  <span>♠</span>
                  <strong>РАЗВОРАЧИВАЕМ 3D-АРЕНУ</strong>
                  <small>СИНХРОНИЗАЦИЯ СЕКТОРА…</small>
                </div>
              }
            >
              <ArenaMap match={match} now={now} send={send} />
            </Suspense>
            <button className="hud-exit" onClick={() => setConfirmLeave(true)}>
              ПОКИНУТЬ ОПЕРАЦИЮ <span>↗</span>
            </button>
            <aside className="hud-loadout">
              <Inventory
                match={match}
                send={send}
                now={now}
                disabled={!online || match.self.status === "eliminated"}
              />
            </aside>
            <aside className="hud-squad">
              <div className="hud-panel-heading">
                <span>УЧАСТНИКИ ОПЕРАЦИИ</span>
                <b>{match.alive} / {match.roster.length}</b>
              </div>
              {match.roster.map((p) => (
                <div
                  className={`hud-player ${p.status === "eliminated" ? "eliminated" : ""}`}
                  key={p.id}
                >
                  <span className={`roster-dot ${p.status}`} />
                  <strong>{p.name}{p.id === user.id ? " · ВЫ" : ""}</strong>
                  <small>
                    {p.status === "eliminated"
                      ? "ВЫБЫЛ"
                      : !p.connected
                        ? "НЕТ СВЯЗИ"
                        : p.status === "duel"
                          ? "В БОЮ"
                          : "АКТИВЕН"}
                  </small>
                </div>
              ))}
            </aside>
            {match.self.status === "eliminated" && (
              <div className="hud-spectator">РЕЖИМ НАБЛЮДАТЕЛЯ · {match.alive} БОЙЦОВ ОСТАЛОСЬ</div>
            )}
            {match.self.status === "eliminated" && !spectating && (
              <div className="modal-shade">
                <section
                  className="modal"
                  role="dialog"
                  aria-modal="true"
                  aria-label="Поражение"
                >
                  <span className="result-icon">♠</span>
                  <h2>Этот раунд окончен</h2>
                  <p>{match.self.reason}</p>
                  <p className="muted">
                    Можно остаться и увидеть, кто победит.
                  </p>
                  <div className="button-row">
                    <button
                      className="primary"
                      onClick={() => setSpectating(true)}
                    >
                      Наблюдать
                    </button>
                    <button onClick={() => send({ type: "match.leave" })}>
                      В лобби
                    </button>
                  </div>
                </section>
              </div>
            )}
          </div>
        ) : room ? (
          <>
            <div className="page-heading">
              <div>
                <span className="eyebrow">Комната ожидания</span>
                <h1>{room.name}</h1>
              </div>
              <button onClick={() => send({ type: "room.leave" })}>
                Покинуть комнату
              </button>
            </div>
            <div className="waiting-layout">
              <section className="panel">
                <div className="panel-heading">
                  <h3>Участники</h3>
                  <span className="muted">
                    {room.players.length} / {room.limit}
                  </span>
                </div>
                {room.players.map((p) => (
                  <div className="waiting-player" key={p.id}>
                    <div
                      className={`avatar ${p.id === room.owner ? "" : "neutral-avatar"}`}
                    >
                      {p.id === room.owner ? "♛" : p.name[0]}
                    </div>
                    <div>
                      <strong>
                        {p.name}
                        {p.id === user.id && (
                          <span className="you-tag">Вы</span>
                        )}
                      </strong>
                      <small>
                        {p.id === room.owner ? "Владелец комнаты" : "Участник"}
                      </small>
                    </div>
                    <span className={`ready-state ${p.ready ? "ready" : ""}`}>
                      {!p.connected
                        ? "Нет связи"
                        : p.ready
                          ? "✓ Готов"
                          : "Ожидает"}
                    </span>
                  </div>
                ))}
                {Array.from(
                  { length: room.limit - room.players.length },
                  (_, i) => (
                    <div className="empty-player" key={i}>
                      <span>+</span>Свободное место
                    </div>
                  ),
                )}
              </section>
              <aside className="waiting-sidebar">
                <div className="panel invite-panel">
                  <span className="eyebrow">Пригласите соперника</span>
                  <div className="room-code">{room.code}</div>
                  <p className="muted">
                    Отправьте этот код участнику — он сможет присоединиться из
                    лобби.
                  </p>
                  <button
                    className="wide"
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(room.code)
                        .then(() => game.notify("Код комнаты скопирован."))
                        .catch(() => game.notify(`Код комнаты: ${room.code}`))
                    }
                  >
                    Скопировать код
                  </button>
                </div>
                <button
                  disabled={!online}
                  className={`wide ${room.players.find((p) => p.id === user.id)?.ready ? "" : "primary"}`}
                  onClick={() =>
                    send({
                      type: "room.ready",
                      ready: !room.players.find((p) => p.id === user.id)?.ready,
                    })
                  }
                >
                  {room.players.find((p) => p.id === user.id)?.ready
                    ? "Отменить готовность"
                    : "Я готов →"}
                </button>
                {room.owner === user.id && (
                  <button
                    className="primary wide"
                    disabled={
                      !online ||
                      room.players.filter((p) => p.ready && p.connected)
                        .length < 2 ||
                      !room.players.find((p) => p.id === user.id)?.ready
                    }
                    onClick={() => send({ type: "room.start" })}
                  >
                    Начать матч
                  </button>
                )}
                <p className="muted small-text">
                  В матч попадут готовые участники. Нужно минимум двое, включая
                  владельца. Остальные останутся в комнате.
                </p>
              </aside>
            </div>
          </>
        ) : (
          <>
            <div className="page-heading lobby-heading">
              <div>
                <span className="eyebrow">Карточная арена</span>
                <h1>Каждый ход на счету.</h1>
                <p className="muted">
                  Создайте комнату или присоединитесь к соперникам.
                </p>
              </div>
              <div className="lobby-emblem" aria-hidden="true">
                ♠
              </div>
            </div>
            <div className="lobby-layout">
              <section className="panel rooms-panel">
                <div className="panel-heading">
                  <h2>Открытые комнаты</h2>
                  <span className="count-pill">{rooms.length}</span>
                </div>
                <div className="room-table-label">
                  <span>Комната</span>
                  <span>Игроки</span>
                  <span />
                </div>
                {roomsError ? (
                  <div className="empty-state">
                    <p className="form-error">{roomsError}</p>
                  </div>
                ) : roomsLoading ? (
                  <div className="empty-state">Загружаем комнаты…</div>
                ) : rooms.length ? (
                  rooms.map((r) => (
                    <div className="room-row" key={r.code}>
                      <div>
                        <strong>{r.name}</strong>
                        <small>#{r.code}</small>
                      </div>
                      <span>
                        {r.count}
                        <span className="muted"> / {r.limit}</span>
                      </span>
                      <button
                        disabled={!online || r.count >= r.limit}
                        onClick={() =>
                          send({ type: "room.join", code: r.code })
                        }
                      >
                        {r.count >= r.limit ? "Заполнена" : "Войти ↗"}
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="empty-state">
                    <span>♧</span>
                    <h3>Арена ждёт игроков</h3>
                    <p>
                      Пока нет открытых комнат.
                      <br />
                      Создайте свою и пригласите соперника.
                    </p>
                  </div>
                )}
                <div className="rooms-note">
                  <span className="status-dot" />
                  Список обновляется автоматически
                </div>
              </section>
              <aside className="lobby-sidebar">
                <form className="panel" onSubmit={create}>
                  <div className="panel-heading">
                    <h3>Новая комната</h3>
                    <span className="green">+</span>
                  </div>
                  <label>
                    Название
                    <input
                      name="name"
                      maxLength={40}
                      defaultValue={`Арена ${user.username}`}
                      required
                    />
                  </label>
                  <label>
                    Лимит игроков
                    <select name="limit" defaultValue="4">
                      {Array.from({ length: 7 }, (_, i) => (
                        <option key={i} value={i + 2}>
                          {i + 2} игрока
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="primary wide" disabled={!online}>
                    Создать комнату →
                  </button>
                </form>
                <form className="panel join-panel" onSubmit={join}>
                  <h3>Есть код приглашения?</h3>
                  <label className="sr-only" htmlFor="join-code">
                    Код комнаты
                  </label>
                  <div className="join-row">
                    <input
                      id="join-code"
                      name="code"
                      placeholder="Код комнаты"
                      maxLength={10}
                      minLength={4}
                      required
                    />
                    <button
                      disabled={!online}
                      aria-label="Присоединиться по коду"
                    >
                      ↗
                    </button>
                  </div>
                </form>
              </aside>
            </div>
            <div className="how-to">
              <div>
                <span>01</span>
                <p>
                  <b>Исследуйте</b>Собирайте предметы на карте.
                </p>
              </div>
              <div>
                <span>02</span>
                <p>
                  <b>Сражайтесь</b>Побеждайте в дуэлях в пасьянс.
                </p>
              </div>
              <div>
                <span>03</span>
                <p>
                  <b>Останьтесь последним</b>Переживите зону и соперников.
                </p>
              </div>
            </div>
          </>
        )}
      </main>
      <footer className={`app-footer ${match && !match.duel && !profile ? "match-footer" : ""}`}>
        <span>Febus · Solitaire Collection</span>
        <span>У каждого игрока есть следующий ход.</span>
        <button onClick={() => setRules(true)}>Правила игры ↗</button>
      </footer>
      {game.notice && (
        <div
          className={`toast ${game.notice.error ? "error" : ""}`}
          role={game.notice.error ? "alert" : "status"}
        >
          <span>{game.notice.message}</span>
          <button onClick={game.dismiss} aria-label="Закрыть сообщение">
            ×
          </button>
        </div>
      )}
      {rules && (
        <div className="modal-shade" onClick={() => setRules(false)}>
          <section
            className="modal rules-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Правила игры"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="panel-heading">
              <h2>Правила арены</h2>
              <button
                onClick={() => setRules(false)}
                aria-label="Закрыть правила"
              >
                ×
              </button>
            </div>
            <Rules />
            <div className="rule-items">
              {(Object.keys(itemInfo) as Item[]).map((item) => (
                <p key={item}>
                  <b>
                    {itemInfo[item].icon} {itemInfo[item].name}.
                  </b>{" "}
                  {itemInfo[item].description}
                </p>
              ))}
            </div>
          </section>
        </div>
      )}
      {confirmLeave && (
        <div className="modal-shade">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Выход из матча"
          >
            <h2>Покинуть матч?</h2>
            <p>Если вы ещё в игре, выход засчитается как выбывание.</p>
            <div className="button-row">
              <button onClick={() => setConfirmLeave(false)}>Остаться</button>
              <button
                className="danger-button"
                onClick={() => {
                  setConfirmLeave(false);
                  send({ type: "match.leave" });
                }}
              >
                Выйти в лобби
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
