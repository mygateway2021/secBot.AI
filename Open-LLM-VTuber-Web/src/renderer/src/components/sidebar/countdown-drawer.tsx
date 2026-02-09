import {
  Box,
  Button,
  HStack,
  Input,
  IconButton,
  Text,
  VStack,
} from '@chakra-ui/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { FiTrash2 } from 'react-icons/fi';
import {
  DrawerBackdrop,
  DrawerBody,
  DrawerCloseTrigger,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerRoot,
  DrawerTitle,
  DrawerTrigger,
} from '../ui/drawer';
import { toaster } from '../ui/toaster';
import { useWebSocket } from '@/context/websocket-context';
import { sidebarStyles } from './sidebar-styles';

interface CountdownDrawerProps {
  children: ReactNode;
}

interface CountdownItem {
  id: string;
  description: string;
  target_ms: number;
  created_at: number;
}

const COUNTDOWN_STORAGE_KEY = 'countdown_targets_v1';
const MAX_COUNTDOWNS = 5;

function generateId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function loadCountdowns(): CountdownItem[] {
  const raw = localStorage.getItem(COUNTDOWN_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((v) => v as Partial<CountdownItem>)
      .filter((v): v is CountdownItem => {
        return (
          typeof v.id === 'string'
          && typeof v.description === 'string'
          && typeof v.target_ms === 'number'
          && typeof v.created_at === 'number'
        );
      });
  } catch {
    return [];
  }
}

function saveCountdowns(items: CountdownItem[]): void {
  localStorage.setItem(COUNTDOWN_STORAGE_KEY, JSON.stringify(items));
}

function removeExpiredCountdowns(items: CountdownItem[], now: number): CountdownItem[] {
  return items.filter((c) => c.target_ms > now);
}

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const yyyy = d.getFullYear().toString().padStart(4, '0');
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const dd = d.getDate().toString().padStart(2, '0');
  const hh = d.getHours().toString().padStart(2, '0');
  const min = d.getMinutes().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${min}`;
}

function parseDatetimeLocalToMs(value: string): number | null {
  if (!value.trim()) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return ms;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  const hh = hours.toString().padStart(2, '0');
  const mm = minutes.toString().padStart(2, '0');
  const ss = seconds.toString().padStart(2, '0');

  if (days > 0) return `${days}d ${hh}:${mm}:${ss}`;
  return `${hh}:${mm}:${ss}`;
}

function CountdownDrawer({ children }: CountdownDrawerProps): JSX.Element {
  const { t } = useTranslation();
  const { sendMessage } = useWebSocket();

  const [isOpen, setIsOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [targetDatetime, setTargetDatetime] = useState('');
  const [targetMs, setTargetMs] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [countdowns, setCountdowns] = useState<CountdownItem[]>(() => {
    try {
      return loadCountdowns();
    } catch {
      return [];
    }
  });
  const [isRunning, setIsRunning] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!isOpen) return;
    const now = Date.now();
    const cleaned = removeExpiredCountdowns(loadCountdowns(), now);
    saveCountdowns(cleaned);
    setCountdowns(cleaned);

    // If the active countdown is expired (or was removed), clear it.
    if (activeId && !cleaned.some((c) => c.id === activeId)) {
      setActiveId(null);
      setTargetMs(null);
      setIsRunning(false);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isRunning || targetMs === null) return;

    const id = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(id);
  }, [isRunning, targetMs]);

  const remainingMs = useMemo(() => {
    if (targetMs === null) return null;
    return Math.max(0, targetMs - nowMs);
  }, [nowMs, targetMs]);

  useEffect(() => {
    if (!isRunning) return;
    if (remainingMs !== null && remainingMs <= 0) {
      setIsRunning(false);

      if (activeId) {
        const now = Date.now();
        const next = removeExpiredCountdowns(loadCountdowns(), now);
        // Also remove the active item explicitly (covers edge cases where target_ms==now)
        const nextWithoutActive = next.filter((c) => c.id !== activeId);
        saveCountdowns(nextWithoutActive);
        setCountdowns(nextWithoutActive);
        setActiveId(null);
        setTargetMs(null);
        toaster.create({
          title: t('countdown.autoDeleted'),
          type: 'info',
          duration: 2500,
        });
      }
    }
  }, [isRunning, remainingMs]);

  const persistCountdowns = (items: CountdownItem[]) => {
    saveCountdowns(items);
    setCountdowns(items);
  };

  const deleteCountdown = (id: string) => {
    const next = countdowns.filter((c) => c.id !== id);
    persistCountdowns(next);

    if (activeId === id) {
      setActiveId(null);
      setTargetMs(null);
      setIsRunning(false);
    }

    toaster.create({
      title: t('countdown.deleted'),
      type: 'success',
      duration: 1500,
    });
  };

  const handleStart = () => {
    const ms = parseDatetimeLocalToMs(targetDatetime);
    if (ms === null) {
      toaster.create({
        title: t('countdown.invalidDate'),
        type: 'error',
        duration: 2000,
      });
      return;
    }

    const item: CountdownItem = {
      id: generateId(),
      description: description.trim(),
      target_ms: ms,
      created_at: Date.now(),
    };

    const next = [item, ...countdowns].slice(0, MAX_COUNTDOWNS);
    persistCountdowns(next);
    setActiveId(item.id);

    setTargetMs(ms);
    setNowMs(Date.now());
    setIsRunning(true);

    if (countdowns.length >= MAX_COUNTDOWNS) {
      toaster.create({
        title: t('countdown.maxKeptTitle', { max: MAX_COUNTDOWNS }),
        type: 'info',
        duration: 2500,
      });
    }
  };

  const handleUpdate = () => {
    if (!activeId) return;

    const ms = parseDatetimeLocalToMs(targetDatetime);
    if (ms === null) {
      toaster.create({
        title: t('countdown.invalidDate'),
        type: 'error',
        duration: 2000,
      });
      return;
    }

    const updated: CountdownItem = {
      id: activeId,
      description: description.trim(),
      target_ms: ms,
      created_at: Date.now(),
    };

    const next = [updated, ...countdowns.filter((c) => c.id !== activeId)].slice(0, MAX_COUNTDOWNS);
    persistCountdowns(next);

    setTargetMs(ms);
    setNowMs(Date.now());
    setIsRunning(true);

    toaster.create({
      title: t('countdown.updated'),
      type: 'success',
      duration: 1500,
    });
  };

  const handleSelect = (item: CountdownItem) => {
    setActiveId(item.id);
    setDescription(item.description);
    setTargetMs(item.target_ms);
    setTargetDatetime(toDatetimeLocalValue(item.target_ms));
    setNowMs(Date.now());
    setIsRunning(true);
  };

  const handleShare = () => {
    if (targetMs === null) {
      toaster.create({
        title: t('countdown.pleaseStart'),
        type: 'info',
        duration: 2000,
      });
      return;
    }

    const goal = description.trim();
    const targetText = new Date(targetMs).toLocaleString();
    const remainingText = formatRemaining(Math.max(0, targetMs - Date.now()));

    const lines: string[] = [];
    if (goal) lines.push(`${t('countdown.goal')}: ${goal}`);
    lines.push(`${t('countdown.targetDate')}: ${targetText}`);
    lines.push(`${t('countdown.remaining')}: ${remainingText}`);

    sendMessage({
      type: 'text-input',
      text: t('countdown.autoMessage'),
      countdown_target: lines.join('\n'),
    });

    toaster.create({
      title: t('countdown.shared'),
      type: 'success',
      duration: 2000,
    });

    setIsOpen(false);
  };

  return (
    <DrawerRoot open={isOpen} onOpenChange={(e) => setIsOpen(e.open)} placement="end">
      <DrawerBackdrop />
      <DrawerTrigger asChild>{children}</DrawerTrigger>

      <DrawerContent style={sidebarStyles.historyDrawer.drawer.content}>
        <DrawerHeader>
          <Box display="flex" alignItems="flex-start" justifyContent="space-between" gap={4}>
            <Box>
              <DrawerTitle style={sidebarStyles.historyDrawer.drawer.title}>
                ⏳ {t('countdown.title')}
              </DrawerTitle>
              {targetMs !== null && (
                <Text fontSize="sm" color="whiteAlpha.700" fontFamily="mono">
                  {t('countdown.targetDate')}: {new Date(targetMs).toLocaleString()}
                </Text>
              )}
            </Box>
            <DrawerCloseTrigger style={sidebarStyles.historyDrawer.drawer.closeButton} />
          </Box>
        </DrawerHeader>

        <DrawerBody>
          <Box px={4} py={2}>
            <VStack align="stretch" gap={4}>
              <Box>
                <Text fontSize="sm" color="whiteAlpha.700" mb={2}>
                  {t('countdown.savedList')}
                </Text>
                {countdowns.length === 0 ? (
                  <Text fontSize="sm" color="whiteAlpha.600">
                    {t('countdown.noSaved')}
                  </Text>
                ) : (
                  <VStack align="stretch" gap={2}>
                    {countdowns.map((c) => {
                      const remaining = Math.max(0, c.target_ms - nowMs);
                      const isActive = c.id === activeId;
                      return (
                        <Box
                          key={c.id}
                          border="1px solid"
                          borderColor={isActive ? 'blue.500' : 'whiteAlpha.200'}
                          borderRadius="md"
                          bg={isActive ? 'whiteAlpha.100' : 'blackAlpha.300'}
                          p={3}
                          cursor="pointer"
                          _hover={{ bg: 'whiteAlpha.100' }}
                          onClick={() => handleSelect(c)}
                        >
                          <HStack justify="space-between" align="flex-start" gap={3}>
                            <Box minW={0} flex={1}>
                              <Text fontSize="sm" color="whiteAlpha.900" noOfLines={1}>
                                {c.description.trim() ? c.description : t('countdown.untitled')}
                              </Text>
                              <Text fontSize="xs" color="whiteAlpha.600" fontFamily="mono" noOfLines={1}>
                                {new Date(c.target_ms).toLocaleString()}
                              </Text>
                            </Box>
                            <HStack gap={2} align="flex-start">
                              <Box textAlign="right">
                                <Text fontSize="sm" fontFamily="mono" color="whiteAlpha.900">
                                  {formatRemaining(remaining)}
                                </Text>
                                {isActive && (
                                  <Text fontSize="xs" color="blue.300">
                                    {t('countdown.active')}
                                  </Text>
                                )}
                              </Box>
                              <IconButton
                                aria-label={t('countdown.delete')}
                                title={t('countdown.delete')}
                                size="sm"
                                variant="ghost"
                                color="red.300"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  deleteCountdown(c.id);
                                }}
                              >
                                <FiTrash2 />
                              </IconButton>
                            </HStack>
                          </HStack>
                        </Box>
                      );
                    })}
                  </VStack>
                )}
              </Box>

              <Box>
                <Text fontSize="sm" color="whiteAlpha.700" mb={2}>
                  {t('countdown.descriptionLabel')}
                </Text>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('countdown.descriptionPlaceholder')}
                  color="whiteAlpha.900"
                  bg="whiteAlpha.100"
                  borderColor="whiteAlpha.300"
                  _placeholder={{ color: 'whiteAlpha.500' }}
                />
              </Box>

              <Box>
                <Text fontSize="sm" color="whiteAlpha.700" mb={2}>
                  {t('countdown.targetDateLabel')}
                </Text>
                <Input
                  type="datetime-local"
                  value={targetDatetime}
                  onChange={(e) => setTargetDatetime(e.target.value)}
                  color="whiteAlpha.900"
                  bg="whiteAlpha.100"
                  borderColor="whiteAlpha.300"
                />
              </Box>

              <Box
                border="1px solid"
                borderColor="whiteAlpha.200"
                borderRadius="lg"
                bg="blackAlpha.400"
                p={4}
                color="whiteAlpha.900"
              >
                <Text fontSize="sm" color="whiteAlpha.700" mb={1}>
                  {t('countdown.remainingLabel')}
                </Text>
                <Text fontSize="2xl" fontFamily="mono" fontWeight="semibold" color="whiteAlpha.900">
                  {remainingMs === null ? '--:--:--' : formatRemaining(remainingMs)}
                </Text>
                {targetMs !== null && !isRunning && remainingMs === 0 && (
                  <Text fontSize="sm" color="whiteAlpha.700" mt={2}>
                    {t('countdown.finished')}
                  </Text>
                )}
              </Box>
            </VStack>
          </Box>
        </DrawerBody>

        <DrawerFooter>
          <HStack width="100%" justify="space-between">
            <Button variant="outline" onClick={handleShare}>
              {t('countdown.share')}
            </Button>
            <HStack gap={2}>
              {activeId && (
                <Button variant="outline" onClick={handleUpdate}>
                  {t('countdown.update')}
                </Button>
              )}
              <Button onClick={handleStart}>{t('countdown.start')}</Button>
            </HStack>
          </HStack>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}

export default CountdownDrawer;
