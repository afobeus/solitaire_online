import { useCallback, useEffect, useRef, useState } from "react";
import {
  mergePatch,
  type ClientState,
  type Command,
  type ServerMessage,
} from "../shared/protocol.js";
export interface User {
  id: number;
  username: string;
  games: number;
  wins: number;
  duelWins: number;
}
export async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    signal: AbortSignal.timeout(10000),
    credentials: "same-origin",
    ...(body !== undefined
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  }).catch(() => { throw new Error("Сервер недоступен. Проверьте соединение и повторите попытку."); });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      "Не удалось связаться с приложением. Проверьте адрес и повторите запрос.",
    );
  }
  if (!response.ok) throw new Error(value.error ?? "Сервер недоступен.");
  return value as T;
}
export function useGame(user: User | null) {
  const [state, setState] = useState<ClientState>({ room: null, match: null });
  const [status, setStatus] = useState<
    "connecting" | "online" | "offline" | "replaced" | "expired"
  >("connecting");
  const [notice, setNotice] = useState<{
    message: string;
    error: boolean;
    id: number;
  } | null>(null);
  const [offset, setOffset] = useState(0),
    [attempt, setAttempt] = useState(0);
  const ws = useRef<WebSocket | null>(null),
    serial = useRef(0),
    noticeId = useRef(0);
  const notify = useCallback(
    (message: string, error = false) =>
      setNotice({ message, error, id: ++noticeId.current }),
    [],
  );
  useEffect(() => {
    if (!user) {
      setState({ room: null, match: null });
      return;
    }
    let disposed = false,
      timer: ReturnType<typeof setTimeout>,
      failures = 0,
      blocked = false;
    function connect() {
      if (disposed) return;
      setStatus("connecting");
      serial.current = 0;
      const socket = new WebSocket(
        `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/ws`,
      );
      ws.current = socket;
      socket.onopen = () => {
        if (disposed) return;
        failures = 0;
        setStatus("online");
      };
      socket.onmessage = (event) => {
        if (disposed) return;
        const message = JSON.parse(event.data) as ServerMessage;
        if (message.type === "replaced") {
          blocked = true;
          setStatus("replaced");
          notify(message.message, true);
          return;
        }
        if (message.type === "error" || message.type === "notice") {
          notify(message.message, message.type === "error");
          return;
        }
        setOffset(message.now - Date.now());
        if (message.type === "snapshot") {
          serial.current = message.seq;
          setState(message.state);
          return;
        }
        if (message.seq !== serial.current + 1) {
          socket.send(JSON.stringify({ type: "sync" }));
          return;
        }
        serial.current = message.seq;
        setState((old) => mergePatch(old, message.patch));
      };
      socket.onclose = async (event) => {
        if (disposed) return;
        if (event.code === 4001) {
          blocked = true;
          setStatus("expired");
          return;
        }
        if (event.code === 4002 || blocked) {
          setStatus("replaced");
          return;
        }
        setStatus("offline");
        timer = setTimeout(connect, Math.min(5000, 1000 * 2 ** failures++));
        // Browsers hide an HTTP 401 from a failed upgrade; resolve it through the API.
        // This probe must not delay WebSocket retries during a network outage.
        try {
          const session = await api<{user:User|null}>("me");
          if(disposed || ws.current !== socket)return;
          if(!session.user){blocked=true;clearTimeout(timer);setStatus("expired");}
        } catch { /* A network outage still gets the reconnect grace period. */ }
      };
      socket.onerror = () => socket.close();
    }
    connect();
    return () => {
      disposed = true;
      clearTimeout(timer);
      ws.current?.close();
    };
  }, [user?.id, attempt, notify]);
  const send = useCallback(
    (command: Command) => {
      if (ws.current?.readyState !== WebSocket.OPEN) {
        notify("Нет соединения с сервером. Дождитесь переподключения.", true);
        return;
      }
      ws.current.send(JSON.stringify(command));
    },
    [notify],
  );
  return {
    state,
    status,
    notice,
    notify,
    dismiss: () => setNotice(null),
    send,
    offset,
    reconnect: () => setAttempt((v) => v + 1),
  };
}
export function useClock(offset = 0) {
  const [now, setNow] = useState(Date.now() + offset);
  useEffect(() => {
    setNow(Date.now() + offset);
    const timer = setInterval(() => setNow(Date.now() + offset), 100);
    return () => clearInterval(timer);
  }, [offset]);
  return now;
}
export function timeLeft(deadline: number, now: number) {
  const seconds = Math.max(0, Math.ceil((deadline - now) / 1000));
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}
