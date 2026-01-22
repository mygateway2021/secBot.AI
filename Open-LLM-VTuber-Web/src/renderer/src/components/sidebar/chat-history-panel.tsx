/* eslint-disable function-paren-newline */
/* eslint-disable react/jsx-one-expression-per-line */
/* eslint-disable no-trailing-spaces */
/* eslint-disable no-nested-ternary */
/* eslint-disable import/order */
/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable react/require-default-props */
import React, { useEffect } from 'react';
import { Box, Button, Spinner, Flex, Text, Icon } from '@chakra-ui/react';
import { sidebarStyles, chatPanelStyles } from './sidebar-styles';
import { MainContainer, ChatContainer, MessageList as ChatMessageList, Message as ChatMessage, Avatar as ChatAvatar } from '@chatscope/chat-ui-kit-react';
import '@chatscope/chat-ui-kit-styles/dist/default/styles.min.css';
import { useChatHistory } from '@/context/chat-history-context';
import { Global } from '@emotion/react';
import { useConfig } from '@/context/character-config-context';
import { useWebSocket } from '@/context/websocket-context';
import { FaTools, FaCheck, FaTimes } from 'react-icons/fa';
import { useTranslation } from 'react-i18next';
import { FiTrash2 } from 'react-icons/fi';

// Main component
function ChatHistoryPanel(): JSX.Element {
  const { t } = useTranslation();
  const { messages, deleteMessage, currentHistoryUid } = useChatHistory(); // Get messages directly from context
  const { confName } = useConfig();
  const { baseUrl, sendMessage } = useWebSocket();
  const userName = "Me";

  const handleDeleteMessage = (messageId: string) => {
    deleteMessage(messageId);

    if (!currentHistoryUid) return;
    sendMessage({
      type: 'delete-message',
      history_uid: currentHistoryUid,
      message_id: messageId,
    });
  };

  const validMessages = messages.filter((msg) => msg.content || // Keep messages with content
     (msg.type === 'tool_call_status' && msg.status === 'running') || // Keep running tools
     (msg.type === 'tool_call_status' && msg.status === 'completed') || // Keep completed tools
     (msg.type === 'tool_call_status' && msg.status === 'error'), // Keep error tools
  );

  return (
    <Box
      h="full"
      overflow="hidden"
      bg="gray.900"
    >
      <Global styles={chatPanelStyles} />
      <MainContainer>
        <ChatContainer>
          <ChatMessageList>
            {validMessages.length === 0 ? (
              <Box
                display="flex"
                alignItems="center"
                justifyContent="center"
                height="100%"
                color="whiteAlpha.500"
                fontSize="sm"
              >
                {t('sidebar.noMessages')}
              </Box>
            ) : (
              validMessages.map((msg) => {
                // Check if it's a tool call message
                if (msg.type === 'tool_call_status') {
                  return (
                    <Box key={msg.id}>
                      {/* Render Tool Call Indicator using msg properties */}
                      <Flex
                        {...sidebarStyles.toolCallIndicator.container}
                        alignItems="center"
                      >
                        <Icon
                          as={FaTools}
                          {...sidebarStyles.toolCallIndicator.icon}
                        />
                        <Text {...sidebarStyles.toolCallIndicator.text}>
                          {msg.status === "running" ? `${msg.name} is using tool ${msg.tool_name}` : `${msg.name} used tool ${msg.tool_name}`}
                        </Text>
                        {/* Show spinner if running, checkmark if completed, maybe error icon? */}
                        {msg.status === "running" && (
                          <Spinner
                            size="xs"
                            color={sidebarStyles.toolCallIndicator.spinner.color}
                            ml={sidebarStyles.toolCallIndicator.spinner.ml}
                          />
                        )}
                        {msg.status === "completed" && (
                          <Icon
                            as={FaCheck}
                            {...sidebarStyles.toolCallIndicator.completedIcon}
                          />
                        )}
                        {msg.status === "error" && (
                          <Icon
                            as={FaTimes}
                            {...sidebarStyles.toolCallIndicator.errorIcon}
                          />
                        )}
                      </Flex>
                      <Flex justify="flex-end" px={2} mt={1} mb={2}>
                        <Button
                          size="xs"
                          variant="ghost"
                          color="whiteAlpha.700"
                          _hover={{ bg: 'whiteAlpha.200', color: 'whiteAlpha.900' }}
                          leftIcon={<FiTrash2 />}
                          onClick={() => handleDeleteMessage(msg.id)}
                          isDisabled={msg.status === 'running'}
                          title={t('sidebar.deleteMessage')}
                        >
                          {t('sidebar.deleteMessage')}
                        </Button>
                      </Flex>
                    </Box>
                  );
                } 
                // Render Standard Chat Message (human or ai text)
                return (
                  <Box key={msg.id}>
                    <ChatMessage
                      model={{
                        message: msg.content,
                        sentTime: msg.timestamp,
                        sender: msg.role === 'ai'
                          ? (msg.name || confName || 'AI')
                          : userName,
                        direction: msg.role === 'ai' ? 'incoming' : 'outgoing',
                        position: 'single',
                      }}
                      avatarPosition={msg.role === 'ai' ? 'tl' : 'tr'}
                      avatarSpacer={false}
                    >
                      <ChatAvatar>
                        {msg.role === 'ai' ? (
                          msg.avatar ? (
                            <img
                              src={`${baseUrl}/avatars/${msg.avatar}`}
                              alt="avatar"
                              style={{ width: '100%', height: '100%', borderRadius: '50%' }}
                              onError={(e) => {
                                const target = e.target as HTMLImageElement;
                                const fallbackName = msg.name || confName || 'A';
                                target.outerHTML = `<div style="width: 100%; height: 100%; display: flex; align-items: center; justify-content: center; border-radius: 50%; background-color: var(--chakra-colors-blue-500); color: white; font-size: 14px;">${fallbackName[0].toUpperCase()}</div>`;
                              }}
                            />
                          ) : (
                            (msg.name && msg.name[0].toUpperCase()) ||
                              (confName && confName[0].toUpperCase()) ||
                              'A'
                          )
                        ) : (
                          userName[0].toUpperCase()
                        )}
                      </ChatAvatar>
                    </ChatMessage>
                    <Flex justify="flex-end" px={2} mt={1} mb={2}>
                      <Button
                        size="xs"
                        variant="ghost"
                        color="whiteAlpha.700"
                        _hover={{ bg: 'whiteAlpha.200', color: 'whiteAlpha.900' }}
                        leftIcon={<FiTrash2 />}
                        onClick={() => handleDeleteMessage(msg.id)}
                        title={t('sidebar.deleteMessage')}
                      >
                        {t('sidebar.deleteMessage')}
                      </Button>
                    </Flex>
                  </Box>
                );
              })
            )}
          </ChatMessageList>
        </ChatContainer>
      </MainContainer>
    </Box>
  );
}

export default ChatHistoryPanel;
