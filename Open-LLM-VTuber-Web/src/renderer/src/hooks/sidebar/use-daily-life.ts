import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  timestamp: number;
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
const BACKEND_STORAGE_KEY = 'daily_life_backend';
const MAX_TODO_ITEMS = 20;
const MAX_ITEM_LENGTH = 100;
const MAX_TOTAL_LENGTH = 500;

export const useDailyLife = (options?: DailyLifeOptions) => {
  const { t, i18n } = useTranslation();
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [currentDate, setCurrentDate] = useState<string>('');
  // Always use offline backend
  const backend = 'offline';

  // Get current date in YYYY-MM-DD format
  const getCurrentDate = useCallback(() => {
    return new Date().toISOString().split('T')[0];
  }, []);

  const setBackend = useCallback((next: DailyLifeBackend) => {
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
        if (data.items) {
          setTodos(data.items);
        } else {
             setTodos([]);
        }
      } catch (e) {
        console.error('Error loading todos:', e);
        setTodos([]);
      }
    } else {
      setTodos([]);
    }
  }, [backend, getCurrentDate]);

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

  // Add todo
  const addTodo = useCallback(async (text: string): Promise<boolean> => {
    if (!text.trim()) return false;
    if (todos.length >= MAX_TODO_ITEMS) return false;

    const truncatedText = text.slice(0, MAX_ITEM_LENGTH);

    const newTodo: TodoItem = {
      id: Date.now().toString(),
      text: truncatedText,
      completed: false,
      timestamp: Date.now(),
    };

    const newTodos = [...todos, newTodo];
    saveTodos(newTodos);
    return true;
  }, [todos, saveTodos]);

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
  const deleteTodo = useCallback(async (id: string) => {
    const newTodos = todos.filter(todo => todo.id !== id);
    saveTodos(newTodos);
  }, [todos, saveTodos]);

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

  // Format schedule for chat
  const formatScheduleForChat = useCallback((): string => {
    if (todos.length === 0) return '';

    const limitedTodos = todos.slice(0, MAX_TODO_ITEMS);
    const pending = limitedTodos.filter((t) => !t.completed);
    const done = limitedTodos.filter((t) => t.completed);

    const clipText = (text: string) => text.slice(0, MAX_ITEM_LENGTH).trim();
    const separator = i18n.language?.toLowerCase().startsWith('zh') ? '；' : '; ';
    const joinItems = (items: TodoItem[]) => items.map((t) => clipText(t.text)).join(separator);

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
    addTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
    clearAll,
    formatScheduleForChat,
    reload: loadTodosForToday,
    stats,
    currentDate,
    MAX_TODO_ITEMS,
    MAX_ITEM_LENGTH,
  };
};
