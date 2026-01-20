import {
  Box,
  Button,
  HStack,
  Textarea,
  Text,
  Tabs,
  VStack,
} from '@chakra-ui/react';
import { FiEdit2, FiTrash2 } from 'react-icons/fi';
import { formatDistanceToNow } from 'date-fns';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DrawerRoot,
  DrawerTrigger,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerBody,
  DrawerFooter,
  DrawerActionTrigger,
  DrawerBackdrop,
  DrawerCloseTrigger,
} from '@/components/ui/drawer';
import { Checkbox } from '@/components/ui/checkbox';
import { sidebarStyles } from './sidebar-styles';
import { useHistoryDrawer } from '@/hooks/sidebar/use-history-drawer';
import { HistoryInfo } from '@/context/websocket-context';
import { useWebSocket } from '@/context/websocket-context';
import { useDiary } from '@/context/diary-context';
import { useConfig } from '@/context/character-config-context';

// Type definitions
interface HistoryDrawerProps {
  children: React.ReactNode;
}

interface HistoryItemProps {
  isSelected: boolean;
  isChecked: boolean;
  latestMessage: { content: string; timestamp: string | null };
  onSelect: () => void;
  onToggleChecked: () => void;
  onDelete: (e: React.MouseEvent) => void;
  isDeleteDisabled: boolean;
}

// Reusable components
const HistoryItem = memo(({
  isSelected,
  isChecked,
  latestMessage,
  onSelect,
  onToggleChecked,
  onDelete,
  isDeleteDisabled,
}: HistoryItemProps): JSX.Element => {
  const { t } = useTranslation();
  return (
    <Box
      {...sidebarStyles.historyDrawer.historyItem}
      {...(isSelected ? sidebarStyles.historyDrawer.historyItemSelected : {})}
      onClick={onSelect}
    >
      <Box {...sidebarStyles.historyDrawer.historyHeader}>
        <HStack gap={2} alignItems="center">
          <Box
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <Checkbox
              checked={isChecked}
              onCheckedChange={() => onToggleChecked()}
            />
          </Box>
          <Box {...sidebarStyles.historyDrawer.timestamp}>
            {latestMessage.timestamp
              ? formatDistanceToNow(new Date(latestMessage.timestamp), { addSuffix: true })
              : t('history.noMessages')}
          </Box>
        </HStack>
        <Button
          onClick={onDelete}
          disabled={isDeleteDisabled}
          {...sidebarStyles.historyDrawer.deleteButton}
        >
          <FiTrash2 />
        </Button>
      </Box>
      {latestMessage.content && (
        <Box {...sidebarStyles.historyDrawer.messagePreview}>
          {latestMessage.content}
        </Box>
      )}
    </Box>
  );
});

HistoryItem.displayName = 'HistoryItem';

// Main component
function HistoryDrawer({ children }: HistoryDrawerProps): JSX.Element {
  const { t } = useTranslation();
  const { sendMessage } = useWebSocket();
  const { diaries } = useDiary();
  const { confUid } = useConfig();
  const [tab, setTab] = useState<'history' | 'dairy'>('history');
  const [selectedUids, setSelectedUids] = useState<Set<string>>(new Set());
  const [editingUid, setEditingUid] = useState<string | null>(null);
  const [editingConfUid, setEditingConfUid] = useState<string | null>(null);
  const [draft, setDraft] = useState<string>('');
  const [diaryPage, setDiaryPage] = useState<number>(1);
  const lastDiaryCountRef = useRef<number>(0);

  const DIARY_PAGE_SIZE = 10;

  const {
    open,
    setOpen,
    historyList,
    currentHistoryUid,
    fetchAndSetHistory,
    deleteHistory,
    getLatestMessageContent,
  } = useHistoryDrawer();

  useEffect(() => {
    if (!open) return;
    // Preload diary list when opening the drawer.
    sendMessage({ type: 'fetch-diary-list', conf_uid: confUid });
  }, [confUid, open, sendMessage]);

  useEffect(() => {
    if (!open) return;
    if (tab !== 'dairy') return;
    sendMessage({ type: 'fetch-diary-list', conf_uid: confUid });
    setDiaryPage(1);
  }, [confUid, open, sendMessage, tab]);

  const filteredDiaries = useMemo(
    () => diaries.filter((d) => d.conf_uid === confUid),
    [confUid, diaries],
  );

  const sortedDiaries = useMemo(() => [...filteredDiaries].sort((a, b) => {
    const aTime = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bTime = b.created_at ? new Date(b.created_at).getTime() : 0;
    return bTime - aTime;
  }), [filteredDiaries]);

  const diaryTotalPages = useMemo(() => {
    const pages = Math.ceil(sortedDiaries.length / DIARY_PAGE_SIZE);
    return pages > 0 ? pages : 1;
  }, [sortedDiaries.length]);

  const diaryPageItems = useMemo(() => {
    const start = (diaryPage - 1) * DIARY_PAGE_SIZE;
    return sortedDiaries.slice(start, start + DIARY_PAGE_SIZE);
  }, [sortedDiaries, diaryPage]);

  useEffect(() => {
    if (diaryPage > diaryTotalPages) setDiaryPage(diaryTotalPages);
  }, [diaryPage, diaryTotalPages]);

  useEffect(() => {
    const prev = lastDiaryCountRef.current;
    const next = sortedDiaries.length;
    lastDiaryCountRef.current = next;

    if (tab === 'dairy' && next > prev) {
      setDiaryPage(1);
    }
  }, [sortedDiaries.length, tab]);

  const toggleSelected = (uid: string) => {
    setSelectedUids((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  const handleGenerateDiary = () => {
    const uids = Array.from(selectedUids);
    if (uids.length === 0) return;
    sendMessage({ type: 'generate-diary', history_uids: uids, conf_uid: confUid });
    setSelectedUids(new Set());
    setTab('dairy');
  };

  const startEdit = (confUid: string, uid: string, content: string) => {
    setEditingUid(uid);
    setEditingConfUid(confUid);
    setDraft(content);
  };

  const cancelEdit = () => {
    setEditingUid(null);
    setEditingConfUid(null);
    setDraft('');
  };

  const saveEdit = () => {
    if (!editingUid || !editingConfUid) return;
    sendMessage({
      type: 'update-diary',
      diary_uid: editingUid,
      conf_uid: editingConfUid,
      content: draft,
    });
    cancelEdit();
  };

  const deleteDiary = (confUid: string, uid: string) => {
    // eslint-disable-next-line no-alert
    if (!window.confirm(t('history.confirmDeleteDiary'))) return;
    sendMessage({
      type: 'delete-diary',
      diary_uid: uid,
      conf_uid: confUid,
    });
  };

  return (
    <DrawerRoot
      open={open}
      onOpenChange={(e) => setOpen(e.open)}
      placement="start"
    >
      <DrawerBackdrop />
      <DrawerTrigger asChild>{children}</DrawerTrigger>
      <DrawerContent style={sidebarStyles.historyDrawer.drawer.content}>
        <DrawerHeader>
          <DrawerTitle style={sidebarStyles.historyDrawer.drawer.title}>
            {t('history.chatHistoryList')}
          </DrawerTitle>
          <DrawerCloseTrigger style={sidebarStyles.historyDrawer.drawer.closeButton} />
        </DrawerHeader>

        <DrawerBody>
          <Tabs.Root
            value={tab}
            onValueChange={(e) => {
              const next = e.value as 'history' | 'dairy';
              setTab(next);
              if (next === 'dairy') {
                sendMessage({ type: 'fetch-diary-list', conf_uid: confUid });
                setDiaryPage(1);
              }
            }}
            variant="plain"
          >
            <Tabs.List {...sidebarStyles.bottomTab.list}>
              <Tabs.Trigger value="history" {...sidebarStyles.bottomTab.trigger}>
                {t('history.historyTab')}
              </Tabs.Trigger>
              <Tabs.Trigger value="dairy" {...sidebarStyles.bottomTab.trigger}>
                {t('history.dairyTab')}
              </Tabs.Trigger>
            </Tabs.List>

            <Tabs.Content value="history">
              <Box {...sidebarStyles.historyDrawer.listContainer}>
                {historyList.map((history: HistoryInfo) => (
                  <HistoryItem
                    key={history.uid}
                    isSelected={currentHistoryUid === history.uid}
                    isChecked={selectedUids.has(history.uid)}
                    latestMessage={getLatestMessageContent(history)}
                    onSelect={() => fetchAndSetHistory(history.uid)}
                    onToggleChecked={() => toggleSelected(history.uid)}
                    onDelete={(e) => {
                      e.stopPropagation();
                      deleteHistory(history.uid);
                    }}
                    isDeleteDisabled={currentHistoryUid === history.uid}
                  />
                ))}
              </Box>
            </Tabs.Content>

            <Tabs.Content value="dairy">
              <Box px={4} py={2}>
                {sortedDiaries.length === 0 ? (
                  <Text color="whiteAlpha.700" fontSize="sm">
                    {t('history.noMessages')}
                  </Text>
                ) : (
                  <Box>
                    <HStack justifyContent="space-between" mb={3}>
                      <Text fontSize="xs" color="whiteAlpha.700">
                        {t('history.page')} {diaryPage} / {diaryTotalPages}
                      </Text>
                      <HStack gap={2}>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setDiaryPage((p) => Math.max(1, p - 1))}
                          disabled={diaryPage <= 1}
                        >
                          {t('history.prevPage')}
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setDiaryPage((p) => Math.min(diaryTotalPages, p + 1))}
                          disabled={diaryPage >= diaryTotalPages}
                        >
                          {t('history.nextPage')}
                        </Button>
                      </HStack>
                    </HStack>

                    <VStack alignItems="stretch" gap={3}>
                      {diaryPageItems.map((d) => (
                        <Box key={`${d.conf_uid}:${d.uid}`} p={3} bg="whiteAlpha.100" borderRadius="md">
                          <HStack justifyContent="space-between" alignItems="flex-start" mb={2}>
                            <Text fontSize="xs" color="whiteAlpha.700">
                              {d.created_at
                                ? formatDistanceToNow(new Date(d.created_at), { addSuffix: true })
                                : ''}
                            </Text>
                            <HStack gap={2}>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => startEdit(d.conf_uid, d.uid, d.content)}
                              >
                                <FiEdit2 />
                                {t('history.editDiary')}
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                colorPalette="red"
                                onClick={() => deleteDiary(d.conf_uid, d.uid)}
                              >
                                <FiTrash2 />
                                {t('history.deleteDiary')}
                              </Button>
                            </HStack>
                          </HStack>

                          {editingUid === d.uid && editingConfUid === d.conf_uid ? (
                            <Box>
                              <Textarea
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                bg="whiteAlpha.50"
                                color="white"
                                border="none"
                                minH="120px"
                              />
                              <HStack justifyContent="flex-end" mt={2}>
                                <Button size="sm" variant="ghost" onClick={cancelEdit}>
                                  {t('history.cancel')}
                                </Button>
                                <Button size="sm" onClick={saveEdit}>
                                  {t('history.save')}
                                </Button>
                              </HStack>
                            </Box>
                          ) : (
                            <Text fontSize="sm" color="white" whiteSpace="pre-wrap">
                              {d.content}
                            </Text>
                          )}
                        </Box>
                      ))}
                    </VStack>
                  </Box>
                )}
              </Box>
            </Tabs.Content>
          </Tabs.Root>
        </DrawerBody>

        <DrawerFooter>
          {tab === 'history' && (
            <Button
              onClick={handleGenerateDiary}
              disabled={selectedUids.size === 0}
              {...sidebarStyles.historyDrawer.drawer.actionButton}
            >
              {t('history.generateDiary')}
            </Button>
          )}
          <DrawerActionTrigger asChild>
            <Button {...sidebarStyles.historyDrawer.drawer.actionButton}>
              {t('common.close')}
            </Button>
          </DrawerActionTrigger>
        </DrawerFooter>
      </DrawerContent>
    </DrawerRoot>
  );
}

export default HistoryDrawer;
