/**
 * Nội dung tĩnh trang chủ bằng tiếng Anh (HB-312). Cùng nguồn và cùng ranh giới với bản tiếng Việt ở
 * `landing-content.ts`: phần tả nơi chốn là MINH HOẠ (`illustrative: true`), phần chính sách dịch từ
 * docs/02 và cần duyệt trước ngày phát hành công khai (quyết định Q6). Mã gói, số tiền, mốc giờ giữ nguyên.
 */
import type { LandingContent } from './landing-content';

export const LANDING_EN: LandingContent = {
  stations: [
    {
      code: 'DL',
      name: 'Da Lat',
      kind: 'Highlands, pine hills',
      altitude: '≈ 1,500 m',
      climate: 'Cool all year; nights can drop below 15 °C',
      bestMonths: 'November to March, the dry season',
      getThere:
        'About 30 km from Lien Khuong airport; about 7 hours by coach from Ho Chi Minh City',
      note: 'Bring a jacket for the evening. The mist usually lifts before 9 am.',
      illustrative: true,
    },
    {
      code: 'PT',
      name: 'Phan Thiet',
      kind: 'Sea, sand dunes',
      altitude: 'Sea level',
      climate: 'Sunny, with strong winds from November to April',
      bestMonths: 'December to April, the windy and sunny season',
      getThere:
        'About 4 hours by train from Saigon station to Phan Thiet station; about 3 hours by expressway',
      note: 'The dunes are best at sunrise, before the sand heats up.',
      illustrative: true,
    },
    {
      code: 'VT',
      name: 'Vung Tau',
      kind: 'Sea, Small Mountain, lighthouse',
      altitude: 'Sea level',
      climate: 'Warm all year; rainy season May to October',
      bestMonths: 'All year; weekdays are quieter than weekends',
      getThere: 'About 2 hours by expressway from Ho Chi Minh City; fast ferry from Bach Dang pier',
      note: 'The road up to the lighthouse is steep; go in the late afternoon.',
      illustrative: true,
    },
  ],
  cabinClasses: [
    {
      code: 'STD',
      name: 'Standard',
      cabin: 'Double cabin',
      capacity: '2 adults',
      detail: 'A compact room for two, right for short trips.',
    },
    {
      code: 'SUP',
      name: 'Superior',
      cabin: 'Large double cabin',
      capacity: '2 adults',
      detail: 'Roomier than Standard, suited to stays of more than two nights.',
    },
    {
      code: 'DLX',
      name: 'Deluxe',
      cabin: 'Triple cabin',
      capacity: '3 adults',
      detail: 'Room for a third person without booking a second room.',
    },
    {
      code: 'FAM',
      name: 'Family',
      cabin: 'Four-berth cabin',
      capacity: '4 adults',
      detail: 'For a family or a group of four sharing.',
    },
    {
      code: 'DOR',
      name: 'Dorm',
      cabin: 'Six-berth cabin, sold by the bed',
      capacity: '1 bed / person',
      detail: 'Solo or small groups: book single beds in a 6-bed room.',
    },
  ],
  fareFactors: [
    { label: 'Room class price', hint: 'the base price of the class you choose' },
    { label: '× season', hint: 'low season is cheaper, summer and Tet holidays are higher' },
    { label: '× weekend', hint: 'Friday and Saturday nights' },
    { label: '× occupancy', hint: 'when the property is nearly full' },
    { label: '× length of stay', hint: 'discounts from 3 nights and from 14 nights' },
    { label: '× channel', hint: 'booking direct on the web uses the web channel factor' },
  ],
  sampleTicket: {
    room: 'Deluxe (DLX)',
    checkIn: '11/12/2026',
    checkOut: '14/12/2026',
    nights: [
      {
        date: '11/12',
        weekday: 'Fri',
        amount: 1_066_000,
        why: 'low season × weekend × 3-night stay',
      },
      {
        date: '12/12',
        weekday: 'Sat',
        amount: 1_066_000,
        why: 'low season × weekend × 3-night stay',
      },
      { date: '13/12', weekday: 'Sun', amount: 889_000, why: 'low season × 3-night stay' },
    ],
    total: 3_021_000,
  },
  farePlans: [
    {
      code: 'FLEX7',
      name: 'Flexible',
      deposit: '30% deposit',
      steps: [
        { fromHours: 168, label: '7+ days before', refundPercent: 100, firstNightCharge: false },
        { fromHours: 72, label: '3 to 7 days', refundPercent: 50, firstNightCharge: false },
        { fromHours: 24, label: '1 to 3 days', refundPercent: 0, firstNightCharge: false },
        { fromHours: null, label: 'Under 24 hours', refundPercent: 0, firstNightCharge: true },
      ],
    },
    {
      code: 'SAVER3',
      name: 'Saver',
      deposit: '50% deposit',
      steps: [
        { fromHours: 72, label: '3+ days before', refundPercent: 100, firstNightCharge: false },
        { fromHours: 24, label: '1 to 3 days', refundPercent: 50, firstNightCharge: false },
        { fromHours: null, label: 'Under 24 hours', refundPercent: 0, firstNightCharge: true },
      ],
    },
    {
      code: 'LONGSTAY14',
      name: 'Long stay',
      deposit: '30% deposit',
      steps: [
        { fromHours: 336, label: '14+ days before', refundPercent: 100, firstNightCharge: false },
        { fromHours: 168, label: '7 to 14 days', refundPercent: 50, firstNightCharge: false },
        { fromHours: null, label: 'Under 7 days', refundPercent: 0, firstNightCharge: true },
      ],
    },
    {
      code: 'NONREF',
      name: 'Non-refundable',
      deposit: 'Pay 100%',
      steps: [{ fromHours: null, label: 'Any time', refundPercent: 0, firstNightCharge: false }],
    },
  ],
  bookingSteps: [
    {
      title: 'Choose a station and dates',
      body: 'Pick the property, check-in and check-out dates, and guests. Only room classes free for the whole stay are shown.',
    },
    {
      title: 'See the price of each leg',
      body: 'One price line per night. Choose a rate plan to see the deposit and the refund cutoffs if you cancel.',
    },
    {
      title: 'Hold for 10 minutes',
      body: 'The room is held for you alone for 10 minutes, with a countdown on screen.',
    },
    {
      title: 'Pay the deposit, get your ticket',
      body: 'Pay the deposit with VNPay or MoMo. You get a booking code like PH-… to look up any time.',
    },
  ],
  faq: [
    {
      q: 'When do cancellation cutoffs start?',
      a: 'They count hours before the property’s check-in time (usually 14:00 Vietnam time), not calendar days. Cancelling at 9 am on the check-in day is under 24 hours.',
    },
    {
      q: 'What is the refund based on?',
      a: 'On what you actually paid, not the total value of the booking.',
    },
    {
      q: 'What about natural disasters or epidemics?',
      a: 'Cancelling for force majeure refunds 100% of what you paid.',
    },
    {
      q: 'Is there a fee to change dates?',
      a: 'One date change is free if made 7 or more days before check-in. The Non-refundable plan carries a 10% fee.',
    },
    {
      q: 'What if the property is overbooked after I book?',
      a: 'You are moved to a room of the same class or upgraded free of charge, keeping the price you booked. If there is no other option, you get a 100% refund plus compensation.',
    },
  ],
};
