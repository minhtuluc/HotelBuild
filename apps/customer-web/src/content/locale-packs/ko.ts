/** Gói nội dung tiếng Hàn (HB-313). Xem ranh giới minh hoạ / chính sách ở `types.ts`. */
import type { LocaleContentPack } from './types';
import { KO_PAGES } from './ko-pages';
import { KO_CHAIN } from './ko-chain';

export const KO_PACK: LocaleContentPack = {
  landing: {
    stations: [
      {
        code: 'DL',
        name: '달랏',
        kind: '고원, 소나무 언덕',
        altitude: '약 1,500m',
        climate: '일 년 내내 선선하며 밤에는 15 °C 아래로 내려가기도 함',
        bestMonths: '11월~3월, 건기',
        getThere: '리엔크엉 공항에서 약 30km. 호찌민시에서 장거리 버스로 약 7시간',
        note: '저녁에는 겉옷을 챙기세요. 아침 안개는 보통 9시 전에 걷힙니다.',
        illustrative: true,
      },
      {
        code: 'PT',
        name: '판티엣',
        kind: '바다, 모래 언덕',
        altitude: '해수면',
        climate: '햇빛이 강하고 11월~4월에는 바람이 셈',
        bestMonths: '12월~4월, 바람 많고 맑은 계절',
        getThere: '사이공역에서 판티엣역까지 기차로 약 4시간. 고속도로로 약 3시간',
        note: '모래 언덕은 모래가 뜨거워지기 전, 해 뜰 무렵이 가장 좋습니다.',
        illustrative: true,
      },
      {
        code: 'VT',
        name: '붕따우',
        kind: '바다, 작은 산, 등대',
        altitude: '해수면',
        climate: '일 년 내내 따뜻하며 5월~10월은 우기',
        bestMonths: '연중. 주말보다 평일이 한적함',
        getThere: '호찌민시에서 고속도로로 약 2시간. 박당 부두에서 쾌속선도 있음',
        note: '등대로 오르는 길은 가파릅니다. 늦은 오후에 가세요.',
        illustrative: true,
      },
    ],
    cabinClasses: [
      {
        code: 'STD',
        name: 'Standard',
        cabin: '2인 객차',
        capacity: '성인 2명',
        detail: '두 사람을 위한 아담한 객실, 짧은 여행에 알맞습니다.',
      },
      {
        code: 'SUP',
        name: 'Superior',
        cabin: '넓은 2인 객차',
        capacity: '성인 2명',
        detail: 'Standard보다 넓어 2박 이상 머물기 좋습니다.',
      },
      {
        code: 'DLX',
        name: 'Deluxe',
        cabin: '3인 객차',
        capacity: '성인 3명',
        detail: '객실을 하나 더 예약하지 않아도 세 번째 사람이 묵을 수 있습니다.',
      },
      {
        code: 'FAM',
        name: 'Family',
        cabin: '4인 객차',
        capacity: '성인 4명',
        detail: '가족이나 네 명이 함께 쓰기에 좋습니다.',
      },
      {
        code: 'DOR',
        name: 'Dorm',
        cabin: '6인 객차, 침대 단위 판매',
        capacity: '1인 1침대',
        detail: '혼자 또는 소규모 여행: 6인실 침대를 하나씩 예약하세요.',
      },
    ],
    fareFactors: [
      { label: '객실 등급 요금', hint: '선택한 등급의 기본 요금' },
      { label: '× 시즌', hint: '비수기는 저렴하고 여름 방학과 뗏(설) 연휴는 높음' },
      { label: '× 주말', hint: '금요일과 토요일 밤' },
      { label: '× 객실 점유율', hint: '숙소가 거의 찼을 때' },
      { label: '× 숙박 기간', hint: '3박 이상, 14박 이상 할인' },
      { label: '× 채널', hint: '공식 사이트 직접 예약은 웹 채널 계수' },
    ],
    sampleTicket: {
      room: 'Deluxe (DLX)',
      checkIn: '2026. 12. 11.',
      checkOut: '2026. 12. 14.',
      nights: [
        { date: '12. 11.', weekday: '금', amount: 1_066_000, why: '비수기 × 주말 × 3박' },
        { date: '12. 12.', weekday: '토', amount: 1_066_000, why: '비수기 × 주말 × 3박' },
        { date: '12. 13.', weekday: '일', amount: 889_000, why: '비수기 × 3박' },
      ],
      total: 3_021_000,
    },
    farePlans: [
      {
        code: 'FLEX7',
        name: '유연',
        deposit: '예약금 30%',
        steps: [
          { fromHours: 168, label: '7일 이상 전', refundPercent: 100, firstNightCharge: false },
          { fromHours: 72, label: '3~7일 전', refundPercent: 50, firstNightCharge: false },
          { fromHours: 24, label: '1~3일 전', refundPercent: 0, firstNightCharge: false },
          { fromHours: null, label: '24시간 미만', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'SAVER3',
        name: '절약',
        deposit: '예약금 50%',
        steps: [
          { fromHours: 72, label: '3일 이상 전', refundPercent: 100, firstNightCharge: false },
          { fromHours: 24, label: '1~3일 전', refundPercent: 50, firstNightCharge: false },
          { fromHours: null, label: '24시간 미만', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'LONGSTAY14',
        name: '장기 숙박',
        deposit: '예약금 30%',
        steps: [
          { fromHours: 336, label: '14일 이상 전', refundPercent: 100, firstNightCharge: false },
          { fromHours: 168, label: '7~14일 전', refundPercent: 50, firstNightCharge: false },
          { fromHours: null, label: '7일 미만', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'NONREF',
        name: '환불 불가',
        deposit: '100% 결제',
        steps: [{ fromHours: null, label: '언제든', refundPercent: 0, firstNightCharge: false }],
      },
    ],
    bookingSteps: [
      {
        title: '역과 날짜 선택',
        body: '숙소, 체크인·체크아웃 날짜, 인원을 고르세요. 숙박 기간 내내 빈 객실이 있는 등급만 표시됩니다.',
      },
      {
        title: '구간별 요금 확인',
        body: '1박마다 요금 한 줄. 요금제를 고르면 예약금과 취소 시 환불 기한이 보입니다.',
      },
      {
        title: '10분간 보류',
        body: '객실을 10분 동안 고객님만을 위해 잡아 두며 화면에 카운트다운이 표시됩니다.',
      },
      {
        title: '예약금 결제, 승차권 받기',
        body: 'VNPay 또는 MoMo로 예약금을 결제하세요. PH-… 형식의 예약 번호를 받아 언제든 조회할 수 있습니다.',
      },
    ],
    faq: [
      {
        q: '취소 기한은 언제부터 계산하나요?',
        a: '달력 날짜가 아니라 숙소 체크인 시각(보통 베트남 시간 14:00)까지 남은 시간으로 계산합니다. 체크인 당일 오전 9시에 취소하면 24시간 미만입니다.',
      },
      {
        q: '환불은 무엇을 기준으로 하나요?',
        a: '예약 총액이 아니라 실제로 결제한 금액을 기준으로 합니다.',
      },
      {
        q: '자연재해나 전염병이 생기면요?',
        a: '불가항력으로 취소하면 결제한 금액의 100%를 환불합니다.',
      },
      {
        q: '날짜를 바꾸면 수수료가 있나요?',
        a: '체크인 7일 이상 전이면 한 번은 무료입니다. "환불 불가" 요금제는 10% 수수료가 있습니다.',
      },
      {
        q: '예약 후 숙소가 초과 예약되면 어떻게 되나요?',
        a: '같은 등급 객실로 옮기거나 무료로 업그레이드되며 예약한 요금은 그대로입니다. 다른 방법이 없으면 100% 환불과 함께 보상을 드립니다.',
      },
    ],
  },
  ...KO_PAGES,
  chain: KO_CHAIN,
  photoAlts: {
    'ga-DL-poster': '나무가 우거진 정원의 수영장 옆 목조 빌라',
    'ga-DL-phong': '더블 침대와 휴식 공간이 있는 넓은 목조 침실',
    'ga-DL-canh': '럼동성 쩌우선 소나무 숲을 지나는 길',
    'ga-PT-poster': '푸른 언덕 아래 물가의 레스토랑',
    'ga-PT-phong': '정원이 내다보이는 넓은 목조 침실',
    'ga-PT-canh': '판티엣 무이네 모래 언덕 위의 나무 한 그루',
    'ga-VT-poster': '나무 언덕에 둘러싸인 수영장 빌라',
    'ga-VT-phong': '더블 침대와 창가 의자 두 개가 있는 목조 침실',
    'ga-VT-canh': '붕따우 만의 해 질 녘',
    'hang-STD': '목조 침실의 더블 침대 클로즈업',
    'hang-SUP': '더블 침대, 책상, 휴식 공간이 있는 목조 침실',
    'hang-DLX': '침대 두 개와 바다를 향한 휴식 공간이 있는 침실',
    'hang-FAM': '침대 두 개, 테이블과 의자, 바다 쪽 창문이 있는 침실',
    'hang-DOR': '커튼이 달린 이층 침대와 서랍이 늘어선 도미토리',
    'chia-se': '해 질 녘 만을 따라 펼쳐진 리조트 전경',
  },
  dining: {
    summary:
      'Pine Hill에는 레스토랑이 없습니다. 역마다 작은 아침 식사 카운터와 로비의 차 코너가 있습니다. 저녁은 역 주변을 걸어 현지 식당에서 드세요.',
    services: {
      breakfast: {
        name: '역 아침 식사 카운터',
        body: '날에 따라 반미, 찹쌀밥, 쌀국수 또는 죽, 베트남식 드립 커피와 따뜻한 차. 카운터에서 주문하고 따로 결제합니다. 문 열기 전에 떠나신다면 전날 저녁 프런트에 알려 주세요.',
      },
      tea: {
        name: '로비 차 코너',
        body: '차와 커피를 하루 종일 셀프로 드실 수 있으며 객실 요금에 포함되어 있습니다. 달랏에서는 저녁에 따뜻한 생강차도 준비합니다.',
      },
      evening: {
        name: '역 주변 저녁 식사',
        body: '역에서는 저녁을 만들지 않습니다. 프런트에 걸어갈 수 있는 식당과 영업시간, 추천 메뉴를 담은 종이 지도가 있습니다.',
      },
    },
    nearbyLede:
      '걸어서 5~15분 또는 짧은 이동 거리의 추천입니다. 외부에서 운영하는 곳이며 Pine Hill이 자리를 대신 예약하지 않습니다.',
    nearby: {
      DL: [
        '시내 야시장: 구운 라이스페이퍼, 따뜻한 두유, 꼬치구이.',
        '호수 주변 언덕길의 닭 전골과 반깐.',
      ],
      PT: [
        '바닷가 식당의 해산물 구이. 수조에서 고르고 무게로 계산.',
        '야시장의 반쎄오, 반깐, 생선회 무침.',
      ],
      VT: ['백 비치 근처의 반콧과 가오리 전골.', '등대로 오르는 길가의 바다 전망 카페.'],
    },
    notes: [
      '채식이나 음식 알레르기가 있으면 하루 전에 프런트에 알려 주세요.',
      '4인 일행(Family 등급)이 함께 아침을 드시려면 미리 알려 주시면 자리를 잡아 둡니다.',
      '음식을 객실로 가져가셔도 됩니다. 도미토리에서는 함께 쓰는 분들을 위해 공용 공간을 이용해 주세요.',
    ],
    seoTitle: '역에서의 식사 · Pine Hill',
    seoDescription:
      'Pine Hill 세 역의 아침 식사 카운터, 로비 차 코너, 주변 식당: 운영 시간, 객실 요금에 포함된 것과 따로 주문하는 것.',
    illustrative: true,
  },
  included: {
    included: [
      '객실과 공용 공간 Wi‑Fi',
      '객실 생수, 매일 보충',
      '목욕 수건, 세면 수건, 샴푸, 바디워시, 칫솔',
      '에어컨 또는 선풍기(달랏: 선풍기와 두꺼운 이불)',
      '체크인 전·체크아웃 후 짐 보관',
      '로비 셀프 차와 커피',
    ],
    dorm: ['침대마다 개인 사물함', '침대마다 커튼, 독서등, 콘센트'],
    excluded: [
      '아침, 저녁 식사와 그 밖의 음료',
      '공항·버스터미널 픽업',
      '세탁',
      '역 주변 제3자 서비스',
    ],
  },
};
