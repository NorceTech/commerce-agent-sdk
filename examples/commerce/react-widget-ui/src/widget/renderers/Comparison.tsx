import React from 'react';
import { useTranslation } from 'react-i18next';
import type { ComparisonBlock } from '../types';

interface ComparisonProps {
  comparison: ComparisonBlock;
}

export const Comparison: React.FC<ComparisonProps> = ({ comparison }) => {
  const { t } = useTranslation();
  const { productIds, rows } = comparison;

  if (productIds.length === 0 || rows.length === 0) {
    return null;
  }

  return (
    <div className="agent-widget-comparison">
      <table className="agent-widget-comparison-table">
        <thead>
          <tr>
            <th></th>
            {productIds.map((productId, index) => (
              <th key={productId}>{t('comparison.product', { number: index + 1 })}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <td className="agent-widget-comparison-key">{row.key}</td>
              {productIds.map((productId) => (
                <td key={productId}>{row.values[productId] || '-'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
