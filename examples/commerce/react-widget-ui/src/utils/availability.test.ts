import { describe, it, expect, beforeAll } from 'vitest';
import {
  getAvailabilityLabel,
  getAvailabilitySubtext,
  getAvailabilityTone,
} from './availability';
import { initI18n } from '../i18n';

beforeAll(() => {
  initI18n('en');
});

describe('getAvailabilityLabel', () => {
  it('returns "Availability unknown" when availability is undefined', () => {
    expect(getAvailabilityLabel(undefined)).toBe('Availability unknown');
  });

  it('returns "Availability unknown" when status is undefined', () => {
    expect(getAvailabilityLabel({})).toBe('Availability unknown');
  });

  it('returns "In stock" for in_stock status', () => {
    expect(getAvailabilityLabel({ status: 'in_stock' })).toBe('In stock');
  });

  it('returns "Out of stock" for out_of_stock status', () => {
    expect(getAvailabilityLabel({ status: 'out_of_stock' })).toBe('Out of stock');
  });

  it('returns "Orderable" for backorder status', () => {
    expect(getAvailabilityLabel({ status: 'backorder' })).toBe('Orderable');
  });

  it('returns "Orderable" for preorder status', () => {
    expect(getAvailabilityLabel({ status: 'preorder' })).toBe('Orderable');
  });

  it('returns "Availability unknown" for unknown status', () => {
    expect(getAvailabilityLabel({ status: 'some_unknown_status' })).toBe('Availability unknown');
  });
});

describe('getAvailabilitySubtext', () => {
  it('returns null when availability is undefined', () => {
    expect(getAvailabilitySubtext(undefined)).toBeNull();
  });

  it('returns null when status is undefined', () => {
    expect(getAvailabilitySubtext({})).toBeNull();
  });

  describe('in_stock status', () => {
    it('returns "X available" when onHandValue is present', () => {
      expect(getAvailabilitySubtext({ status: 'in_stock', onHandValue: 3 })).toBe('3 available');
    });

    it('returns "0 available" when onHandValue is 0', () => {
      expect(getAvailabilitySubtext({ status: 'in_stock', onHandValue: 0 })).toBe('0 available');
    });

    it('returns null when onHandValue is undefined', () => {
      expect(getAvailabilitySubtext({ status: 'in_stock' })).toBeNull();
    });
  });

  describe('out_of_stock status', () => {
    it('returns next delivery date when nextDeliveryDate is present', () => {
      const result = getAvailabilitySubtext({
        status: 'out_of_stock',
        nextDeliveryDate: '2026-02-15',
      });
      expect(result).toMatch(/Next delivery/);
      expect(result).toMatch(/Feb/);
    });

    it('returns lead time when leadtimeDayCount is present and > 0', () => {
      expect(
        getAvailabilitySubtext({ status: 'out_of_stock', leadtimeDayCount: 5 })
      ).toBe('Lead time 5 days');
    });

    it('returns null when leadtimeDayCount is 0', () => {
      expect(
        getAvailabilitySubtext({ status: 'out_of_stock', leadtimeDayCount: 0 })
      ).toBeNull();
    });

    it('returns null when no delivery info is present', () => {
      expect(getAvailabilitySubtext({ status: 'out_of_stock' })).toBeNull();
    });

    it('prefers nextDeliveryDate over leadtimeDayCount', () => {
      const result = getAvailabilitySubtext({
        status: 'out_of_stock',
        nextDeliveryDate: '2026-02-15',
        leadtimeDayCount: 5,
      });
      expect(result).toMatch(/Next delivery/);
    });
  });

  describe('backorder/preorder status', () => {
    it('returns expected date when nextDeliveryDate is present', () => {
      const result = getAvailabilitySubtext({
        status: 'backorder',
        nextDeliveryDate: '2026-03-01',
      });
      expect(result).toMatch(/Expected/);
      expect(result).toMatch(/Mar/);
    });

    it('returns lead time when leadtimeDayCount is present', () => {
      expect(
        getAvailabilitySubtext({ status: 'preorder', leadtimeDayCount: 10 })
      ).toBe('Lead time 10 days');
    });

    it('returns incoming value when incomingValue is present and > 0', () => {
      expect(
        getAvailabilitySubtext({ status: 'backorder', incomingValue: 25 })
      ).toBe('25 incoming');
    });

    it('returns null when incomingValue is 0', () => {
      expect(
        getAvailabilitySubtext({ status: 'backorder', incomingValue: 0 })
      ).toBeNull();
    });

    it('prefers nextDeliveryDate over leadtimeDayCount over incomingValue', () => {
      const result = getAvailabilitySubtext({
        status: 'backorder',
        nextDeliveryDate: '2026-03-01',
        leadtimeDayCount: 10,
        incomingValue: 25,
      });
      expect(result).toMatch(/Expected/);
    });
  });

  it('returns null for unknown status', () => {
    expect(getAvailabilitySubtext({ status: 'unknown_status' })).toBeNull();
  });
});

describe('getAvailabilityTone', () => {
  it('returns "neutral" when availability is undefined', () => {
    expect(getAvailabilityTone(undefined)).toBe('neutral');
  });

  it('returns "neutral" when status is undefined', () => {
    expect(getAvailabilityTone({})).toBe('neutral');
  });

  it('returns "positive" for in_stock status', () => {
    expect(getAvailabilityTone({ status: 'in_stock' })).toBe('positive');
  });

  it('returns "negative" for out_of_stock status', () => {
    expect(getAvailabilityTone({ status: 'out_of_stock' })).toBe('negative');
  });

  it('returns "warning" for backorder status', () => {
    expect(getAvailabilityTone({ status: 'backorder' })).toBe('warning');
  });

  it('returns "warning" for preorder status', () => {
    expect(getAvailabilityTone({ status: 'preorder' })).toBe('warning');
  });

  it('returns "neutral" for unknown status', () => {
    expect(getAvailabilityTone({ status: 'some_unknown_status' })).toBe('neutral');
  });
});
