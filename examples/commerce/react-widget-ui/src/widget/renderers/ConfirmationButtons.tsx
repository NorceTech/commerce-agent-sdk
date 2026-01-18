import React, { useState } from 'react';
import type { ConfirmationBlock } from '../types';

interface ConfirmationButtonsProps {
  confirmation: ConfirmationBlock;
  onSendMessage: (message: string) => void;
}

export const ConfirmationButtons: React.FC<ConfirmationButtonsProps> = ({
  confirmation,
  onSendMessage,
}) => {
  const [isPending, setIsPending] = useState(false);

  const handleClick = (value: string) => {
    if (isPending) return;
    setIsPending(true);
    onSendMessage(value);
  };

  return (
    <div className="agent-widget-confirmation">
      <div className="agent-widget-confirmation-options">
        {confirmation.options.map((option, index) => {
          const isPrimary = option.style === 'primary';
          const buttonClass = isPrimary
            ? 'agent-widget-confirmation-btn agent-widget-confirmation-btn-primary'
            : 'agent-widget-confirmation-btn agent-widget-confirmation-btn-secondary';

          return (
            <button
              key={`${confirmation.id}-${index}`}
              className={buttonClass}
              onClick={() => handleClick(option.value)}
              disabled={isPending}
              aria-label={option.label}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
};
