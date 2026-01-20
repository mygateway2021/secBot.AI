import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_POMODORO_DURATION = 25 * 60 * 1000; // 25 minutes in milliseconds

export interface PomodoroTimer {
  taskId: string;
  startTime: number;
  duration: number;
  elapsed: number;
  isPaused: boolean;
}

export interface UsePomodoroTimerReturn {
  activeTimer: PomodoroTimer | null;
  startTimer: (taskId: string, duration?: number) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => { timeSpent: number };
  getTimeRemaining: () => number;
  getProgress: () => number;
  isTimerActive: (taskId: string) => boolean;
  getElapsedTime: () => number;
}

export const usePomodoroTimer = (
  onTimerComplete?: (taskId: string, timeSpent: number) => void
): UsePomodoroTimerReturn => {
  const [activeTimer, setActiveTimer] = useState<PomodoroTimer | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const pausedTimeRef = useRef<number>(0);

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, []);

  // Timer tick effect
  useEffect(() => {
    if (!activeTimer || activeTimer.isPaused) {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      return;
    }

    intervalRef.current = setInterval(() => {
      setActiveTimer((current) => {
        if (!current || current.isPaused) return current;

        const now = Date.now();
        const elapsed = now - current.startTime + pausedTimeRef.current;

        // Check if timer is complete
        if (elapsed >= current.duration) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }

          // Call completion callback
          if (onTimerComplete) {
            onTimerComplete(current.taskId, current.duration);
          }

          pausedTimeRef.current = 0;
          return null;
        }

        return { ...current, elapsed };
      });
    }, 100); // Update every 100ms for smooth progress

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [activeTimer?.isPaused, activeTimer?.taskId, onTimerComplete]);

  const startTimer = useCallback((taskId: string, duration = DEFAULT_POMODORO_DURATION) => {
    pausedTimeRef.current = 0;
    setActiveTimer({
      taskId,
      startTime: Date.now(),
      duration,
      elapsed: 0,
      isPaused: false,
    });
  }, []);

  const pauseTimer = useCallback(() => {
    setActiveTimer((current) => {
      if (!current || current.isPaused) return current;
      
      const now = Date.now();
      const elapsed = now - current.startTime + pausedTimeRef.current;
      pausedTimeRef.current = elapsed;

      return { ...current, isPaused: true, elapsed };
    });
  }, []);

  const resumeTimer = useCallback(() => {
    setActiveTimer((current) => {
      if (!current || !current.isPaused) return current;
      
      return {
        ...current,
        startTime: Date.now(),
        isPaused: false,
      };
    });
  }, []);

  const stopTimer = useCallback(() => {
    const timeSpent = activeTimer
      ? activeTimer.isPaused
        ? pausedTimeRef.current
        : Date.now() - activeTimer.startTime + pausedTimeRef.current
      : 0;

    setActiveTimer(null);
    pausedTimeRef.current = 0;

    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return { timeSpent };
  }, [activeTimer]);

  const getTimeRemaining = useCallback(() => {
    if (!activeTimer) return 0;
    return Math.max(0, activeTimer.duration - activeTimer.elapsed);
  }, [activeTimer]);

  const getProgress = useCallback(() => {
    if (!activeTimer) return 0;
    return Math.min(100, (activeTimer.elapsed / activeTimer.duration) * 100);
  }, [activeTimer]);

  const isTimerActive = useCallback(
    (taskId: string) => {
      return activeTimer?.taskId === taskId && !activeTimer.isPaused;
    },
    [activeTimer]
  );

  const getElapsedTime = useCallback(() => {
    if (!activeTimer) return 0;
    return activeTimer.elapsed;
  }, [activeTimer]);

  return {
    activeTimer,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    getTimeRemaining,
    getProgress,
    isTimerActive,
    getElapsedTime,
  };
};
