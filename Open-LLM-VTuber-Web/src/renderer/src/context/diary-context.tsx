import {
  createContext,
  useContext,
  useMemo,
  useState,
  useCallback,
} from 'react';

export interface DiaryEntry {
  uid: string;
  conf_uid: string;
  character_name: string;
  created_at: string;
  source_history_uids: string[];
  content: string;
}

interface DiaryState {
  diaries: DiaryEntry[];
  setDiaries: (value: DiaryEntry[] | ((prev: DiaryEntry[]) => DiaryEntry[])) => void;
  addDiary: (entry: DiaryEntry) => void;
  updateDiary: (entry: DiaryEntry) => void;
  removeDiary: (confUid: string, diaryUid: string) => void;
}

const DiaryContext = createContext<DiaryState | null>(null);

export function DiaryProvider({ children }: { children: React.ReactNode }) {
  const [diaries, setDiaries] = useState<DiaryEntry[]>([]);

  const addDiary = useCallback((entry: DiaryEntry) => {
    setDiaries((prev) => {
      const withoutDup = prev.filter((d) => d.uid !== entry.uid);
      return [entry, ...withoutDup];
    });
  }, []);

  const updateDiary = useCallback((entry: DiaryEntry) => {
    setDiaries((prev) => prev.map((d) => (d.uid === entry.uid ? entry : d)));
  }, []);

  const removeDiary = useCallback((confUid: string, diaryUid: string) => {
    setDiaries((prev) => prev.filter((d) => !(d.conf_uid === confUid && d.uid === diaryUid)));
  }, []);

  const value = useMemo(
    () => ({
      diaries,
      setDiaries,
      addDiary,
      updateDiary,
      removeDiary,
    }),
    [diaries, addDiary, updateDiary, removeDiary],
  );

  return (
    <DiaryContext.Provider value={value}>
      {children}
    </DiaryContext.Provider>
  );
}

export function useDiary() {
  const ctx = useContext(DiaryContext);
  if (!ctx) {
    throw new Error('useDiary must be used within a DiaryProvider');
  }
  return ctx;
}
