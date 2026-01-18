import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ErrorEnvelope } from '../types';

interface ErrorBannerProps {
  error: ErrorEnvelope;
  onRetry?: () => void;
}

export const ErrorBanner: React.FC<ErrorBannerProps> = ({ error, onRetry }) => {
  const { t } = useTranslation();

  return (
    <div className="agent-widget-error">
      <div className="agent-widget-error-content">
        <span className="agent-widget-error-category">{error.category}</span>
        <p className="agent-widget-error-message">{error.message}</p>
        {error.code && (
          <span className="agent-widget-error-code">{t('error.codePrefix')} {error.code}</span>
        )}
      </div>
      {error.retryable && onRetry && (
        <button className="agent-widget-error-retry" onClick={onRetry}>
          {t('actions.retry')}
        </button>
      )}
    </div>
  );
};
