import React from 'react';
import { useTranslation } from 'react-i18next';
import type { CartSummary } from '../types';

interface CartProps {
  cart: CartSummary;
}

export const Cart: React.FC<CartProps> = ({ cart }) => {
  const { t } = useTranslation();
  const itemLabel = cart.itemCount === 1 ? t('cart.item') : t('cart.item_plural');

  return (
    <div className="agent-widget-cart">
      <div className="agent-widget-cart-header">
        <span className="agent-widget-cart-icon">🛒</span>
        <span className="agent-widget-cart-count">{cart.itemCount} {itemLabel}</span>
      </div>
      {cart.items.length > 0 && (
        <ul className="agent-widget-cart-items">
          {cart.items.map((item, index) => (
            <li key={`${item.productId}-${index}`} className="agent-widget-cart-item">
              <span className="agent-widget-cart-item-name">
                {item.name || item.productId}
              </span>
              <span className="agent-widget-cart-item-qty">x{item.quantity}</span>
              {item.price?.formatted && (
                <span className="agent-widget-cart-item-price">{item.price.formatted}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {cart.totals && (
        <div className="agent-widget-cart-totals">
          {cart.totals.subtotal?.formatted && (
            <div className="agent-widget-cart-subtotal">
              <span>{t('cart.subtotal')}</span>
              <span>{cart.totals.subtotal.formatted}</span>
            </div>
          )}
          {cart.totals.total?.formatted && (
            <div className="agent-widget-cart-total">
              <span>{t('cart.total')}</span>
              <span>{cart.totals.total.formatted}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
