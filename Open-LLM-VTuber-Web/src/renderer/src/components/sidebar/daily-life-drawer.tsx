import {
  Box,
  Button,
  Input,
  Text,
  IconButton,
  HStack,
  VStack,
  createListCollection,
} from '@chakra-ui/react';
import { FiTrash2, FiPlus, FiPlay, FiPause, FiSquare } from 'react-icons/fi';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DrawerRoot,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
  DrawerBackdrop,
  DrawerCloseTrigger,
} from '../ui/drawer';
import { Checkbox } from '../ui/checkbox';
import {
  SelectContent,
  SelectItem,
  SelectRoot,
  SelectTrigger,
  SelectValueText,
} from '@/components/ui/select';
import {
  useDailyLife,
  type RepeatConfig,
  type RepeatPattern,
  type RecurringTodo,
} from '@/hooks/sidebar/use-daily-life';
import { usePomodoroTimer } from '@/hooks/sidebar/use-pomodoro-timer';
import { useWebSocket } from '@/context/websocket-context';
import { toaster } from '../ui/toaster';
import { sidebarStyles } from './sidebar-styles';

interface DailyLifeDrawerProps {
  children: ReactNode;
}

function DailyLifeDrawer({ children }: DailyLifeDrawerProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);
  const [inputText, setInputText] = useState('');
  const [repeat, setRepeat] = useState<RepeatPattern>('none');
  const [intervalValue, setIntervalValue] = useState<string>('2');
  const [weekdays, setWeekdays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [pomodoroDuration, setPomodoroDuration] = useState<number>(25);
  const [showRepeatTodos, setShowRepeatTodos] = useState(false);
  const [repeatDrafts, setRepeatDrafts] = useState<Record<string, {
    text: string;
    repeat: Exclude<RepeatPattern, 'none'>;
    intervalValue: string;
    weekdays: number[];
  }>>({});
  const { sendMessage, baseUrl } = useWebSocket();

  const {
    todos,
    recurringTodos,
    addTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
    updateRecurringTodo,
    deleteRecurringTodo,
    updateTodoTimer,
    formatScheduleForChat,
    stats,
    MAX_TODO_ITEMS,
    MAX_ITEM_LENGTH,
  } = useDailyLife({ baseUrl });

  const {
    activeTimer,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    getTimeRemaining,
    getProgress,
  } = usePomodoroTimer((taskId, timeSpent) => {
    // When timer completes, mark task as done and update time spent
    const todo = todos.find(t => t.id === taskId);
    if (todo) {
      void updateTodoTimer(taskId, { time_spent: (todo.time_spent || 0) + timeSpent });
      void toggleTodo(taskId);
      playNotificationSound();
      toaster.create({
        title: t('dailyLife.pomodoroComplete'),
        description: t('dailyLife.taskMarkedDone'),
        type: 'success',
        duration: 3000,
      });
    }
  });

  const formatTime = (ms: number): string => {
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const playNotificationSound = () => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800;
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);

      // Play three beeps
      setTimeout(() => {
        const osc2 = audioContext.createOscillator();
        const gain2 = audioContext.createGain();
        osc2.connect(gain2);
        gain2.connect(audioContext.destination);
        osc2.frequency.value = 800;
        osc2.type = 'sine';
        gain2.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        osc2.start();
        osc2.stop(audioContext.currentTime + 0.5);
      }, 200);

      setTimeout(() => {
        const osc3 = audioContext.createOscillator();
        const gain3 = audioContext.createGain();
        osc3.connect(gain3);
        gain3.connect(audioContext.destination);
        osc3.frequency.value = 1000;
        osc3.type = 'sine';
        gain3.gain.setValueAtTime(0.3, audioContext.currentTime);
        gain3.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
        osc3.start();
        osc3.stop(audioContext.currentTime + 0.8);
      }, 400);
    } catch (error) {
      console.error('Failed to play notification sound:', error);
    }
  };

  const handleStartTimer = (taskId: string) => {
    const duration = pomodoroDuration * 60 * 1000; // Convert minutes to milliseconds
    startTimer(taskId, duration);
    void updateTodoTimer(taskId, {
      pomodoro_start_time: Date.now(),
      pomodoro_duration: duration
    });
    toaster.create({
      title: t('dailyLife.timerStarted'),
      description: t('dailyLife.pomodoroStarted', { minutes: pomodoroDuration }),
      type: 'info',
      duration: 2000,
    });
  };

  const handlePauseTimer = () => {
    pauseTimer();
    toaster.create({
      title: t('dailyLife.timerPaused'),
      type: 'info',
      duration: 1500,
    });
  };

  const handleResumeTimer = () => {
    resumeTimer();
    toaster.create({
      title: t('dailyLife.timerResumed'),
      type: 'info',
      duration: 1500,
    });
  };

  const handleStopTimer = () => {
    const { timeSpent } = stopTimer();
    if (activeTimer) {
      const todo = todos.find(t => t.id === activeTimer.taskId);
      if (todo) {
        void updateTodoTimer(activeTimer.taskId, {
          time_spent: (todo.time_spent || 0) + timeSpent
        });
      }
    }
    toaster.create({
      title: t('dailyLife.timerStopped'),
      description: t('dailyLife.timeSpentRecorded'),
      type: 'info',
      duration: 2000,
    });
  };

  const handleAddTodo = async () => {
    if (!inputText.trim()) {
      toaster.create({
        title: t('dailyLife.pleaseEnterTask'),
        type: 'error',
        duration: 2000,
      });
      return;
    }

    if (todos.length >= MAX_TODO_ITEMS) {
      toaster.create({
        title: t('dailyLife.maxTasksReached', { max: MAX_TODO_ITEMS }),
        type: 'error',
        duration: 2000,
      });
      return;
    }

    const interval = Math.max(1, Math.floor(Number(intervalValue || '1')));
    const repeatConfig: RepeatConfig | undefined = (() => {
      if (repeat === 'interval_days') return { interval };
      if (repeat === 'weekly_days') return { weekdays };
      if (repeat === 'interval_weeks') return { interval, weekdays };
      return undefined;
    })();

    const success = await addTodo(inputText, repeat, repeatConfig);
    if (success) {
      setInputText('');
      setRepeat('none');
      setIntervalValue('2');
      setWeekdays([1, 2, 3, 4, 5]);
      toaster.create({
        title: t('dailyLife.taskAdded'),
        type: 'success',
        duration: 1500,
      });
    }
  };

  const repeatOptions = createListCollection({
    items: [
      { label: t('dailyLife.repeat.none'), value: 'none' },
      { label: t('dailyLife.repeat.daily'), value: 'daily' },
      { label: t('dailyLife.repeat.everyOtherDay'), value: 'every_other_day' },
      { label: t('dailyLife.repeat.weekday'), value: 'weekday' },
      { label: t('dailyLife.repeat.weekly'), value: 'weekly' },
      { label: t('dailyLife.repeat.monthly'), value: 'monthly' },
      { label: t('dailyLife.repeat.customWeekly'), value: 'weekly_days' },
      { label: t('dailyLife.repeat.everyNDays'), value: 'interval_days' },
      { label: t('dailyLife.repeat.everyNWeeks'), value: 'interval_weeks' },
    ],
  });

  const weekdayLabels = [
    t('dailyLife.weekdays.sun'),
    t('dailyLife.weekdays.mon'),
    t('dailyLife.weekdays.tue'),
    t('dailyLife.weekdays.wed'),
    t('dailyLife.weekdays.thu'),
    t('dailyLife.weekdays.fri'),
    t('dailyLife.weekdays.sat'),
  ];

  const toggleWeekday = (day: number) => {
    setWeekdays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)));
  };

  const initRepeatDraft = (r: RecurringTodo) => {
    const interval = r.repeat_config?.interval;
    return {
      text: r.text,
      repeat: r.repeat,
      intervalValue: typeof interval === 'number' && interval > 0 ? String(interval) : '2',
      weekdays: r.repeat_config?.weekdays ?? [1, 2, 3, 4, 5],
    };
  };

  const getRepeatDraft = (r: RecurringTodo) => {
    return repeatDrafts[r.id] ?? initRepeatDraft(r);
  };

  const formatRepeatLabel = (pattern: RepeatPattern, config?: RepeatConfig): string => {
    if (!pattern || pattern === 'none') return '';

    const key = pattern === 'every_other_day'
      ? 'everyOtherDay'
      : pattern === 'weekly_days'
        ? 'customWeekly'
        : pattern === 'interval_days'
          ? 'everyNDays'
          : pattern === 'interval_weeks'
            ? 'everyNWeeks'
            : pattern;

    if (pattern === 'interval_days') {
      const n = Math.max(1, Math.floor(config?.interval ?? 1));
      return `${t('dailyLife.repeat.everyNDays')} (${n})`;
    }
    if (pattern === 'interval_weeks') {
      const n = Math.max(1, Math.floor(config?.interval ?? 1));
      const days = (config?.weekdays ?? []).map((d) => weekdayLabels[d]).join(', ');
      return `${t('dailyLife.repeat.everyNWeeks')} (${n})${days ? `: ${days}` : ''}`;
    }
    if (pattern === 'weekly_days') {
      const days = (config?.weekdays ?? []).map((d) => weekdayLabels[d]).join(', ');
      return `${t('dailyLife.repeat.customWeekly')}${days ? `: ${days}` : ''}`;
    }

    return t(`dailyLife.repeat.${key}`);
  };

  const handleClearCompleted = async () => {
    const count = await clearCompleted();
    if (count > 0) {
      toaster.create({
        title: t('dailyLife.clearedCompleted', { count }),
        type: 'success',
        duration: 1500,
      });
    } else {
      toaster.create({
        title: t('dailyLife.noCompletedTasks'),
        type: 'info',
        duration: 1500,
      });
    }
  };

  const handleSaveRecurring = async (r: RecurringTodo) => {
    const draft = getRepeatDraft(r);
    const interval = Math.max(1, Math.floor(Number(draft.intervalValue || '1')));
    const repeatConfig: RepeatConfig | undefined = (() => {
      if (draft.repeat === 'interval_days') return { interval };
      if (draft.repeat === 'weekly_days') return { weekdays: draft.weekdays };
      if (draft.repeat === 'interval_weeks') return { interval, weekdays: draft.weekdays };
      return undefined;
    })();

    try {
      await updateRecurringTodo(r.id, {
        text: draft.text,
        repeat: draft.repeat,
        repeat_config: repeatConfig,
      });
      toaster.create({
        title: t('dailyLife.savedRepeatTodo'),
        type: 'success',
        duration: 1500,
      });
    } catch {
      toaster.create({
        title: t('dailyLife.failedRepeatTodo'),
        type: 'error',
        duration: 2000,
      });
    }
  };

  const handleDeleteRecurring = async (id: string) => {
    try {
      await deleteRecurringTodo(id);
      toaster.create({
        title: t('dailyLife.deletedRepeatTodo'),
        type: 'success',
        duration: 1500,
      });
    } catch {
      toaster.create({
        title: t('dailyLife.failedDeleteRepeatTodo'),
        type: 'error',
        duration: 2000,
      });
    }
  };

  const handleAddToChat = () => {
    const schedule = formatScheduleForChat();
    if (!schedule) {
      toaster.create({
        title: t('dailyLife.noTasksToAdd'),
        type: 'info',
        duration: 2000,
      });
      return;
    }

    // Store in a temporary state that can be read when sending messages
    // For now, we'll show a preview and let user know it will be included
    toaster.create({
      title: t('dailyLife.scheduleReady'),
      description: t('dailyLife.scheduleWillBeIncluded'),
      type: 'success',
      duration: 3000,
    });

    // Actually, let's send it directly for demonstration
    sendMessage({
      type: 'text-input',
      text: t('dailyLife.autoMessage'),
      daily_schedule: schedule,
    });

    setIsOpen(false);
  };

  const dateDisplay = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const recurringRepeatOptions = createListCollection({
    items: repeatOptions.items.filter((x) => x.value !== 'none'),
  });

  return (
    <DrawerRoot open={isOpen} onOpenChange={(e) => setIsOpen(e.open)} placement="end">
      <DrawerBackdrop />
      <DrawerTrigger asChild>{children}</DrawerTrigger>

      <DrawerContent style={sidebarStyles.historyDrawer.drawer.content}>
        <DrawerHeader>
          <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={4}>
            <Box>
              <DrawerTitle style={sidebarStyles.historyDrawer.drawer.title}>
                📅 {t('dailyLife.title')}
              </DrawerTitle>
              <Text fontSize="sm" color="whiteAlpha.700" fontFamily="mono">
                {dateDisplay}
              </Text>
            </Box>
            <DrawerCloseTrigger style={sidebarStyles.historyDrawer.drawer.closeButton} />
          </Box>
        </DrawerHeader>

        <DrawerBody>
          <Box px={4} py={2} css={sidebarStyles.historyDrawer.listContainer.css}>
            {/* Pomodoro Duration Setting */}
            <HStack mb={3} p={3} bg="whiteAlpha.100" borderRadius="md">
              <Text fontSize="sm" color="whiteAlpha.700" minW="120px">
                🍅 {t('dailyLife.pomodoroDuration')}
              </Text>
              <Input
                type="number"
                value={pomodoroDuration}
                onChange={(e) => {
                  const val = parseInt(e.target.value) || 1;
                  setPomodoroDuration(Math.max(1, Math.min(120, val)));
                }}
                min={1}
                max={120}
                width="80px"
                bg="whiteAlpha.100"
                border="none"
                color="white"
                textAlign="center"
              />
              <Text fontSize="sm" color="whiteAlpha.700">
                {t('dailyLife.minutes')}
              </Text>
            </HStack>

            {/* Add Todo Input */}
            <HStack mb={4}>
              <Input
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void handleAddTodo();
                  }
                }}
                placeholder={t('dailyLife.addItemPlaceholder')}
                maxLength={MAX_ITEM_LENGTH}
                bg="whiteAlpha.100"
                border="none"
                color="white"
                _placeholder={{ color: 'whiteAlpha.400' }}
              />

              <SelectRoot
                collection={repeatOptions}
                value={[repeat]}
                onValueChange={(e) => {
                  const next = e.value[0];
                  if (next) setRepeat(next as RepeatPattern);
                }}
                size="sm"
                width="160px"
                positioning={{ sameWidth: true }}
              >
                <SelectTrigger bg="whiteAlpha.100" border="none" color="white">
                  <SelectValueText placeholder={t('dailyLife.repeatLabel')} />
                </SelectTrigger>
                <SelectContent portalled={false}>
                  {repeatOptions.items.map((item) => (
                    <SelectItem key={item.value} item={item}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </SelectRoot>

              <IconButton
                onClick={() => void handleAddTodo()}
                aria-label={t('dailyLife.addItemPlaceholder')}
                bg="whiteAlpha.100"
                color="white"
                _hover={{ bg: 'whiteAlpha.200' }}
              >
                <FiPlus />
              </IconButton>
            </HStack>

            {(repeat === 'interval_days' || repeat === 'interval_weeks') && (
              <HStack mb={3} gap={2} alignItems="center">
                <Text fontSize="xs" color="whiteAlpha.700" minW="80px">
                  {t('dailyLife.intervalLabel')}
                </Text>
                <Input
                  value={intervalValue}
                  onChange={(e) => setIntervalValue(e.target.value.replace(/[^0-9]/g, ''))}
                  placeholder="2"
                  width="80px"
                  bg="whiteAlpha.100"
                  border="none"
                  color="white"
                  _placeholder={{ color: 'whiteAlpha.400' }}
                />
                <Text fontSize="xs" color="whiteAlpha.700">
                  {repeat === 'interval_days' ? t('dailyLife.days') : t('dailyLife.weeks')}
                </Text>
              </HStack>
            )}

            {(repeat === 'weekly_days' || repeat === 'interval_weeks') && (
              <HStack mb={4} gap={2} flexWrap="wrap">
                <Text fontSize="xs" color="whiteAlpha.700" minW="80px">
                  {t('dailyLife.selectWeekdays')}
                </Text>
                {weekdayLabels.map((label, idx) => (
                  <HStack key={label} gap={1} px={1}>
                    <Checkbox checked={weekdays.includes(idx)} onCheckedChange={() => toggleWeekday(idx)} />
                    <Text fontSize="xs" color="whiteAlpha.800">
                      {label}
                    </Text>
                  </HStack>
                ))}
              </HStack>
            )}

            {/* Todo List */}
            <VStack
              gap={2}
              maxH="400px"
              overflowY="auto"
              mb={4}
              alignItems="stretch"
              css={sidebarStyles.historyDrawer.listContainer.css}
            >
              {todos.length === 0 ? (
                <Box textAlign="center" py={8} color="whiteAlpha.700">
                  <Text fontSize="3xl" mb={2}>📝</Text>
                  <Text fontSize="sm">{t('dailyLife.noItems')}</Text>
                  <Text fontSize="xs" mt={1} color="whiteAlpha.500">{t('dailyLife.addFirstTask')}</Text>
                </Box>
              ) : (
                todos.map((todo) => {
                  const isPaused = activeTimer?.taskId === todo.id && activeTimer.isPaused;
                  const hasActiveTimer = activeTimer?.taskId === todo.id;

                  return (
                    <VStack
                      key={todo.id}
                      p={3}
                      gap={2}
                      bg={todo.completed ? 'whiteAlpha.100' : 'whiteAlpha.50'}
                      borderRadius="md"
                      _hover={{ bg: 'whiteAlpha.100' }}
                      transition="all 0.2s"
                      alignItems="stretch"
                    >
                      <HStack>
                        <Checkbox
                          checked={todo.completed}
                          onCheckedChange={() => void toggleTodo(todo.id)}
                        />
                        <VStack flex={1} alignItems="flex-start" gap={1}>
                          <Text
                            fontSize="sm"
                            textDecoration={todo.completed ? 'line-through' : 'none'}
                            opacity={todo.completed ? 0.6 : 1}
                            color="white"
                          >
                            {todo.text}
                          </Text>
                          {todo.time_spent && todo.time_spent > 0 && (
                            <Text fontSize="xs" color="blue.300">
                              ⏱️ {t('dailyLife.timeSpent')}: {formatTime(todo.time_spent)}
                            </Text>
                          )}
                        </VStack>
                        {todo.repeat && todo.repeat !== 'none' && (
                          <Text fontSize="xs" color="whiteAlpha.600" whiteSpace="nowrap">
                            {t('dailyLife.repeats')}: {formatRepeatLabel(todo.repeat, todo.repeat_config)}
                          </Text>
                        )}

                        {/* Timer Controls */}
                        {!todo.completed && (
                          <HStack gap={1}>
                            {!hasActiveTimer ? (
                              <IconButton
                                onClick={() => handleStartTimer(todo.id)}
                                size="sm"
                                variant="ghost"
                                colorPalette="green"
                                aria-label={t('dailyLife.startTimer')}
                                title={t('dailyLife.startPomodoro')}
                              >
                                <FiPlay />
                              </IconButton>
                            ) : (
                              <>
                                {isPaused ? (
                                  <IconButton
                                    onClick={handleResumeTimer}
                                    size="sm"
                                    variant="ghost"
                                    colorPalette="green"
                                    aria-label={t('dailyLife.resumeTimer')}
                                    title={t('dailyLife.resumeTimer')}
                                  >
                                    <FiPlay />
                                  </IconButton>
                                ) : (
                                  <IconButton
                                    onClick={handlePauseTimer}
                                    size="sm"
                                    variant="ghost"
                                    colorPalette="yellow"
                                    aria-label={t('dailyLife.pauseTimer')}
                                    title={t('dailyLife.pauseTimer')}
                                  >
                                    <FiPause />
                                  </IconButton>
                                )}
                                <IconButton
                                  onClick={handleStopTimer}
                                  size="sm"
                                  variant="ghost"
                                  colorPalette="red"
                                  aria-label={t('dailyLife.stopTimer')}
                                  title={t('dailyLife.stopTimer')}
                                >
                                  <FiSquare />
                                </IconButton>
                              </>
                            )}
                          </HStack>
                        )}

                        <IconButton
                          onClick={(e) => {
                            if (todo.recurring_id) {
                              const stopRecurring = e.shiftKey;
                              void deleteTodo(todo.id, { stopRecurring });
                              toaster.create({
                                title: stopRecurring
                                  ? t('dailyLife.stoppedRepeating')
                                  : t('dailyLife.deletedOccurrence'),
                                type: 'success',
                                duration: 1500,
                              });
                              return;
                            }

                            void deleteTodo(todo.id);
                          }}
                          size="sm"
                          variant="ghost"
                          colorPalette="red"
                          aria-label="Delete task"
                          title={todo.recurring_id ? t('dailyLife.deleteRecurringHint') : t('dailyLife.deleteOneHint')}
                        >
                          <FiTrash2 />
                        </IconButton>
                      </HStack>

                      {/* Timer Progress */}
                      {hasActiveTimer && (
                        <VStack gap={1} width="100%">
                          <HStack width="100%" justifyContent="space-between">
                            <Text fontSize="xs" color="whiteAlpha.700">
                              {formatTime(getTimeRemaining())}
                            </Text>
                            <Text fontSize="xs" color="whiteAlpha.700">
                              {Math.floor(getProgress())}%
                            </Text>
                          </HStack>
                          <Box width="100%" height="4px" bg="whiteAlpha.200" borderRadius="full" overflow="hidden">
                            <Box
                              height="100%"
                              width={`${getProgress()}%`}
                              bg={isPaused ? 'yellow.400' : 'green.400'}
                              transition="width 0.1s ease-out"
                            />
                          </Box>
                        </VStack>
                      )}
                    </VStack>
                  );
                })
              )}
            </VStack>

            {/* Statistics */}
            <HStack justifyContent="space-around" mb={4} p={3} bg="whiteAlpha.100" borderRadius="md">
              <VStack gap={0}>
                <Text fontSize="2xl" fontWeight="bold" color="blue.300">
                  {stats.total}
                </Text>
                <Text fontSize="xs" color="whiteAlpha.700">
                  {t('dailyLife.totalTasks')}
                </Text>
              </VStack>
              <VStack gap={0}>
                <Text fontSize="2xl" fontWeight="bold" color="green.300">
                  {stats.completed}
                </Text>
                <Text fontSize="xs" color="whiteAlpha.700">
                  {t('dailyLife.completed')}
                </Text>
              </VStack>
            </HStack>

            {/* Action Buttons */}
            <VStack gap={2}>
              <Button onClick={handleAddToChat} colorPalette="blue" width="100%" size="lg">
                🚀 {t('dailyLife.addToChat')}
              </Button>
              <HStack width="100%">
                <Button onClick={handleClearCompleted} variant="outline" flex={1} size="sm">
                  {t('dailyLife.clearCompleted')}
                </Button>
                <Button
                  onClick={() => setShowRepeatTodos((v) => !v)}
                  variant="outline"
                  flex={1}
                  size="sm"
                >
                  {showRepeatTodos ? t('dailyLife.hideRepeatTodos') : t('dailyLife.showRepeatTodos')}
                </Button>
              </HStack>
            </VStack>

            {/* Repeat Todos Manager */}
            {showRepeatTodos && (
              <Box mt={4} p={3} bg="whiteAlpha.50" borderRadius="md">
                <Text fontWeight="bold" mb={2} color="blue.300">
                  {t('dailyLife.repeatTodosTitle')}
                </Text>

                {recurringTodos.length === 0 ? (
                  <Text fontSize="sm" color="whiteAlpha.700">
                    {t('dailyLife.noRepeatTodos')}
                  </Text>
                ) : (
                  <VStack gap={3} alignItems="stretch">
                    {recurringTodos.map((r) => {
                      const draft = getRepeatDraft(r);
                      return (
                        <Box key={r.id} p={3} bg="whiteAlpha.100" borderRadius="md">
                          <VStack gap={2} alignItems="stretch">
                            <Input
                              value={draft.text}
                              onChange={(e) => {
                                const nextText = e.target.value.slice(0, MAX_ITEM_LENGTH);
                                setRepeatDrafts((prev) => ({
                                  ...prev,
                                  [r.id]: { ...draft, text: nextText },
                                }));
                              }}
                              bg="whiteAlpha.100"
                              border="none"
                              color="white"
                              _placeholder={{ color: 'whiteAlpha.400' }}
                            />

                            <HStack gap={2} alignItems="center">
                              <SelectRoot
                                collection={recurringRepeatOptions}
                                value={[draft.repeat]}
                                onValueChange={(e) => {
                                  const next = e.value[0];
                                  if (!next) return;
                                  setRepeatDrafts((prev) => ({
                                    ...prev,
                                    [r.id]: { ...draft, repeat: next as Exclude<RepeatPattern, 'none'> },
                                  }));
                                }}
                                size="sm"
                                width="220px"
                                positioning={{ sameWidth: true }}
                              >
                                <SelectTrigger bg="whiteAlpha.100" border="none" color="white">
                                  <SelectValueText placeholder={t('dailyLife.repeatLabel')} />
                                </SelectTrigger>
                                <SelectContent portalled={false}>
                                  {recurringRepeatOptions.items.map((item) => (
                                    <SelectItem key={item.value} item={item}>
                                      {item.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </SelectRoot>

                              <Button size="sm" onClick={() => void handleSaveRecurring(r)}>
                                {t('common.save')}
                              </Button>
                              <IconButton
                                onClick={() => void handleDeleteRecurring(r.id)}
                                size="sm"
                                variant="ghost"
                                colorPalette="red"
                                aria-label="Delete recurring task"
                                title={t('dailyLife.deleteRecurringTask')}
                              >
                                <FiTrash2 />
                              </IconButton>
                            </HStack>

                            {(draft.repeat === 'interval_days' || draft.repeat === 'interval_weeks') && (
                              <HStack gap={2} alignItems="center">
                                <Text fontSize="xs" color="whiteAlpha.700" minW="80px">
                                  {t('dailyLife.intervalLabel')}
                                </Text>
                                <Input
                                  value={draft.intervalValue}
                                  onChange={(e) => {
                                    const cleaned = e.target.value.replace(/[^0-9]/g, '');
                                    setRepeatDrafts((prev) => ({
                                      ...prev,
                                      [r.id]: { ...draft, intervalValue: cleaned },
                                    }));
                                  }}
                                  placeholder="2"
                                  width="80px"
                                  bg="whiteAlpha.100"
                                  border="none"
                                  color="white"
                                  _placeholder={{ color: 'whiteAlpha.400' }}
                                />
                                <Text fontSize="xs" color="whiteAlpha.700">
                                  {draft.repeat === 'interval_days' ? t('dailyLife.days') : t('dailyLife.weeks')}
                                </Text>
                              </HStack>
                            )}

                            {(draft.repeat === 'weekly_days' || draft.repeat === 'interval_weeks') && (
                              <HStack gap={2} flexWrap="wrap">
                                <Text fontSize="xs" color="whiteAlpha.700" minW="80px">
                                  {t('dailyLife.selectWeekdays')}
                                </Text>
                                {weekdayLabels.map((label, idx) => (
                                  <HStack key={`${r.id}-${label}`} gap={1} px={1}>
                                    <Checkbox
                                      checked={draft.weekdays.includes(idx)}
                                      onCheckedChange={() => {
                                        const nextWeekdays = draft.weekdays.includes(idx)
                                          ? draft.weekdays.filter((d) => d !== idx)
                                          : [...draft.weekdays, idx].sort((a, b) => a - b);
                                        setRepeatDrafts((prev) => ({
                                          ...prev,
                                          [r.id]: { ...draft, weekdays: nextWeekdays },
                                        }));
                                      }}
                                    />
                                    <Text fontSize="xs" color="whiteAlpha.800">
                                      {label}
                                    </Text>
                                  </HStack>
                                ))}
                              </HStack>
                            )}
                          </VStack>
                        </Box>
                      );
                    })}
                  </VStack>
                )}
              </Box>
            )}

            {/* Preview */}
            {todos.length > 0 && (
              <Box mt={4} p={3} bg="whiteAlpha.50" borderRadius="md" fontSize="xs">
                <Text fontWeight="bold" mb={2} color="blue.300">
                  {t('dailyLife.previewTitle')}
                </Text>
                <Text
                  fontFamily="mono"
                  whiteSpace="pre-wrap"
                  color="whiteAlpha.800"
                  maxH="150px"
                  overflowY="auto"
                  css={sidebarStyles.historyDrawer.listContainer.css}
                >
                  {formatScheduleForChat()}
                </Text>
              </Box>
            )}
          </Box>
        </DrawerBody>

        <DrawerFooter>
          <Button {...sidebarStyles.historyDrawer.drawer.actionButton} onClick={() => setIsOpen(false)}>
            {t('common.close')}
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}

export default DailyLifeDrawer;
