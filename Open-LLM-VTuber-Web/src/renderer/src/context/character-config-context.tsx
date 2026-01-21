import {
  createContext, useContext, useState, useMemo, useEffect, useCallback,
} from 'react';
import { useLocalStorage } from '@/hooks/utils/use-local-storage';

/**
 * Character configuration file interface
 * @interface ConfigFile
 */
export interface ConfigFile {
  filename: string;
  name: string;
}

/**
 * Character configuration context state interface
 * @interface CharacterConfigState
 */
interface CharacterConfigState {
  confName: string;
  confUid: string;
  configFiles: ConfigFile[];
  chatAvatarByConfUid: Record<string, string>;
  setConfName: (name: string) => void;
  setConfUid: (uid: string) => void;
  setConfigFiles: (files: ConfigFile[]) => void;
  getFilenameByName: (name: string) => string | undefined;
  getChatAvatarForConfUid: (uid: string) => string;
  setChatAvatarForConfUid: (uid: string, src: string) => void;
  clearChatAvatarForConfUid: (uid: string) => void;
}

/**
 * Default values and constants
 */
const DEFAULT_CONFIG = {
  confName: '',
  confUid: '',
  configFiles: [] as ConfigFile[],
  chatAvatarByConfUid: {} as Record<string, string>,
};

/**
 * Create the character configuration context
 */
export const ConfigContext = createContext<CharacterConfigState | null>(null);

/**
 * Character Configuration Provider Component
 * @param {Object} props - Provider props
 * @param {React.ReactNode} props.children - Child components
 */
export function CharacterConfigProvider({ children }: { children: React.ReactNode }) {
  const [confName, setConfName] = useState<string>(DEFAULT_CONFIG.confName);
  const [confUid, setConfUid] = useState<string>(DEFAULT_CONFIG.confUid);
  const [configFiles, setConfigFiles] = useState<ConfigFile[]>(DEFAULT_CONFIG.configFiles);
  const [chatAvatarByConfUid, setChatAvatarByConfUid] = useLocalStorage<Record<string, string>>(
    'chatAvatarByConfUid',
    DEFAULT_CONFIG.chatAvatarByConfUid,
  );

  const getFilenameByName = useCallback(
    (name: string) => configFiles.find((config) => config.name === name)?.filename,
    [configFiles],
  );

  const getChatAvatarForConfUid = useCallback(
    (uid: string) => chatAvatarByConfUid[uid] ?? '',
    [chatAvatarByConfUid],
  );

  const setChatAvatarForConfUid = useCallback((uid: string, src: string) => {
    setChatAvatarByConfUid((prev) => ({
      ...prev,
      [uid]: src,
    }));
  }, [setChatAvatarByConfUid]);

  const clearChatAvatarForConfUid = useCallback((uid: string) => {
    setChatAvatarByConfUid((prev) => {
      const { [uid]: _removed, ...rest } = prev;
      return rest;
    });
  }, [setChatAvatarByConfUid]);

  // Memoized context value
  const contextValue = useMemo(
    () => ({
      confName,
      confUid,
      configFiles,
      chatAvatarByConfUid,
      setConfName,
      setConfUid,
      setConfigFiles,
      getFilenameByName,
      getChatAvatarForConfUid,
      setChatAvatarForConfUid,
      clearChatAvatarForConfUid,
    }),
    [
      confName,
      confUid,
      configFiles,
      chatAvatarByConfUid,
      getFilenameByName,
      getChatAvatarForConfUid,
      setChatAvatarForConfUid,
      clearChatAvatarForConfUid,
    ],
  );

  useEffect(() => {
    (window.api as any)?.updateConfigFiles?.(configFiles);
  }, [configFiles]);

  return (
    <ConfigContext.Provider value={contextValue}>
      {children}
    </ConfigContext.Provider>
  );
}

/**
 * Custom hook to use the character configuration context
 * @throws {Error} If used outside of CharacterConfigProvider
 */
export function useConfig() {
  const context = useContext(ConfigContext);

  if (!context) {
    throw new Error('useConfig must be used within a CharacterConfigProvider');
  }

  return context;
}
