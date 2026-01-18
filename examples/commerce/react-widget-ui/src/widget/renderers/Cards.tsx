import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import type { ProductCard, ProductSelectedPayload } from '../types';
import { resolveImageUrl } from '../imageUrl';
import {
  getAvailabilityLabel,
  getAvailabilitySubtext,
  getAvailabilityTone,
} from '../../utils/availability';
import {
  formatProductLabel,
  formatProductLabelString,
} from '../../utils/productLabel';

interface CardsProps {
  cards: ProductCard[];
  onSendMessage: (message: string) => void;
  imageBaseUrl?: string;
  resolveImageUrl?: (imageKey: string) => string;
  onProductSelected?: (payload: ProductSelectedPayload) => void;
}

interface ThumbnailProps {
  imageKey: string | null | undefined;
  alt: string;
  imageBaseUrl?: string;
  resolveImageUrl?: (imageKey: string) => string;
}

const Thumbnail: React.FC<ThumbnailProps> = ({
  imageKey,
  alt,
  imageBaseUrl,
  resolveImageUrl: resolveImageUrlProp,
}) => {
  const [hasError, setHasError] = useState(false);

  const handleError = useCallback(() => {
    setHasError(true);
  }, []);

  const resolveThumbnailUrl = (key: string | null | undefined): string => {
    if (!key) return '';
    if (resolveImageUrlProp) {
      return resolveImageUrlProp(key);
    }
    if (key.startsWith('http://') || key.startsWith('https://')) {
      return key;
    }
    return resolveImageUrl(imageBaseUrl, key) ?? '';
  };

  const thumbnailUrl = resolveThumbnailUrl(imageKey);
  const showImage = thumbnailUrl && !hasError;

  return (
    <div className="agent-widget-card-thumbnail">
      {showImage ? (
        <img
          src={thumbnailUrl}
          alt={alt}
          onError={handleError}
        />
      ) : (
        <div className="agent-widget-card-thumbnail-placeholder" aria-hidden="true" />
      )}
    </div>
  );
};

export const Cards: React.FC<CardsProps> = ({
  cards,
  onSendMessage,
  imageBaseUrl,
  resolveImageUrl: resolveImageUrlProp,
  onProductSelected,
}) => {
  const { t } = useTranslation();
  const displayCards = cards.slice(0, 6);

  const handleCardSelect = useCallback(
    (card: ProductCard) => {
      if (!onProductSelected) return;
      const payload: ProductSelectedPayload = {
        productId: card.productId,
        title: card.title,
        variantName: card.variantName,
        thumbnailImageKey: card.thumbnailImageKey,
        source: 'cards',
      };
      onProductSelected(payload);
    },
    [onProductSelected]
  );

  const handleCardKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>, card: ProductCard) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleCardSelect(card);
      }
    },
    [handleCardSelect]
  );

  const handleButtonClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, action: () => void) => {
      event.stopPropagation();
      action();
    },
    []
  );

  return (
    <div className="agent-widget-cards">
      {displayCards.map((card, index) => {
        const resolvedImageUrl = resolveImageUrl(imageBaseUrl, card.imageUrl);
        const availabilityLabel = getAvailabilityLabel(card.availability);
        const availabilitySubtext = getAvailabilitySubtext(card.availability);
        const availabilityTone = getAvailabilityTone(card.availability);
        const availabilityAriaLabel = `Availability: ${availabilityLabel}${availabilitySubtext ? `. ${availabilitySubtext}` : ''}`;
        const productLabel = formatProductLabel(card);
        const productAriaLabel = formatProductLabelString(card);
        return (
        <div
          key={card.productId}
          className="agent-widget-card"
          aria-label={productAriaLabel}
          title={productAriaLabel}
          role={onProductSelected ? 'button' : undefined}
          tabIndex={onProductSelected ? 0 : undefined}
          onClick={() => handleCardSelect(card)}
          onKeyDown={(e) => handleCardKeyDown(e, card)}
        >
          {resolvedImageUrl && (
            <div className="agent-widget-card-image">
              <img src={resolvedImageUrl} alt={productAriaLabel} />
            </div>
          )}
          <div className="agent-widget-card-content">
            <div className="agent-widget-card-content-row">
              <Thumbnail
                imageKey={card.thumbnailImageKey}
                alt={card.variantName ? `${card.title} — ${card.variantName}` : card.title}
                imageBaseUrl={imageBaseUrl}
                resolveImageUrl={resolveImageUrlProp}
              />
              <div className="agent-widget-card-content-text">
                <h4 className="agent-widget-card-title">{productLabel.primary}</h4>
                {productLabel.secondary && (
                  <p className="agent-widget-card-variant-name">{productLabel.secondary}</p>
                )}
                {card.subtitle && (
                  <p className="agent-widget-card-subtitle">{card.subtitle}</p>
                )}
                {card.price?.formatted && (
                  <p className="agent-widget-card-price">{card.price.formatted}</p>
                )}
              </div>
            </div>
            <div
              className={`agent-widget-availability agent-widget-availability-${availabilityTone}`}
              aria-label={availabilityAriaLabel}
            >
              <span className="agent-widget-availability-label">
                {availabilityLabel}
              </span>
              {availabilitySubtext && (
                <span className="agent-widget-availability-subtext">
                  {availabilitySubtext}
                </span>
              )}
            </div>
            {card.badges && card.badges.length > 0 && (
              <div className="agent-widget-card-badges">
                {card.badges.map((badge, badgeIndex) => (
                  <span key={badgeIndex} className="agent-widget-badge">
                    {badge}
                  </span>
                ))}
              </div>
            )}
            {card.dimensionHints && Object.keys(card.dimensionHints).length > 0 && (
              <div className="agent-widget-card-dimensions">
                {Object.entries(card.dimensionHints).map(([key, values]) => (
                  <span key={key} className="agent-widget-dimension">
                    {key}: {values.join(', ')}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="agent-widget-card-actions">
            <button
              className="agent-widget-card-btn agent-widget-card-btn-secondary"
              onClick={(e) => handleButtonClick(e, () => onSendMessage(t('messages.tellMeMoreAboutOption', { number: index + 1 })))}
            >
              {t('actions.tellMeMore')}
            </button>
            <button
              className="agent-widget-card-btn agent-widget-card-btn-primary"
              onClick={(e) => handleButtonClick(e, () => onSendMessage(t('messages.addOptionToCart', { number: index + 1 })))}
            >
              {t('actions.addToCart')}
            </button>
          </div>
        </div>
        );
      })}
    </div>
  );
};
