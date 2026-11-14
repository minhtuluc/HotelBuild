/** Gói nội dung 简体中文 (HB-313). Xem ranh giới minh hoạ / chính sách ở `types.ts`. */
import type { LocaleContentPack } from './types';

export const ZH_CN_PACK: LocaleContentPack = {
  landing: {
    stations: [
      {
        code: 'DL',
        name: '大叻',
        kind: '高原，松林山丘',
        altitude: '约 1,500 米',
        climate: '全年凉爽；夜间可低于 15 °C',
        bestMonths: '11 月至次年 3 月，旱季',
        getThere: '距连姜机场约 30 公里；从胡志明市乘大巴约 7 小时',
        note: '晚上请带外套。晨雾通常在 9 点前散去。',
        illustrative: true,
      },
      {
        code: 'PT',
        name: '藩切',
        kind: '海边，沙丘',
        altitude: '海平面',
        climate: '阳光充足，11 月至次年 4 月风大',
        bestMonths: '12 月至次年 4 月，多风晴朗的季节',
        getThere: '从西贡站乘火车到藩切站约 4 小时；走高速公路约 3 小时',
        note: '沙丘最好在日出时去，趁沙子还没变热。',
        illustrative: true,
      },
      {
        code: 'VT',
        name: '头顿',
        kind: '海边，小山，灯塔',
        altitude: '海平面',
        climate: '全年温暖；5 月至 10 月为雨季',
        bestMonths: '全年皆宜；工作日比周末安静',
        getThere: '从胡志明市走高速公路约 2 小时；也可从白藤码头乘快船',
        note: '上灯塔的路很陡，建议傍晚前往。',
        illustrative: true,
      },
    ],
    cabinClasses: [
      {
        code: 'STD',
        name: 'Standard',
        cabin: '双人车厢',
        capacity: '2 位成人',
        detail: '紧凑的双人房，适合短途旅行。',
      },
      {
        code: 'SUP',
        name: 'Superior',
        cabin: '大双人车厢',
        capacity: '2 位成人',
        detail: '比 Standard 宽敞，适合住两晚以上。',
      },
      {
        code: 'DLX',
        name: 'Deluxe',
        cabin: '三人车厢',
        capacity: '3 位成人',
        detail: '多住一人，无需再订第二间房。',
      },
      {
        code: 'FAM',
        name: 'Family',
        cabin: '四人车厢',
        capacity: '4 位成人',
        detail: '适合一家人或四人同行。',
      },
      {
        code: 'DOR',
        name: 'Dorm',
        cabin: '六人车厢，按床位出售',
        capacity: '每人 1 张床',
        detail: '独自出行或小团体：在 6 人间预订单张床位。',
      },
    ],
    fareFactors: [
      { label: '房型价格', hint: '所选房型的基础价' },
      { label: '× 季节', hint: '淡季更便宜，暑假和春节更贵' },
      { label: '× 周末', hint: '周五和周六晚' },
      { label: '× 入住率', hint: '酒店快满时' },
      { label: '× 住宿时长', hint: '住满 3 晚和 14 晚有优惠' },
      { label: '× 渠道', hint: '官网直订使用网站渠道系数' },
    ],
    sampleTicket: {
      room: 'Deluxe (DLX)',
      checkIn: '2026/12/11',
      checkOut: '2026/12/14',
      nights: [
        { date: '12/11', weekday: '周五', amount: 1_066_000, why: '淡季 × 周末 × 住 3 晚' },
        { date: '12/12', weekday: '周六', amount: 1_066_000, why: '淡季 × 周末 × 住 3 晚' },
        { date: '12/13', weekday: '周日', amount: 889_000, why: '淡季 × 住 3 晚' },
      ],
      total: 3_021_000,
    },
    farePlans: [
      {
        code: 'FLEX7',
        name: '灵活',
        deposit: '订金 30%',
        steps: [
          { fromHours: 168, label: '提前 7 天以上', refundPercent: 100, firstNightCharge: false },
          { fromHours: 72, label: '3 至 7 天', refundPercent: 50, firstNightCharge: false },
          { fromHours: 24, label: '1 至 3 天', refundPercent: 0, firstNightCharge: false },
          { fromHours: null, label: '不足 24 小时', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'SAVER3',
        name: '实惠',
        deposit: '订金 50%',
        steps: [
          { fromHours: 72, label: '提前 3 天以上', refundPercent: 100, firstNightCharge: false },
          { fromHours: 24, label: '1 至 3 天', refundPercent: 50, firstNightCharge: false },
          { fromHours: null, label: '不足 24 小时', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'LONGSTAY14',
        name: '长住',
        deposit: '订金 30%',
        steps: [
          { fromHours: 336, label: '提前 14 天以上', refundPercent: 100, firstNightCharge: false },
          { fromHours: 168, label: '7 至 14 天', refundPercent: 50, firstNightCharge: false },
          { fromHours: null, label: '不足 7 天', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'NONREF',
        name: '不可退',
        deposit: '全额支付',
        steps: [{ fromHours: null, label: '任何时间', refundPercent: 0, firstNightCharge: false }],
      },
    ],
    bookingSteps: [
      {
        title: '选择车站和日期',
        body: '选择酒店、入住和退房日期以及人数。只显示整段住宿都有空房的房型。',
      },
      {
        title: '查看每一段的价格',
        body: '每晚一行价格。选择价格方案，即可看到订金和取消时的退款截止时间。',
      },
      {
        title: '预留 10 分钟',
        body: '房间为您单独保留 10 分钟，屏幕上有倒计时。',
      },
      {
        title: '支付订金，拿到车票',
        body: '用 VNPay 或 MoMo 支付订金。您会得到形如 PH-… 的预订号，随时可以查询。',
      },
    ],
    faq: [
      {
        q: '取消的截止时间从什么时候算？',
        a: '按酒店入住时间（通常为越南时间 14:00）之前的小时数计算，而不是按日历日。入住当天上午 9 点取消，就是不足 24 小时。',
      },
      {
        q: '退款按什么金额计算？',
        a: '按您实际支付的金额，而不是预订的总价值。',
      },
      {
        q: '遇到天灾或疫情怎么办？',
        a: '因不可抗力取消，退还您已支付金额的 100%。',
      },
      {
        q: '改日期要收费吗？',
        a: '入住前 7 天以上改期一次免费。“不可退”方案收取 10% 的费用。',
      },
      {
        q: '订完后酒店超订了怎么办？',
        a: '您会被安排到同级房间或免费升级，价格按原预订不变。如果没有其他办法，全额退款并给予补偿。',
      },
    ],
  },
  properties: {
    'da-lat': {
      summary:
        '线路的第一站，在高原上。来大叻就是为了慢下来：清晨有雾，中午阳光温和，晚上凉得需要外套。',
      story: [
        '酒店坐落在松林山丘间，离市中心有一段距离，安静得能听见风声。晨雾低垂，九点前散去；傍晚气温下降很快，从平原上来的客人请带一件保暖的衣服。',
        '大叻适合住上几晚：第一晚旅途后休息，之后几天散步、绕湖骑车，或者干脆坐着不动。每一晚的价格单独印在票上，哪晚是周末、哪晚是旺季一目了然。',
      ],
      arrival: [
        '飞到连姜机场，再乘出租车或机场接驳车约 30 公里。',
        '从胡志明市乘卧铺大巴约 7 小时；很多班次夜间发车，清晨到达，早于入住时间。',
        '早于入住时间到达时，可把行李寄存在前台；入住和退房时间见上方时刻表。',
      ],
      seoTitle: '大叻站 · Pine Hill',
      seoDescription:
        'Pine Hill 大叻高原酒店：入住和退房时间、交通、房型和照片。选好日期即可查看每晚价格。',
      illustrative: true,
    },
  },
  roomTypes: {
    DLX: {
      summary: '三人车厢：一间房有三位成人的床位，三人同行无需再订第二间房。',
      description: [
        'Deluxe 是为三人同行准备的房型：情侣带一位父母、三位朋友，或带着大孩子的一家人。每人在同一间房里都有自己的床位。',
        'Deluxe 按晚计价，随季节、周末和住宿晚数变化。在搜索中选择车站和日期，即可在预留前看到印在每一段上的价格。',
      ],
      suits: '三位成人同行，或带大孩子的家庭',
      seoTitle: 'Deluxe 房型（三人车厢）· Pine Hill',
      seoDescription:
        'Pine Hill Deluxe：可住三位成人，大叻、藩切、头顿三家酒店均有。选好日期后按晚显示价格。',
      illustrative: true,
    },
  },
  photoAlts: {
    'ga-DL-poster': '绿树花园中泳池旁的木质别墅',
    'ga-DL-phong': '宽敞的木质卧室，有双人床和休息区',
    'ga-DL-canh': '林同省洲山松林中的一条路',
    'ga-PT-poster': '青山下的水边餐厅',
    'ga-PT-phong': '宽敞的木质卧室，望向花园',
    'ga-PT-canh': '藩切美奈沙丘上的一棵树',
    'ga-VT-poster': '林木山丘间的泳池别墅',
    'ga-VT-phong': '木质卧室，有双人床和窗边的两把椅子',
    'ga-VT-canh': '头顿海湾的日落',
    'hang-STD': '木质卧室中双人床的近景',
    'hang-SUP': '木质卧室，有双人床、书桌和休息区',
    'hang-DLX': '有两张床和面海休息区的卧室',
    'hang-FAM': '有两张床、桌椅和面海窗户的卧室',
    'hang-DOR': '多人间，一排带帘子的上下铺和抽屉',
    'chia-se': '日落时海湾边度假村的全景',
  },
};
