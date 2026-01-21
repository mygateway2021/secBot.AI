import { Box, Flex, Image, Text, Spinner } from '@chakra-ui/react';
import { useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { useChatHistory } from '@/context/chat-history-context';
import { useConfig } from '@/context/character-config-context';
import { useAiState } from '@/context/ai-state-context';

export default function ChatPage(): JSX.Element {
  const {
    messages,
    currentSpeakerName,
    currentSpeakerAvatar,
  } = useChatHistory();

  const {
    confUid,
    confName,
    getChatAvatarForConfUid,
  } = useConfig();

  const { aiState } = useAiState();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const characterName = currentSpeakerName || confName || 'Character';
  const configuredAvatar = useMemo(() => (confUid ? getChatAvatarForConfUid(confUid) : ''), [confUid, getChatAvatarForConfUid]);
  const characterImageSrc = configuredAvatar || currentSpeakerAvatar || '';

  // Get the last AI message content to display
  const displayContent = useMemo(() => {
    const aiMessages = messages.filter(m => m.role === 'ai' && m.type === 'text');
    return aiMessages.length > 0 ? aiMessages[aiMessages.length - 1].content : '';
  }, [messages]);

  // Check if AI is currently generating response
  const isGenerating = useMemo(() => {
    return aiState === 'thinking-speaking';
  }, [aiState]);

  // Auto-scroll to bottom as the response grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [displayContent, isGenerating]);

  return (
    <Box
      position="absolute"
      inset={0}
      zIndex={9}
      bg="rgba(10, 12, 16, 0.82)"
      backdropFilter="blur(10px)"
      border="1px solid"
      borderColor="whiteAlpha.200"
    >
      <Flex direction="column" height="100%" minH={0}>
        <Flex
          px={4}
          py={3}
          align="center"
          justify="space-between"
          borderBottom="1px solid"
          borderColor="whiteAlpha.200"
          flexShrink={0}
        >
          <Box />
          <Text fontSize="xs" color="whiteAlpha.600">
            Scroll to view full content
          </Text>
        </Flex>

        <Box
          ref={scrollRef}
          flex={1}
          minH={0}
          overflowY="auto"
          overflowX="hidden"
          py={2}
        >
          <Flex justify="center" px={4} py={4}>
            <Box
              maxW="1200px"
              width="100%"
              bgGradient="linear(to-br, gray.800, gray.900)"
              border="2px solid"
              borderColor="whiteAlpha.300"
              borderRadius="2xl"
              px={{ base: 6, md: 8 }}
              py={{ base: 6, md: 8 }}
              backdropFilter="blur(12px)"
              boxShadow="2xl"
              position="relative"
              _before={{
                content: '""',
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                bg: 'blackAlpha.100',
                borderRadius: '2xl',
                zIndex: -1,
              }}
            >
              <Flex gap={5} align="flex-start">
                <Box
                  flexShrink={0}
                  width="200px"
                  height="200px"
                  borderRadius="xl"
                  overflow="hidden"
                  border="2px solid"
                  borderColor="whiteAlpha.300"
                  bg="blackAlpha.400"
                  boxShadow="lg"
                >
                  {characterImageSrc ? (
                    <Image
                      src={characterImageSrc}
                      alt={characterName}
                      width="100%"
                      height="100%"
                      objectFit="cover"
                    />
                  ) : (
                    <Flex width="100%" height="100%" align="center" justify="center">
                      <Text fontSize="xs" color="whiteAlpha.700" textAlign="center" px={2}>
                        No image
                      </Text>
                    </Flex>
                  )}
                </Box>

                <Box flex={1} minW={0}>
                  <Text fontSize="lg" fontWeight="semibold" color="whiteAlpha.900" mb={3}>
                    {characterName}
                  </Text>
                  {isGenerating ? (
                    <Flex align="center" gap={3} py={4}>
                      <Spinner size="md" color="blue.400" />
                      <Text fontSize="md" color="whiteAlpha.700">
                        Generating response...
                      </Text>
                    </Flex>
                  ) : displayContent.trim() ? (
                    <Box
                      fontSize="md"
                      lineHeight="1.8"
                      color="whiteAlpha.900"
                      className="markdown-content"
                      css={{
                        '& p': { marginBottom: '1rem' },
                        '& p:last-child': { marginBottom: 0 },
                        '& h1': { fontSize: '1.8rem', fontWeight: 'bold', color: 'white', marginTop: '1.5rem', marginBottom: '0.75rem' },
                        '& h2': { fontSize: '1.5rem', fontWeight: 'bold', color: 'white', marginTop: '1.25rem', marginBottom: '0.625rem' },
                        '& h3': { fontSize: '1.25rem', fontWeight: 'bold', color: 'white', marginTop: '1rem', marginBottom: '0.5rem' },
                        '& h4, & h5, & h6': { color: 'white', marginTop: '0.75rem', marginBottom: '0.5rem' },
                        '& ul, & ol': { paddingLeft: '1.5rem', marginBottom: '1rem' },
                        '& li': { marginBottom: '0.5rem' },
                        '& code': { 
                          bg: 'whiteAlpha.200', 
                          padding: '0.2rem 0.4rem', 
                          borderRadius: 'sm',
                          fontSize: '0.9em',
                          fontFamily: 'monospace',
                        },
                        '& pre': { 
                          bg: 'gray.800', 
                          padding: '1rem', 
                          borderRadius: 'md', 
                          overflowX: 'auto',
                          marginBottom: '1rem',
                        },
                        '& pre code': {
                          bg: 'transparent',
                          padding: 0,
                        },
                        '& blockquote': { 
                          borderLeft: '4px solid', 
                          borderColor: 'blue.400', 
                          paddingLeft: '1rem', 
                          margin: '1rem 0',
                          fontStyle: 'italic',
                        },
                        '& hr': {
                          border: 'none',
                          borderTop: '1px solid',
                          borderColor: 'whiteAlpha.300',
                          margin: '1.5rem 0',
                        },
                        '& a': {
                          color: 'blue.300',
                          textDecoration: 'underline',
                          _hover: { color: 'blue.200' },
                        },
                        '& img': {
                          maxWidth: '100%',
                          height: 'auto',
                          borderRadius: 'md',
                          margin: '1rem 0',
                        },

                        // Tables (GFM) - Comprehensive styling
                        '& table': {
                          width: '100%',
                          borderCollapse: 'collapse',
                          marginBottom: '1.5rem',
                          marginTop: '1rem',
                          display: 'table',
                          borderSpacing: 0,
                          fontSize: '0.95em',
                        },
                        '& thead': {
                          display: 'table-header-group',
                        },
                        '& tbody': {
                          display: 'table-row-group',
                        },
                        '& tr': {
                          display: 'table-row',
                          borderBottom: '1px solid rgba(255, 255, 255, 0.14)',
                        },
                        '& thead tr': {
                          background: 'rgba(255, 255, 255, 0.10)',
                        },
                        '& th': {
                          display: 'table-cell',
                          padding: '0.75rem 1rem',
                          textAlign: 'left',
                          fontWeight: 600,
                          color: 'rgba(255, 255, 255, 0.95)',
                          borderRight: '1px solid rgba(255, 255, 255, 0.10)',
                          borderBottom: '2px solid rgba(255, 255, 255, 0.2)',
                          background: 'rgba(255, 255, 255, 0.10)',
                          verticalAlign: 'top',
                        },
                        '& td': {
                          display: 'table-cell',
                          padding: '0.65rem 1rem',
                          textAlign: 'left',
                          borderRight: '1px solid rgba(255, 255, 255, 0.10)',
                          verticalAlign: 'top',
                          wordBreak: 'break-word',
                        },
                        '& th:last-child, & td:last-child': {
                          borderRight: 'none',
                        },
                        '& tbody tr:nth-of-type(even)': {
                          background: 'rgba(255, 255, 255, 0.04)',
                        },
                        '& tbody tr:hover': {
                          background: 'rgba(255, 255, 255, 0.08)',
                          transition: 'background 0.2s',
                        },
                        '& td code, & th code': {
                          whiteSpace: 'nowrap',
                          fontSize: '0.85em',
                        },

                        // Mobile-friendly compact tables
                        '@media (max-width: 768px)': {
                          '& th, & td': {
                            padding: '0.5rem 0.65rem',
                            fontSize: '0.85rem',
                          },
                          '& table': {
                            fontSize: '0.85rem',
                          },
                        },
                      }}
                    >
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        rehypePlugins={[rehypeRaw]}
                        components={{
                          table: ({ node, ...props }) => (
                            <Box
                              as="div"
                              my={4}
                              borderRadius="lg"
                              border="1px solid"
                              borderColor="whiteAlpha.200"
                              overflowX="auto"
                              maxW="100%"
                            >
                              <table {...props} />
                            </Box>
                          ),
                        }}
                      >
                        {displayContent}
                      </ReactMarkdown>
                    </Box>
                  ) : (
                    <Text fontSize="md" color="whiteAlpha.700">
                      Waiting for response...
                    </Text>
                  )}
                </Box>
              </Flex>
            </Box>
          </Flex>
          <Box ref={bottomRef} height="1px" />
        </Box>
      </Flex>
    </Box>
  );
}
