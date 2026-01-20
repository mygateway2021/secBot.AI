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
import { FiTrash2, FiPlus } from 'react-icons/fi';
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
import { useDailyLife, type RepeatConfig, type RepeatPattern } from '@/hooks/sidebar/use-daily-life';
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
  const { sendMessage, baseUrl } = useWebSocket();
  
  const {
    todos,
    addTodo,
    toggleTodo,
    deleteTodo,
    clearCompleted,
    clearAll,
    formatScheduleForChat,
    stats,
    MAX_TODO_ITEMS,
    MAX_ITEM_LENGTH,
  } = useDailyLife({ baseUrl });

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

  const handleClearAll = async () => {
    if (todos.length === 0) {
      toaster.create({
        title: t('dailyLife.noTasksToClear'),
        type: 'info',
        duration: 1500,
      });
      return;
    }

    // eslint-disable-next-line no-alert
    if (window.confirm(t('dailyLife.confirmClearAll'))) {
      await clearAll();
      toaster.create({
        title: t('dailyLife.allTasksCleared'),
        type: 'success',
        duration: 1500,
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
              todos.map((todo) => (
                <HStack
                  key={todo.id}
                  p={3}
                  bg={todo.completed ? 'whiteAlpha.100' : 'whiteAlpha.50'}
                  borderRadius="md"
                  _hover={{ bg: 'whiteAlpha.100' }}
                  transition="all 0.2s"
                >
                  <Checkbox
                    checked={todo.completed}
                    onCheckedChange={() => void toggleTodo(todo.id)}
                  />
                  <Text
                    flex={1}
                    fontSize="sm"
                    textDecoration={todo.completed ? 'line-through' : 'none'}
                    opacity={todo.completed ? 0.6 : 1}
                    color="white"
                  >
                    {todo.text}
                  </Text>
                  {todo.repeat && todo.repeat !== 'none' && (
                    <Text fontSize="xs" color="whiteAlpha.600" whiteSpace="nowrap">
                      {t('dailyLife.repeats')}: {formatRepeatLabel(todo.repeat, todo.repeat_config)}
                    </Text>
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
              ))
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
                  onClick={handleClearAll}
                  variant="outline"
                  colorPalette="red"
                  flex={1}
                  size="sm"
                >
                  {t('dailyLife.clearAll')}
                </Button>
              </HStack>
            </VStack>

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
