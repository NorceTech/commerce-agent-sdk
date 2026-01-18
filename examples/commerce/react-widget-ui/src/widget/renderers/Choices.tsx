import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ChoiceSet } from '../types';

interface ChoicesProps {
  choices: ChoiceSet;
  onSendMessage: (message: string) => void;
}

/**
 * Formats the tooltip/aria-label for a choice option.
 * Includes both label and variantName when variantName is present.
 */
function formatChoiceTooltip(label: string, variantName?: string | null): string {
  if (variantName != null && variantName.trim() !== '' && variantName !== label) {
    return `${label} — ${variantName}`;
  }
  return label;
}

export const Choices: React.FC<ChoicesProps> = ({ choices, onSendMessage }) => {
  const { t } = useTranslation();
  return (
    <div className="agent-widget-choices">
      <p className="agent-widget-choices-prompt">{choices.prompt}</p>
      <div className="agent-widget-choices-options">
        {choices.options.map((option, index) => {
          const tooltip = formatChoiceTooltip(option.label, option.variantName);
          return (
          <button
            key={option.id}
            className="agent-widget-choice-btn"
            onClick={() => onSendMessage(t('messages.option', { number: index + 1 }))}
            title={tooltip}
            aria-label={tooltip}
          >
            <span className="agent-widget-choice-label">{option.label}</span>
            {option.variantName != null &&
              option.variantName.trim() !== '' &&
              option.variantName !== option.label && (
              <span className="agent-widget-choice-variant-name">{option.variantName}</span>
            )}
            {option.meta && Object.keys(option.meta).length > 0 && (
              <span className="agent-widget-choice-meta">
                {Object.entries(option.meta)
                  .filter(([, v]) => v !== null && v !== undefined)
                  .slice(0, 2)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(' | ')}
              </span>
            )}
          </button>
          );
        })}
      </div>
    </div>
  );
};
