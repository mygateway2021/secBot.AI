/* eslint-disable import/no-extraneous-dependencies */
import { useTranslation } from 'react-i18next';
import {
  Stack,
  Box,
  Text,
  Spinner,
  IconButton,
  Table,
  Badge,
  Input,
  Progress,
  VStack,
  HStack,
  InputGroup,
} from '@chakra-ui/react';
import { FiTrash2, FiRefreshCw, FiSearch, FiFileText } from 'react-icons/fi';
import { useState, useEffect, useCallback, useRef } from 'react';
import { useConfig } from '@/context/character-config-context';
import { useWebSocket } from '@/context/websocket-context';
import { toaster } from '@/components/ui/toaster';
import { settingStyles } from './setting-styles';

interface Document {
  file_id: string;
  original_filename: string;
  status: string;
  size: number;
  timestamp: string;
}

interface KBStats {
  total_documents: number;
  total_chunks: number;
  db_size_bytes: number;
  by_status: Record<string, number>;
}

const SUPPORTED_KB_EXTENSIONS = ['.txt', '.md', '.markdown', '.pdf', '.epub'] as const;

function isSupportedKbFile(file: File): boolean {
  const filename = file.name.toLowerCase();
  return SUPPORTED_KB_EXTENSIONS.some(ext => filename.endsWith(ext));
}

function KnowledgeBase(): JSX.Element {
  const { t } = useTranslation();
  const { confUid } = useConfig();
  const { baseUrl } = useWebSocket();

  const [documents, setDocuments] = useState<Document[]>([]);
  const [filteredDocuments, setFilteredDocuments] = useState<Document[]>([]);
  const [stats, setStats] = useState<KBStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadDocuments = useCallback(async () => {
    if (!confUid) return;

    setIsLoading(true);
    try {
      const response = await fetch(`${baseUrl}/kb/${confUid}/documents`);
      if (response.ok) {
        const data = await response.json();
        setDocuments(data.data.documents || []);
      } else {
        toaster.create({
          title: t('settings.knowledgeBase.errors.loadFailed'),
          type: 'error',
        });
      }
    } catch (error) {
      console.error('Failed to load documents:', error);
      toaster.create({
        title: t('settings.knowledgeBase.errors.loadFailed'),
        type: 'error',
      });
    } finally {
      setIsLoading(false);
    }
  }, [confUid, baseUrl, t]);

  const loadStats = useCallback(async () => {
    if (!confUid) return;

    try {
      const response = await fetch(`${baseUrl}/kb/${confUid}/stats`);
      if (response.ok) {
        const data = await response.json();
        setStats(data.data);
      }
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  }, [confUid, baseUrl]);

  useEffect(() => {
    loadDocuments();
    loadStats();

    // Refresh stats every 5 seconds
    const interval = setInterval(loadStats, 5000);
    return () => clearInterval(interval);
  }, [loadDocuments, loadStats]);

  // Filter documents based on search query
  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredDocuments(documents);
    } else {
      const filtered = documents.filter(doc =>
        doc.original_filename.toLowerCase().includes(searchQuery.toLowerCase())
      );
      setFilteredDocuments(filtered);
    }
  }, [documents, searchQuery]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const validFiles = files.filter(isSupportedKbFile);

    if (validFiles.length === 0) {
      toaster.create({
        title: t('settings.knowledgeBase.errors.uploadFailed'),
        description: 'Only .txt, .md, .pdf, and .epub files are supported',
        type: 'error',
      });
      return;
    }

    // Upload the first valid file
    await handleFileUploadFromFile(validFiles[0]);
  }, [confUid, baseUrl, t]);

  const handleFileUploadFromFile = async (file: File) => {
    if (!confUid) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const response = await fetch(
        `${baseUrl}/kb/${confUid}/upload?auto_ingest=true`,
        {
          method: 'POST',
          body: formData,
        },
      );

      if (response.ok) {
        toaster.create({
          title: t('settings.knowledgeBase.uploadSuccess'),
          type: 'success',
        });
        await loadDocuments();
        await loadStats();
      } else {
        const error = await response.json();
        toaster.create({
          title: t('settings.knowledgeBase.errors.uploadFailed'),
          description: error.detail || '',
          type: 'error',
        });
      }
    } catch (error) {
      console.error('Upload failed:', error);
      toaster.create({
        title: t('settings.knowledgeBase.errors.uploadFailed'),
        type: 'error',
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleUploadClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await handleFileUploadFromFile(file);

    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleDelete = async (fileId: string) => {
    if (!confUid) return;

    try {
      const response = await fetch(`${baseUrl}/kb/${confUid}/documents/${fileId}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        toaster.create({
          title: t('settings.knowledgeBase.deleteSuccess'),
          type: 'success',
        });
        await loadDocuments();
        await loadStats();
      } else {
        toaster.create({
          title: t('settings.knowledgeBase.errors.deleteFailed'),
          type: 'error',
        });
      }
    } catch (error) {
      console.error('Delete failed:', error);
      toaster.create({
        title: t('settings.knowledgeBase.errors.deleteFailed'),
        type: 'error',
      });
    }
  };

  const getStatusBadge = (status: string) => {
    const statusColors: Record<string, string> = {
      indexed: 'green',
      processing: 'yellow',
      uploaded: 'blue',
      error: 'red',
    };

    return (
      <Badge colorPalette={statusColors[status] || 'gray'}>
        {t(`settings.knowledgeBase.status.${status}`, { defaultValue: status })}
      </Badge>
    );
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!confUid) {
    return (
      <Box p={4}>
        <Text color="gray.500">
          {t('settings.knowledgeBase.noCharacterSelected')}
        </Text>
      </Box>
    );
  }

  return (
    <Stack {...settingStyles.settingUI.container}>
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.md,.markdown,.pdf,.epub"
        style={{ display: 'none' }}
        onChange={handleFileUpload}
      />

      {/* Stats Cards */}
      {stats && (
        <Box p={4} borderWidth="1px" borderRadius="md" bg="gray.800" borderColor="whiteAlpha.200">
          <Text fontSize="lg" fontWeight="bold" color="white" mb={4}>
            {t('settings.knowledgeBase.stats.title')}
          </Text>
          <VStack gap={3} align="stretch">
            <HStack justify="space-between" align="center">
              <Text color="whiteAlpha.700">
                {t('settings.knowledgeBase.stats.totalDocuments')}
              </Text>
              <Text color="white" fontWeight="semibold">
                {stats.total_documents}
              </Text>
            </HStack>
            <HStack justify="space-between" align="center">
              <Text color="whiteAlpha.700">
                {t('settings.knowledgeBase.stats.totalChunks')}
              </Text>
              <Text color="white" fontWeight="semibold">
                {stats.total_chunks}
              </Text>
            </HStack>
            <HStack justify="space-between" align="center">
              <Text color="whiteAlpha.700">
                {t('settings.knowledgeBase.stats.dbSize')}
              </Text>
              <Text color="white" fontWeight="semibold">
                {formatFileSize(stats.db_size_bytes)}
              </Text>
            </HStack>
          </VStack>
        </Box>
      )}

      {/* Upload Section */}
      <Box p={4} borderWidth="1px" borderRadius="md" bg="gray.800" borderColor="whiteAlpha.200">
        <VStack gap={4} align="stretch">
          <Box
            border="2px dashed"
            borderColor={isDragOver ? "blue.400" : "whiteAlpha.300"}
            borderRadius="md"
            p={6}
            textAlign="center"
            bg={isDragOver ? "blue.500/10" : "transparent"}
            transition="all 0.2s"
            cursor="pointer"
            onClick={handleUploadClick}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            _hover={{ borderColor: "blue.400", bg: "blue.500/5" }}
          >
            <FiFileText size={32} style={{ margin: '0 auto 12px', color: 'var(--chakra-colors-whiteAlpha-600)' }} />
            <Text color="white" mb={2}>
              {t('settings.knowledgeBase.dragDropText')}
            </Text>
            <Text fontSize="sm" color="whiteAlpha.600">
              {t('settings.knowledgeBase.supportedFormats')}: .txt, .md, .pdf, .epub
            </Text>
          </Box>

          {isUploading && (
            <Box>
              <Text color="white" mb={2}>{t('settings.knowledgeBase.uploading')}</Text>
              <Progress.Root value={undefined} striped animated>
                <Progress.Track>
                  <Progress.Range />
                </Progress.Track>
              </Progress.Root>
            </Box>
          )}
        </VStack>
      </Box>

      {/* Documents Section */}
      <Box p={4} borderWidth="1px" borderRadius="md" bg="gray.800" borderColor="whiteAlpha.200">
        <VStack gap={4} align="stretch">
          <HStack justify="space-between" align="center">
            <Text fontSize="lg" fontWeight="bold" color="white">
              {t('settings.knowledgeBase.documents')}
            </Text>
            <HStack gap={2}>
              <IconButton
                aria-label="Refresh"
                size="sm"
                onClick={() => {
                  loadDocuments();
                  loadStats();
                }}
                disabled={isLoading}
                variant="ghost"
              >
                <FiRefreshCw />
              </IconButton>
            </HStack>
          </HStack>

          {/* Search */}
          <Box>
            <InputGroup startElement={<FiSearch />}>
              <Input
                placeholder={t('settings.knowledgeBase.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                bg="whiteAlpha.100"
                borderColor="whiteAlpha.200"
                _hover={{ bg: "whiteAlpha.200" }}
              />
            </InputGroup>
          </Box>

          {isLoading ? (
            <Box display="flex" justifyContent="center" p={8}>
              <Spinner size="lg" />
            </Box>
          ) : filteredDocuments.length === 0 ? (
            <Box textAlign="center" p={8}>
              <FiFileText size={48} style={{ margin: '0 auto 16px', color: 'var(--chakra-colors-whiteAlpha-400)' }} />
              <Text color="whiteAlpha.600">
                {searchQuery ? t('settings.knowledgeBase.noSearchResults') : t('settings.knowledgeBase.noDocuments')}
              </Text>
            </Box>
          ) : (
            <Box overflowX="auto">
              <Table.Root size="sm" variant="outline">
                <Table.Header>
                  <Table.Row>
                    <Table.ColumnHeader bg="gray.900" color="white" borderColor="whiteAlpha.200">
                      {t('settings.knowledgeBase.table.filename')}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader bg="gray.900" color="white" borderColor="whiteAlpha.200">
                      {t('settings.knowledgeBase.table.status')}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader bg="gray.900" color="white" borderColor="whiteAlpha.200">
                      {t('settings.knowledgeBase.table.size')}
                    </Table.ColumnHeader>
                    <Table.ColumnHeader bg="gray.900" color="white" borderColor="whiteAlpha.200" textAlign="center">
                      {t('settings.knowledgeBase.table.actions')}
                    </Table.ColumnHeader>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {filteredDocuments.map((doc) => (
                    <Table.Row key={doc.file_id}>
                      <Table.Cell color="white">
                        <Text fontSize="sm" maxW="200px" truncate title={doc.original_filename}>
                          {doc.original_filename}
                        </Text>
                      </Table.Cell>
                      <Table.Cell>{getStatusBadge(doc.status)}</Table.Cell>
                      <Table.Cell color="white">
                        <Text fontSize="sm">{formatFileSize(doc.size)}</Text>
                      </Table.Cell>
                      <Table.Cell textAlign="center">
                        <IconButton
                          aria-label="Delete"
                          size="sm"
                          colorPalette="red"
                          variant="ghost"
                          onClick={() => handleDelete(doc.file_id)}
                        >
                          <FiTrash2 />
                        </IconButton>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Root>
            </Box>
          )}
        </VStack>
      </Box>
    </Stack>
  );
}

export default KnowledgeBase;
