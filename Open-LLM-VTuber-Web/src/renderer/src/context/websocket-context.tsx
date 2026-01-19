/* eslint-disable react/jsx-no-constructed-context-values */
import React, { useContext, useCallback } from 'react';
import { wsService } from '@/services/websocket-service';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';

const FALLBACK_WS_URL = 'ws://127.0.0.1:12393/client-ws';
const FALLBACK_BASE_URL = 'http://127.0.0.1:12393';

function inferDefaultBaseUrl(): string {
  if (typeof window === 'undefined') return FALLBACK_BASE_URL;
  const { protocol, hostname, port } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && hostname && port) {
    return `${protocol}//${hostname}:${port}`;
  }
  return FALLBACK_BASE_URL;
}

function inferDefaultWsUrl(): string {
  if (typeof window === 'undefined') return FALLBACK_WS_URL;
  const { protocol, hostname, port } = window.location;
  if ((protocol === 'http:' || protocol === 'https:') && hostname && port) {
    const wsProtocol = protocol === 'https:' ? 'wss:' : 'ws:';
    return `${wsProtocol}//${hostname}:${port}/client-ws`;
  }
  return FALLBACK_WS_URL;
}

const DEFAULT_BASE_URL = inferDefaultBaseUrl();
const DEFAULT_WS_URL = inferDefaultWsUrl();

export interface HistoryInfo {
  uid: string;
  latest_message: {
    role: 'human' | 'ai';
    timestamp: string;
    content: string;
  } | null;
  timestamp: string | null;
}

interface WebSocketContextProps {
  sendMessage: (message: object) => void;
  wsState: string;
  reconnect: () => void;
  wsUrl: string;
  setWsUrl: (url: string) => void;
  baseUrl: string;
  setBaseUrl: (url: string) => void;
}

export const WebSocketContext = React.createContext<WebSocketContextProps>({
  sendMessage: wsService.sendMessage.bind(wsService),
  wsState: 'CLOSED',
  reconnect: () => wsService.connect(DEFAULT_WS_URL),
  wsUrl: DEFAULT_WS_URL,
  setWsUrl: () => {},
  baseUrl: DEFAULT_BASE_URL,
  setBaseUrl: () => {},
});

export function useWebSocket() {
  const context = useContext(WebSocketContext);
  if (!context) {
    throw new Error('useWebSocket must be used within a WebSocketProvider');
  }
  return context;
}

export const defaultWsUrl = DEFAULT_WS_URL;
export const defaultBaseUrl = DEFAULT_BASE_URL;

export function WebSocketProvider({ children }: { children: React.ReactNode }) {
  const [wsUrl, setWsUrl] = useLocalStorage('wsUrl', DEFAULT_WS_URL);
  const [baseUrl, setBaseUrl] = useLocalStorage('baseUrl', DEFAULT_BASE_URL);

  // If the UI is served from the backend (http(s)), prefer the current page origin.
  // This prevents CORS errors caused by mixing localhost and 127.0.0.1.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!(window.location.protocol === 'http:' || window.location.protocol === 'https:')) return;

    const pageBase = inferDefaultBaseUrl();
    const pageWs = inferDefaultWsUrl();

    try {
      const base = new URL(baseUrl);
      const page = new URL(pageBase);
      const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1';

      if (isLoopback(base.hostname) && isLoopback(page.hostname) && base.port === page.port) {
        if (base.origin !== page.origin) setBaseUrl(page.origin);
      }
    } catch {
      // ignore invalid URLs
    }

    try {
      const ws = new URL(wsUrl);
      const page = new URL(pageWs);
      const isLoopback = (h: string) => h === 'localhost' || h === '127.0.0.1';

      if (isLoopback(ws.hostname) && isLoopback(page.hostname) && ws.port === page.port) {
        if (ws.origin !== page.origin) {
          setWsUrl(pageWs);
          wsService.connect(pageWs);
        }
      }
    } catch {
      // ignore invalid URLs
    }
  }, [baseUrl, setBaseUrl, setWsUrl, wsUrl]);

  const handleSetWsUrl = useCallback((url: string) => {
    setWsUrl(url);
    wsService.connect(url);
  }, [setWsUrl]);

  const value = {
    sendMessage: wsService.sendMessage.bind(wsService),
    wsState: 'CLOSED',
    reconnect: () => wsService.connect(wsUrl),
    wsUrl,
    setWsUrl: handleSetWsUrl,
    baseUrl,
    setBaseUrl,
  };

  return (
    <WebSocketContext.Provider value={value}>
      {children}
    </WebSocketContext.Provider>
  );
}
