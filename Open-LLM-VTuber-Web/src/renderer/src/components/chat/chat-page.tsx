import { Box, Flex, IconButton, Image, Spinner, Text } from '@chakra-ui/react';
import { useEffect, useMemo, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import { FiPrinter } from 'react-icons/fi';
import { Tooltip } from '@/components/ui/tooltip';
import { useChatHistory } from '@/context/chat-history-context';
import { useConfig } from '@/context/character-config-context';
import { useAiState } from '@/context/ai-state-context';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function convertMarkdownToHTML(markdown: string): string {
  let html = escapeHtml(markdown);

  // Fenced code blocks
  html = html.replace(/```[\w-]*\n([\s\S]*?)```/g, (_m, code: string) => {
    return `<pre><code>${code}</code></pre>`;
  });

  // Inline code
  html = html.replace(/`([^`]+?)`/g, '<code>$1</code>');

  // Headers
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Lists: convert list lines to <li>, then wrap consecutive items
  html = html.replace(/^(?:-|\*)\s+(.+)$/gim, '<li>$1</li>');
  html = html.replace(/(?:^|\n)((?:<li>.*<\/li>(?:\n|$))+)/g, (_m, group: string) => {
    const trimmed = group.trim();
    return `\n<ul>\n${trimmed}\n</ul>\n`;
  });

  // Paragraphs
  html = html
    .split(/\n\n+/)
    .map((para) => {
      const trimmed = para.trim();
      if (!trimmed) return '';
      if (trimmed.startsWith('<')) return trimmed;
      return `<p>${trimmed.replace(/\n/g, '<br/>')}</p>`;
    })
    .filter(Boolean)
    .join('\n');

  return html;
}

function formatTimestampForTranscript(timestamp: string | undefined): string {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

export default function ChatPage(): JSX.Element {
  const {
    messages,
    currentSpeakerName,
    currentSpeakerAvatar,
    ragReferences,
  } = useChatHistory();

  const {
    confUid,
    confName,
    getChatAvatarForConfUid,
    llmProvider,
    llmModel,
  } = useConfig();

  const { aiState } = useAiState();

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const characterName = confName || currentSpeakerName || 'Character';
  const configuredAvatar = useMemo(() => (confUid ? getChatAvatarForConfUid(confUid) : ''), [confUid, getChatAvatarForConfUid]);
  const shouldUseSpeakerAvatar = !confName || !currentSpeakerName || currentSpeakerName === confName;
  const characterImageSrc = configuredAvatar || (shouldUseSpeakerAvatar ? (currentSpeakerAvatar || '') : '');

  // Get the LLM model display text
  const llmDisplayText = useMemo(() => {
    const formattedProvider = llmProvider 
      ? llmProvider.replace(/_/g, ' ').replace(/llm$/i, '').trim() 
      : '';
    
    if (formattedProvider && llmModel) {
      return `${formattedProvider}, ${llmModel}`;
    }
    if (llmModel) {
      return llmModel;
    }
    if (formattedProvider) {
      return formattedProvider;
    }
    return '';
  }, [llmProvider, llmModel]);

  // Get the last AI message content to display
  const displayContent = useMemo(() => {
    const aiMessages = messages
      .filter((m) => m.role === 'ai' && m.type === 'text')
      // If a character is selected, prefer only that character's AI messages.
      // This prevents briefly showing the previous character's last message after a switch.
      .filter((m) => !confName || !m.name || m.name === confName);
    return aiMessages.length > 0 ? aiMessages[aiMessages.length - 1].content : '';
  }, [messages, confName]);

  // Check if AI is currently generating response
  const isGenerating = useMemo(() => {
    return aiState === 'thinking-speaking';
  }, [aiState]);

  const printChatAsMarkdown = () => {
    const printableMessages = messages
      .filter((m) => m.role && m.type)
      .filter((m) => (m.role === 'human' || m.role === 'ai') && m.type === 'text')
      .map((m) => {
        const speaker = m.role === 'human' ? 'User' : (m.name || characterName || 'AI');
        const time = formatTimestampForTranscript(m.timestamp);
        const header = time ? `## ${speaker} (${time})` : `## ${speaker}`;
        const content = (m.content || '').trim();
        return `${header}\n\n${content}\n`;
      });

    const printedAt = new Date().toLocaleString();
    const titleLine = `# Chat Transcript: ${characterName}`;
    const metaLines = [
      llmDisplayText ? `- Model: ${llmDisplayText}` : null,
      `- Printed at: ${printedAt}`,
    ].filter(Boolean).join('\n');

    const markdown = [
      titleLine,
      '',
      metaLines,
      '',
      ...printableMessages,
    ].join('\n');

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const htmlBody = convertMarkdownToHTML(markdown);

    const printContent = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(`Chat Transcript - ${characterName}`)}</title>
          <style>
            @media print {
              body { margin: 0; padding: 20mm; }
              @page { size: A4; margin: 0; }
            }
            body {
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              line-height: 1.6;
              color: #333;
              max-width: 900px;
              margin: 0 auto;
              padding: 20px;
            }
            h1, h2, h3, h4, h5, h6 {
              margin-top: 1.25em;
              margin-bottom: 0.5em;
              font-weight: 600;
            }
            h1 { font-size: 1.8em; border-bottom: 2px solid #333; padding-bottom: 0.3em; }
            h2 { font-size: 1.25em; border-bottom: 1px solid #ccc; padding-bottom: 0.2em; }
            h3 { font-size: 1.1em; }
            p { margin: 0.75em 0; }
            ul { margin: 0.75em 0; padding-left: 1.5em; }
            li { margin: 0.25em 0; }
            code {
              background-color: #f4f4f4;
              padding: 2px 6px;
              border-radius: 3px;
              font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
              font-size: 0.95em;
            }
            pre {
              background-color: #f4f4f4;
              padding: 1em;
              border-radius: 5px;
              overflow-x: auto;
            }
          </style>
        </head>
        <body>
          <div class="content">${htmlBody}</div>
          <script>
            window.onload = () => {
              window.print();
              setTimeout(() => window.close(), 100);
            };
          </script>
        </body>
      </html>
    `;

    printWindow.document.write(printContent);
    printWindow.document.close();
  };

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
          <Box />
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
                  <Flex align="baseline" gap={2} mb={3} flexWrap="wrap">
                    <Text fontSize="lg" fontWeight="semibold" color="whiteAlpha.900">
                      {characterName}
                    </Text>
                    <Tooltip showArrow content="Print chat (Markdown)">
                      <IconButton
                        aria-label="Print chat (Markdown)"
                        size="xs"
                        variant="ghost"
                        color="whiteAlpha.900"
                        _hover={{ bg: 'whiteAlpha.200' }}
                        onClick={printChatAsMarkdown}
                      >
                        <FiPrinter />
                      </IconButton>
                    </Tooltip>
                    {llmDisplayText ? (
                      <Text fontSize="sm" color="whiteAlpha.700">
                        ({llmDisplayText})
                      </Text>
                    ) : null}
                  </Flex>
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
                      
                      {/* Display RAG References */}
                      {ragReferences && ragReferences.length > 0 && (
                        <Box
                          mt={6}
                          pt={4}
                          borderTop="1px solid"
                          borderColor="whiteAlpha.200"
                        >
                          <Text
                            fontSize="sm"
                            fontWeight="semibold"
                            color="blue.300"
                            mb={3}
                          >
                            📚 Referenced Knowledge Base Entries
                          </Text>
                          <Flex direction="column" gap={2}>
                            {ragReferences.map((ref, index) => (
                              <Box
                                key={ref.chunk_id || index}
                                p={3}
                                bg="blackAlpha.400"
                                borderRadius="md"
                                border="1px solid"
                                borderColor="whiteAlpha.100"
                              >
                                <Text
                                  fontSize="xs"
                                  fontWeight="semibold"
                                  color="blue.200"
                                  mb={1}
                                >
                                  {ref.document}
                                </Text>
                                <Text
                                  fontSize="xs"
                                  color="whiteAlpha.700"
                                  lineHeight="1.6"
                                  css={{
                                    display: '-webkit-box',
                                    WebkitLineClamp: 3,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {ref.text}
                                </Text>
                              </Box>
                            ))}
                          </Flex>
                        </Box>
                      )}
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
