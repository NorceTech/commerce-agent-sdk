import { i18n } from '../i18n';
import type { Availability } from '../widget/types';

export type AvailabilityTone = 'positive' | 'neutral' | 'warning' | 'negative';

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    if (isNaN(date.getTime())) {
      return dateString;
    }
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  } catch {
    return dateString;
  }
}

export function getAvailabilityLabel(avail: Availability | undefined): string {
  if (!avail || !avail.status) {
    return i18n.t('availability.unknown');
  }

  switch (avail.status) {
    case 'in_stock':
      return i18n.t('availability.inStock');
    case 'out_of_stock':
      return i18n.t('availability.outOfStock');
    case 'backorder':
    case 'preorder':
      return i18n.t('availability.orderable');
    default:
      return i18n.t('availability.unknown');
  }
}

export function getAvailabilitySubtext(
  avail: Availability | undefined
): string | null {
  if (!avail || !avail.status) {
    return null;
  }

  switch (avail.status) {
    case 'in_stock':
      if (typeof avail.onHandValue === 'number') {
        return i18n.t('availability.availableCount', { count: avail.onHandValue });
      }
      return null;

    case 'out_of_stock':
      if (avail.nextDeliveryDate) {
        return i18n.t('availability.nextDelivery', { date: formatDate(avail.nextDeliveryDate) });
      }
      if (avail.leadtimeDayCount && avail.leadtimeDayCount > 0) {
        return i18n.t('availability.leadTimeDays', { count: avail.leadtimeDayCount });
      }
      return null;

    case 'backorder':
    case 'preorder':
      if (avail.nextDeliveryDate) {
        return i18n.t('availability.expected', { date: formatDate(avail.nextDeliveryDate) });
      }
      if (avail.leadtimeDayCount && avail.leadtimeDayCount > 0) {
        return i18n.t('availability.leadTimeDays', { count: avail.leadtimeDayCount });
      }
      if (avail.incomingValue && avail.incomingValue > 0) {
        return i18n.t('availability.incomingCount', { count: avail.incomingValue });
      }
      return null;

    default:
      return null;
  }
}

export function getAvailabilityTone(
  avail: Availability | undefined
): AvailabilityTone {
  if (!avail || !avail.status) {
    return 'neutral';
  }

  switch (avail.status) {
    case 'in_stock':
      return 'positive';
    case 'out_of_stock':
      return 'negative';
    case 'backorder':
    case 'preorder':
      return 'warning';
    default:
      return 'neutral';
  }
}
