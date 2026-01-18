import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { v4 as uuidv4 } from 'uuid';
import type { AgentWidgetProps, Message, ChatResponse, ErrorEnvelope, CartSnapshot, CartChangedMeta } from './types';
import { chatStream, AuthError } from './streamClient';
import { Cards, Choices, Refinements, Comparison, Cart, ErrorBanner, ConfirmationButtons } from './renderers';
import { initI18n, setLanguage } from '../i18n';
import { resolveWidgetLanguage } from '../i18n/resolveLanguage';
import './AgentWidget.css';

function getSessionIdKey(endpoint: string, applicationId: string): string {
  return `agentWidget.sessionId:${endpoint}:${applicationId}`;
}

function getMaximizedKey(endpoint: string, applicationId: string): string {
  return `agentWidget.maximized:${endpoint}:${applicationId}`;
}

function getMaximizedState(endpoint: string, applicationId: string): boolean {
  const key = getMaximizedKey(endpoint, applicationId);
  const stored = localStorage.getItem(key);
  return stored === 'true';
}

function setMaximizedState(
  endpoint: string,
  applicationId: string,
  maximized: boolean
): void {
  const key = getMaximizedKey(endpoint, applicationId);
  localStorage.setItem(key, String(maximized));
}

function getOrCreateSessionId(endpoint: string, applicationId: string): string {
  const key = getSessionIdKey(endpoint, applicationId);
  let sessionId = localStorage.getItem(key);
  if (!sessionId) {
    sessionId = uuidv4();
    localStorage.setItem(key, sessionId);
  }
  return sessionId;
}

function resetSessionId(endpoint: string, applicationId: string): string {
  const key = getSessionIdKey(endpoint, applicationId);
  const newSessionId = uuidv4();
  localStorage.setItem(key, newSessionId);
  return newSessionId;
}

function findLastIndex<T>(arr: T[], predicate: (item: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (predicate(arr[i])) {
      return i;
    }
  }
  return -1;
}

export const AgentWidget: React.FC<AgentWidgetProps> = ({
  endpoint,
  applicationId,
  getContext,
  getAuthToken,
  defaultOpen = false,
  title,
  imageBaseUrl,
  resolveImageUrl: resolveImageUrlProp,
  cultureCode,
  uiLanguage,
  onCartChanged,
  onProductSelected,
}) => {
  const resolvedLanguage = resolveWidgetLanguage({ cultureCode, uiLanguage });
  initI18n(resolvedLanguage);
  const { t } = useTranslation();

  const displayTitle = title ?? t('widget.defaultTitle');

  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [sessionId, setSessionId] = useState(() =>
    getOrCreateSessionId(endpoint, applicationId)
  );
  const [lastUserMessage, setLastUserMessage] = useState<string | null>(null);
  const [isMaximized, setIsMaximized] = useState(() =>
    getMaximizedState(endpoint, applicationId)
  );
  const [streamStatus, setStreamStatus] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<{
    name: string;
    startedAt: number;
  } | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const lastEmittedCartRef = useRef<string | null>(null);

  /**
   * Emits cart changes to the host application via the onCartChanged callback.
   * Only emits when the cart has changed (based on cartId and a shallow signature of content).
   */
  const maybeEmitCartChanged = useCallback(
    (response: ChatResponse) => {
      const cart = response.cart;
      const cartId = cart?.cartId;
      if (!cart || !cartId || !onCartChanged) {
        return;
      }

      const cartSignature = JSON.stringify({
        cartId,
        itemCount: cart.itemCount,
        items: cart.items,
      });

      if (lastEmittedCartRef.current === cartSignature) {
        return;
      }

      lastEmittedCartRef.current = cartSignature;

      const snapshot: CartSnapshot = {
        cartId,
        itemCount: cart.itemCount,
        items: cart.items,
        totals: cart.totals,
      };

      const meta: CartChangedMeta = {
        turnId: response.turnId,
        sessionId: response.sessionId,
      };

      onCartChanged(snapshot, meta);
    },
    [onCartChanged]
  );

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    setLanguage(resolvedLanguage);
  }, [resolvedLanguage]);

  const handleReset = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    const newSessionId = resetSessionId(endpoint, applicationId);
    setSessionId(newSessionId);
    setMessages([]);
    setIsStreaming(false);
    setLastUserMessage(null);
    setStreamStatus(null);
    setActiveTool(null);
  }, [endpoint, applicationId]);

  const sendMessage = useCallback(
    async (messageText: string, isRetry = false) => {
      if (!messageText.trim() || isStreaming) return;

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      const userMessage: Message = { role: 'user', text: messageText };
      const assistantMessage: Message = {
        role: 'assistant',
        text: '',
        isStreaming: true,
      };

      if (!isRetry) {
        setMessages((prev) => [...prev, userMessage, assistantMessage]);
      } else {
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastAssistantIndex = findLastIndex(
            newMessages,
            (m: Message) => m.role === 'assistant'
          );
          if (lastAssistantIndex !== -1) {
            newMessages[lastAssistantIndex] = assistantMessage;
          } else {
            newMessages.push(assistantMessage);
          }
          return newMessages;
        });
      }

      setIsStreaming(true);
      setLastUserMessage(messageText);
      setInputValue('');

      let streamingText = '';

      const updateAssistantMessage = (updates: Partial<Message>) => {
        setMessages((prev) => {
          const newMessages = [...prev];
          const lastAssistantIndex = findLastIndex(
            newMessages,
            (m: Message) => m.role === 'assistant'
          );
          if (lastAssistantIndex !== -1) {
            newMessages[lastAssistantIndex] = {
              ...newMessages[lastAssistantIndex],
              ...updates,
            };
          }
          return newMessages;
        });
      };

      const attemptStream = async (token: string, retryOnAuth = true) => {
        try {
          const context = await Promise.resolve(getContext());

          await chatStream({
            endpoint,
            token,
            request: {
              applicationId,
              sessionId,
              message: messageText,
              context,
            },
            callbacks: {
              onDelta: (text: string) => {
                streamingText += text;
                updateAssistantMessage({ text: streamingText });
              },
              onFinal: (response: ChatResponse) => {
                updateAssistantMessage({
                  text: response.text,
                  response,
                  isStreaming: false,
                  error: response.error,
                });
                maybeEmitCartChanged(response);
                setIsStreaming(false);
                setActiveTool(null);
                setTimeout(() => {
                  setStreamStatus(null);
                }, 500);
              },
              onError: (error: ErrorEnvelope) => {
                updateAssistantMessage({
                  text: streamingText || t('widget.errorOccurred'),
                  isStreaming: false,
                  error,
                });
                setIsStreaming(false);
                setActiveTool(null);
                setStreamStatus(error.message || 'Error');
              },
              onStatus: (message: string) => {
                setStreamStatus(message);
              },
              onToolStart: (tool: string, displayName?: string) => {
                setActiveTool({ name: tool, startedAt: Date.now() });
                setStreamStatus(displayName ?? `Running ${tool}...`);
              },
              onToolEnd: (tool: string, ok: boolean, displayName?: string) => {
                setActiveTool((current) =>
                  current?.name === tool ? null : current
                );
                if (displayName) {
                  setStreamStatus(ok ? displayName : `${displayName} failed`);
                } else {
                  setStreamStatus(ok ? `${tool} done` : `${tool} failed`);
                }
              },
            },
            signal: abortControllerRef.current!.signal,
          });
        } catch (err) {
          if (err instanceof AuthError && retryOnAuth) {
            const newToken = await getAuthToken();
            return attemptStream(newToken, false);
          }

          if (abortControllerRef.current?.signal.aborted) {
            return;
          }

          const errorEnvelope: ErrorEnvelope = {
            category: 'internal',
            code: 'STREAM_ERROR',
            message: err instanceof Error ? err.message : 'Connection failed',
            retryable: true,
          };
          updateAssistantMessage({
            text: streamingText || t('widget.errorOccurred'),
            isStreaming: false,
            error: errorEnvelope,
          });
          setIsStreaming(false);
        }
      };

      try {
        const token = await getAuthToken();
        await attemptStream(token);
      } catch {
        const errorEnvelope: ErrorEnvelope = {
          category: 'auth',
          code: 'AUTH_ERROR',
          message: 'Failed to get authentication token',
          retryable: true,
        };
        updateAssistantMessage({
          text: t('widget.authFailed'),
          isStreaming: false,
          error: errorEnvelope,
        });
        setIsStreaming(false);
      }
    },
    [
      endpoint,
      applicationId,
      sessionId,
      getContext,
      getAuthToken,
      isStreaming,
      t,
      maybeEmitCartChanged,
    ]
  );

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      sendMessage(inputValue);
    },
    [inputValue, sendMessage]
  );

  const handleRetry = useCallback(() => {
    if (lastUserMessage) {
      sendMessage(lastUserMessage, true);
    }
  }, [lastUserMessage, sendMessage]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(inputValue);
      }
    },
    [inputValue, sendMessage]
  );

  const handleToggleMaximize = useCallback(() => {
    const container = messagesContainerRef.current;
    const wasNearBottom =
      container &&
      container.scrollHeight - container.scrollTop - container.clientHeight <
        100;

    setIsMaximized((prev) => {
      const newValue = !prev;
      setMaximizedState(endpoint, applicationId, newValue);
      return newValue;
    });

    if (wasNearBottom) {
      requestAnimationFrame(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
      });
    }
  }, [endpoint, applicationId]);

  const renderStructuredBlocks = (response: ChatResponse) => {
    const blocks: React.ReactNode[] = [];

        if (response.cards && response.cards.length > 0) {
          blocks.push(
            <Cards
              key="cards"
              cards={response.cards}
              onSendMessage={sendMessage}
              imageBaseUrl={imageBaseUrl}
              resolveImageUrl={resolveImageUrlProp}
              onProductSelected={onProductSelected}
            />
          );
        }

    if (response.choices) {
      blocks.push(
        <Choices
          key="choices"
          choices={response.choices}
          onSendMessage={sendMessage}
        />
      );
    }

    if (response.refinements && response.refinements.length > 0) {
      blocks.push(
        <Refinements
          key="refinements"
          refinements={response.refinements}
          onSendMessage={sendMessage}
        />
      );
    }

    if (response.comparison) {
      blocks.push(
        <Comparison key="comparison" comparison={response.comparison} />
      );
    }

    if (response.cart) {
      blocks.push(<Cart key="cart" cart={response.cart} />);
    }

    if (response.confirmation) {
      blocks.push(
        <ConfirmationButtons
          key="confirmation"
          confirmation={response.confirmation}
          onSendMessage={sendMessage}
        />
      );
    }

    return blocks;
  };

  return (
    <>
      <button
        className="agent-widget-fab"
        onClick={() => setIsOpen(!isOpen)}
        aria-label={isOpen ? t('widget.closeAssistant') : t('widget.openAssistant')}
      >
        {isOpen ? (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z" />
          </svg>
        )}
      </button>

      {isOpen && (
        <div
          className={`agent-widget-drawer ${isMaximized ? 'agent-widget-drawer-maximized' : 'agent-widget-drawer-compact'}`}
        >
          <div className="agent-widget-header">
            <h3 className="agent-widget-title">{displayTitle}</h3>
            <div className="agent-widget-header-actions">
              <button
                className="agent-widget-header-btn"
                onClick={handleReset}
                title={t('widget.resetChat')}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M17.65 6.35A7.958 7.958 0 0012 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0112 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" />
                </svg>
              </button>
              <button
                className="agent-widget-header-btn"
                onClick={handleToggleMaximize}
                title={isMaximized ? t('widget.restoreChat') : t('widget.maximizeChat')}
                aria-label={isMaximized ? t('widget.restoreChat') : t('widget.maximizeChat')}
              >
                {isMaximized ? (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                    <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z" />
                  </svg>
                )}
              </button>
              <button
                className="agent-widget-header-btn"
                onClick={() => setIsOpen(false)}
                title={t('widget.close')}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor">
                  <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
                </svg>
              </button>
            </div>
          </div>

          <div className="agent-widget-messages" ref={messagesContainerRef}>
            {messages.length === 0 && (
              <div className="agent-widget-empty">
                <p>{t('widget.emptyState')}</p>
              </div>
            )}
            {messages.map((message, index) => (
              <div
                key={index}
                className={`agent-widget-message agent-widget-message-${message.role}`}
              >
                <div className="agent-widget-message-content">
                  {message.text}
                  {message.isStreaming && (
                    <span className="agent-widget-typing-indicator">
                      <span></span>
                      <span></span>
                      <span></span>
                    </span>
                  )}
                </div>
                {message.role === 'assistant' &&
                  !message.isStreaming &&
                  message.response &&
                  renderStructuredBlocks(message.response)}
                {message.role === 'assistant' &&
                  !message.isStreaming &&
                  message.error && (
                    <ErrorBanner
                      error={message.error}
                      onRetry={message.error.retryable ? handleRetry : undefined}
                    />
                  )}
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {(isStreaming || streamStatus || activeTool) && (
            <div className="agent-widget-status-bar">
              <span className="agent-widget-status-text">{streamStatus}</span>
              {(isStreaming || activeTool) && (
                <span className="agent-widget-status-spinner">
                  <span></span>
                  <span></span>
                  <span></span>
                </span>
              )}
            </div>
          )}

          <form className="agent-widget-input-row" onSubmit={handleSubmit}>
            <textarea
              className="agent-widget-input"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('widget.inputPlaceholder')}
              disabled={isStreaming}
              rows={1}
            />
            <button
              type="submit"
              className="agent-widget-send-btn"
              disabled={isStreaming || !inputValue.trim()}
            >
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
              </svg>
            </button>
          </form>
        </div>
      )}
    </>
  );
};

export type { AgentWidgetProps };
