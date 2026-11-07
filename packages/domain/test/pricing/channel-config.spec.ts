import { describe, expect, it } from 'vitest';
import { channelConfigWarnings } from '../../src/pricing/index.js';
import type { ChannelRateConfig } from '../../src/pricing/index.js';

const WEB: ChannelRateConfig = { code: 'WEB', multiplier: '1.000', commissionPercent: '0' };
const ch = (code: string, multiplier: string, commissionPercent: string): ChannelRateConfig => ({
  code,
  multiplier,
  commissionPercent,
});

describe('channelConfigWarnings (BR-RATE-07/09, cấu hình tĩnh)', () => {
  it('ba hệ số chốt của BR-RATE-07 đều đạt cân bằng giá', () => {
    for (const config of [
      ch('OTA_BOOKING', '1.25', '18'),
      ch('OTA_AGODA', '1.22', '17'),
      ch('OTA_AIRBNB', '1.19', '15'),
    ])
      expect(channelConfigWarnings(config, WEB), config.code).toEqual([]);
  });

  it('OTA có doanh thu thuần thấp hơn WEB ⇒ E_RATE_CHANNEL_PARITY', () => {
    // 1,20 × (1 − 0,18) = 0,984 < 1,000
    expect(channelConfigWarnings(ch('OTA_BOOKING', '1.20', '18'), WEB)).toEqual([
      'E_RATE_CHANNEL_PARITY',
    ]);
    // Biên chính xác: 1/(1 − 0,18) = 1,2195… nên 1,219 vẫn thấp, 1,220 đã đạt.
    expect(channelConfigWarnings(ch('OTA_BOOKING', '1.219', '18'), WEB)).toHaveLength(1);
    expect(channelConfigWarnings(ch('OTA_BOOKING', '1.220', '18'), WEB)).toEqual([]);
  });

  it('so với doanh thu thuần của WEB (WEB có hoa hồng thì ngưỡng cũng đổi)', () => {
    const webWithCommission = ch('WEB', '1.100', '10'); // thuần 0,990
    expect(channelConfigWarnings(ch('OTA_AGODA', '1.20', '17'), webWithCommission)).toEqual([]); // 0,996
    expect(channelConfigWarnings(ch('OTA_AGODA', '1.18', '17'), webWithCommission)).toEqual([
      'E_RATE_CHANNEL_PARITY',
    ]); // 0,9794
  });

  it('kênh trực tiếp hệ số < 1,00 ⇒ E_RATE_DIRECT_BELOW_BASE; đúng 1,00 thì không', () => {
    expect(channelConfigWarnings(ch('WEB', '0.99', '0'), null)).toEqual([
      'E_RATE_DIRECT_BELOW_BASE',
    ]);
    expect(channelConfigWarnings(ch('PHONE', '0.5', '0'), WEB)).toEqual([
      'E_RATE_DIRECT_BELOW_BASE',
    ]);
    expect(channelConfigWarnings(ch('WALKIN', '1.000', '0'), WEB)).toEqual([]);
    expect(channelConfigWarnings(ch('WALKIN', '1.10', '0'), WEB)).toEqual([]);
  });

  it('AGENCY nằm ngoài phạm vi; không có WEB thì không đánh giá cân bằng giá', () => {
    expect(channelConfigWarnings(ch('AGENCY', '0.95', '10'), WEB)).toEqual([]);
    expect(channelConfigWarnings(ch('OTA_BOOKING', '1.00', '18'), null)).toEqual([]);
  });
});
