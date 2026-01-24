import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  timestamp: number;
  repeat?: RepeatPattern;
  repeat_config?: RepeatConfig;
  recurring_id?: string;
  // Pomodoro timer fields
  pomodoro_duration?: number; // in milliseconds, default 25 minutes
  pomodoro_start_time?: number; // timestamp when timer started
  time_spent?: number; // total time spent on task in milliseconds
}

export type RepeatPattern =
  | 'none'
  | 'daily'
  | 'every_other_day'
  | 'weekday'
  | 'weekly'
  | 'monthly'
  | 'weekly_days'
  | 'interval_days'
  | 'interval_weeks';

export interface RepeatConfig {
  /** Interval for interval-based repeats (days/weeks). */
  interval?: number;
  /** Weekdays (0=Sun..6=Sat) used by weekly_days/interval_weeks. */
  weekdays?: number[];
}

export interface RecurringTodo {
  id: string;
  text: string;
  repeat: Exclude<RepeatPattern, 'none'>;
  repeat_config?: RepeatConfig;
  created_date: string; // YYYY-MM-DD
  created_at: number;
  skipped_dates?: string[]; // YYYY-MM-DD[]
}

export interface DailySchedule {
  date: string; // YYYY-MM-DD
  items: TodoItem[];
}

export type DailyLifeBackend = 'offline' | 'microsoft_todo';

export interface DailyLifeOptions {
  baseUrl?: string;
}

const STORAGE_KEY_PREFIX = 'daily_schedule_';
const RECURRING_STORAGE_KEY = 'daily_life_recurring_todos';
const MAX_TODO_ITEMS = 20;
const MAX_ITEM_LENGTH = 100;
const MAX_TOTAL_LENGTH = 500;

const toLocalMidnightMs = (date: string): number => {
  const [year, month, day] = date.split('-').map((v) => Number(v));
  return new Date(year, month - 1, day, 0, 0, 0, 0).getTime();
};

const getDayOfWeek = (date: string): number => {
  const [year, month, day] = date.split('-').map((v) => Number(v));
  return new Date(year, month - 1, day).getDay();
};

const getDayOfMonth = (date: string): number => {
  const parts = date.split('-');
  return Number(parts[2]);
};

const getYearMonth = (date: string): { year: number; monthIndex: number } => {
  const [year, month] = date.split('-').map((v) => Number(v));
  return { year, monthIndex: month - 1 };
};

const getLastDayOfMonth = (year: number, monthIndex: number): number => {
  return new Date(year, monthIndex + 1, 0).getDate();
};

const isRecurringDueOn = (date: string, recurring: RecurringTodo): boolean => {
  if (recurring.skipped_dates?.includes(date)) return false;

  switch (recurring.repeat) {
    case 'daily':
      return true;
    case 'weekday': {
      const dow = getDayOfWeek(date);
      return dow >= 1 && dow <= 5;
    }
    case 'every_other_day': {
      const diffDays = Math.round((toLocalMidnightMs(date) - toLocalMidnightMs(recurring.created_date)) / 86_400_000);
      return diffDays >= 0 && diffDays % 2 === 0;
    }
    case 'weekly':
      return getDayOfWeek(date) === getDayOfWeek(recurring.created_date);
    case 'weekly_days': {
      const weekdays = recurring.repeat_config?.weekdays ?? [];
      if (weekdays.length === 0) return false;
      return weekdays.includes(getDayOfWeek(date));
    }
    case 'interval_days': {
      const interval = Math.max(1, Math.floor(recurring.repeat_config?.interval ?? 1));
      const diffDays = Math.round((toLocalMidnightMs(date) - toLocalMidnightMs(recurring.created_date)) / 86_400_000);
      return diffDays >= 0 && diffDays % interval === 0;
    }
    case 'interval_weeks': {
      const interval = Math.max(1, Math.floor(recurring.repeat_config?.interval ?? 1));
      const weekdays = recurring.repeat_config?.weekdays;
      const diffDays = Math.round((toLocalMidnightMs(date) - toLocalMidnightMs(recurring.created_date)) / 86_400_000);
      if (diffDays < 0) return false;
      const diffWeeks = Math.floor(diffDays / 7);
      const matchesInterval = diffWeeks % interval === 0;
      if (!matchesInterval) return false;
      const todayDow = getDayOfWeek(date);
      if (Array.isArray(weekdays) && weekdays.length > 0) return weekdays.includes(todayDow);
      return todayDow === getDayOfWeek(recurring.created_date);
    }
    case 'monthly': {
      const targetDay = getDayOfMonth(recurring.created_date);
      const { year, monthIndex } = getYearMonth(date);
      const lastDay = getLastDayOfMonth(year, monthIndex);
      const dueDay = Math.min(targetDay, lastDay);
      return getDayOfMonth(date) === dueDay;
    }
    default:
      return false;
  }
};

export const useDailyLife = (_options?: DailyLifeOptions) => {
  const { t, i18n } = useTranslation();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [recurringTodos, setRecurringTodos] = useState<RecurringTodo[]>([]);
  const [currentDate, setCurrentDate] = useState<string>('');
  // Always use offline backend
  const backend = 'offline';

  const loadRecurringTodos = useCallback((): RecurringTodo[] => {
    const stored = localStorage.getItem(RECURRING_STORAGE_KEY);
    if (!stored) return [];

    try {
      const parsed = JSON.parse(stored) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter((v): v is RecurringTodo => {
          const candidate = v as Partial<RecurringTodo>;
          return !!candidate
            && typeof candidate.id === 'string'
            && typeof candidate.text === 'string'
            && typeof candidate.repeat === 'string'
            && typeof candidate.created_date === 'string'
            && typeof candidate.created_at === 'number';
        });
    } catch {
      return [];
    }
  }, []);

  const saveRecurringTodos = useCallback((items: RecurringTodo[]) => {
    localStorage.setItem(RECURRING_STORAGE_KEY, JSON.stringify(items));
  }, []);

  const reloadRecurringTodos = useCallback(() => {
    setRecurringTodos(loadRecurringTodos());
  }, [loadRecurringTodos]);

  // Get current date in YYYY-MM-DD format
  const getCurrentDate = useCallback(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  const setBackend = useCallback((_next: DailyLifeBackend) => {
    // No-op or log warning as only offline is supported
    console.warn('Backend switching is disabled.');
  }, []);

  // Load todos for today
  const loadTodosForToday = useCallback(async () => {
    const date = getCurrentDate();
    setCurrentDate(date);

    const key = STORAGE_KEY_PREFIX + date;
    const stored = localStorage.getItem(key);

    if (stored) {
      try {
        const data: DailySchedule = JSON.parse(stored);
        const storedItems = data.items ?? [];
        const recurring = loadRecurringTodos();
        setRecurringTodos(recurring);
        const existingRecurringIds = new Set(storedItems.map((item) => item.recurring_id).filter(Boolean) as string[]);

        const recurringInstances: TodoItem[] = [];
        for (const r of recurring) {
          if (!isRecurringDueOn(date, r)) continue;
          if (existingRecurringIds.has(r.id)) continue;
          recurringInstances.push({
            id: `${r.id}:${date}`,
            text: r.text,
            completed: false,
            timestamp: Date.now(),
            repeat: r.repeat,
            repeat_config: r.repeat_config,
            recurring_id: r.id,
          });
        }

        setTodos([...storedItems, ...recurringInstances].slice(0, MAX_TODO_ITEMS));
      } catch (e) {
        console.error('Error loading todos:', e);
        const recurring = loadRecurringTodos();
        setRecurringTodos(recurring);
        const recurringInstances = recurring
          .filter((r) => isRecurringDueOn(date, r))
          .slice(0, MAX_TODO_ITEMS)
          .map((r): TodoItem => ({
            id: `${r.id}:${date}`,
            text: r.text,
            completed: false,
            timestamp: Date.now(),
            repeat: r.repeat,
            repeat_config: r.repeat_config,
            recurring_id: r.id,
          }));
        setTodos(recurringInstances);
      }
    } else {
      const recurring = loadRecurringTodos();
      setRecurringTodos(recurring);
      const recurringInstances = recurring
        .filter((r) => isRecurringDueOn(date, r))
        .slice(0, MAX_TODO_ITEMS)
        .map((r): TodoItem => ({
          id: `${r.id}:${date}`,
          text: r.text,
          completed: false,
          timestamp: Date.now(),
          repeat: r.repeat,
          repeat_config: r.repeat_config,
          recurring_id: r.id,
        }));
      setTodos(recurringInstances);
    }
  }, [backend, getCurrentDate, loadRecurringTodos]);

  // Save todos (offline only)
  const saveTodos = useCallback((items: TodoItem[]) => {
    const key = STORAGE_KEY_PREFIX + currentDate;
    const data: DailySchedule = {
      date: currentDate,
      items,
    };
    localStorage.setItem(key, JSON.stringify(data));
    setTodos(items);
  }, [currentDate]);

  const updateRecurringTodo = useCallback(async (
    id: string,
    updates: Partial<Pick<RecurringTodo, 'text' | 'repeat' | 'repeat_config'>>
  ) => {
    const recurring = loadRecurringTodos();
    const nextRecurring = recurring.map((r) => {
      if (r.id !== id) return r;

      const nextText = typeof updates.text === 'string' ? updates.text.slice(0, MAX_ITEM_LENGTH) : r.text;
      const nextRepeat = updates.repeat ?? r.repeat;
      const nextConfig = Object.prototype.hasOwnProperty.call(updates, 'repeat_config')
        ? updates.repeat_config
        : r.repeat_config;

      return {
        ...r,
        text: nextText,
        repeat: nextRepeat,
        repeat_config: nextConfig,
      };
    });

    saveRecurringTodos(nextRecurring);
    setRecurringTodos(nextRecurring);

    // Update any loaded instances for the current day.
    const nextTodos = todos.map((todo) => {
      if (todo.recurring_id !== id) return todo;
      const updated = nextRecurring.find((r) => r.id === id);
      if (!updated) return todo;
      return {
        ...todo,
        text: updated.text,
        repeat: updated.repeat,
        repeat_config: updated.repeat_config,
      };
    });
    saveTodos(nextTodos);
  }, [loadRecurringTodos, saveRecurringTodos, saveTodos, todos]);

  // Add todo
  const addTodo = useCallback(async (
    text: string,
    repeat: RepeatPattern = 'none',
    repeatConfig?: RepeatConfig,
  ): Promise<boolean> => {
    if (!text.trim()) return false;
    if (todos.length >= MAX_TODO_ITEMS) return false;

    const truncatedText = text.slice(0, MAX_ITEM_LENGTH);

    if (repeat === 'none') {
      const newTodo: TodoItem = {
        id: Date.now().toString(),
        text: truncatedText,
        completed: false,
        timestamp: Date.now(),
        repeat: 'none',
        repeat_config: undefined,
      };

      const newTodos = [...todos, newTodo];
      saveTodos(newTodos);
      return true;
    }

    const today = currentDate || getCurrentDate();
    const recurringId = `r_${Date.now().toString()}`;
    const recurringTodo: RecurringTodo = {
      id: recurringId,
      text: truncatedText,
      repeat,
      repeat_config: repeatConfig,
      created_date: today,
      created_at: Date.now(),
    };

    const recurring = loadRecurringTodos();
    const nextRecurring = [...recurring, recurringTodo];
    saveRecurringTodos(nextRecurring);
    setRecurringTodos(nextRecurring);

    const instance: TodoItem = {
      id: `${recurringId}:${today}`,
      text: truncatedText,
      completed: false,
      timestamp: Date.now(),
      repeat,
      repeat_config: repeatConfig,
      recurring_id: recurringId,
    };

    const newTodos = [...todos, instance];
    saveTodos(newTodos);
    return true;
  }, [currentDate, getCurrentDate, loadRecurringTodos, saveRecurringTodos, saveTodos, todos]);

  // Toggle todo completion
  const toggleTodo = useCallback(async (id: string) => {
    const next = todos.find((t) => t.id === id);
    if (!next) return;
    const completed = !next.completed;

    const newTodos = todos.map(todo =>
      todo.id === id ? { ...todo, completed } : todo
    );
    saveTodos(newTodos);
  }, [todos, saveTodos]);

  // Delete todo
  const deleteTodo = useCallback(async (id: string, options?: { stopRecurring?: boolean }) => {
    const target = todos.find((todo) => todo.id === id);
    if (!target) return;

    let newTodos = todos.filter((todo) => todo.id !== id);

    if (target.recurring_id) {
      const stopRecurring = options?.stopRecurring ?? false;
      const recurring = loadRecurringTodos();

      if (stopRecurring) {
        // Stop repeating entirely.
        const nextRecurring = recurring.filter((r) => r.id !== target.recurring_id);
        saveRecurringTodos(nextRecurring);
        setRecurringTodos(nextRecurring);
        newTodos = newTodos.filter((todo) => todo.recurring_id !== target.recurring_id);
      } else {
        // Delete only today's occurrence and mark it skipped so it won't reappear on reload.
        const date = currentDate || getCurrentDate();
        const instanceIdForDate = `${target.recurring_id}:${date}`;
        newTodos = newTodos.filter((todo) => todo.id !== instanceIdForDate);

        const nextRecurring = recurring.map((r) => {
          if (r.id !== target.recurring_id) return r;
          const skipped = new Set(r.skipped_dates ?? []);
          skipped.add(date);
          return { ...r, skipped_dates: [...skipped] };
        });
        saveRecurringTodos(nextRecurring);
        setRecurringTodos(nextRecurring);
      }
    }

    saveTodos(newTodos);
  }, [currentDate, getCurrentDate, loadRecurringTodos, saveRecurringTodos, todos, saveTodos]);

  // Clear completed todos
  const clearCompleted = useCallback(async (): Promise<number> => {
    const completedTodos = todos.filter(todo => todo.completed);
    if (completedTodos.length === 0) return 0;

    const newTodos = todos.filter(todo => !todo.completed);
    saveTodos(newTodos);
    return todos.length - newTodos.length; // return count of cleared items
  }, [todos, saveTodos]);

  // Clear all todos
  const clearAll = useCallback(async () => {
    saveTodos([]);
  }, [saveTodos]);

  // Update todo timer information
  const updateTodoTimer = useCallback(async (
    id: string,
    updates: Partial<Pick<TodoItem, 'pomodoro_start_time' | 'pomodoro_duration' | 'time_spent'>>
  ) => {
    const newTodos = todos.map(todo =>
      todo.id === id ? { ...todo, ...updates } : todo
    );
    saveTodos(newTodos);
  }, [todos, saveTodos]);

  const deleteRecurringTodo = useCallback(async (id: string) => {
    const recurring = loadRecurringTodos();
    const nextRecurring = recurring.filter((r) => r.id !== id);
    saveRecurringTodos(nextRecurring);
    setRecurringTodos(nextRecurring);

    // Also remove instances of this recurring todo from current day's todos
    const nextTodos = todos.filter((todo) => todo.recurring_id !== id);
    if (nextTodos.length !== todos.length) {
      saveTodos(nextTodos);
    }
  }, [loadRecurringTodos, saveRecurringTodos, saveTodos, todos]);

  // Format schedule for chat
  const formatScheduleForChat = useCallback((): string => {
    if (todos.length === 0) return '';

    const limitedTodos = todos.slice(0, MAX_TODO_ITEMS);
    const pending = limitedTodos.filter((t) => !t.completed);
    const done = limitedTodos.filter((t) => t.completed);

    const clipText = (text: string) => text.slice(0, MAX_ITEM_LENGTH).trim();
    const isZh = i18n.language?.toLowerCase().startsWith('zh');
    const formatTime = (ms: number): string => {
      if (!ms || ms < 1000) return ''; // Less than 1 second, don't show
      const minutes = Math.ceil(ms / 60000); // Round up to nearest minute
      if (isZh) {
        return ` (${minutes}分钟)`;
      }
      return ` (${minutes}min)`;
    };
    const separator = isZh ? '；' : '; ';
    const joinItems = (items: TodoItem[]) => items.map((t) =>
      clipText(t.text) + (t.time_spent ? formatTime(t.time_spent) : '')
    ).join(separator);

    const date = getCurrentDate();
    const lines: string[] = [t('dailyLife.scheduleTitle', { date })];
    if (pending.length > 0) {
      lines.push(
        t('dailyLife.scheduleTodoLine', { count: pending.length, items: joinItems(pending) })
      );
    }
    if (done.length > 0) {
      lines.push(
        t('dailyLife.scheduleDoneLine', { count: done.length, items: joinItems(done) })
      );
    }

    let result = lines.join('\n');

    // Ensure we don't exceed max length
    if (result.length > MAX_TOTAL_LENGTH) {
      result = result.slice(0, MAX_TOTAL_LENGTH) + '\n...';
    }

    return result;
  }, [todos, getCurrentDate, i18n.language, t]);

  // Get statistics
  const stats = {
    total: todos.length,
    completed: todos.filter(t => t.completed).length,
  };

  // Load todos on mount
  useEffect(() => {
    void loadTodosForToday();
  }, [loadTodosForToday]);

  return {
    backend,
    setBackend,
    todos,
    recurringTodos,
    reloadRecurringTodos,
    updateRecurringTodo,
    deleteRecurringTodo,
    addTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
    clearAll,
    updateTodoTimer,
    formatScheduleForChat,
    reload: loadTodosForToday,
    stats,
    currentDate,
    MAX_TODO_ITEMS,
    MAX_ITEM_LENGTH,
  };
};
