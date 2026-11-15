/** Gói nội dung 简体中文 (HB-313). Xem ranh giới minh hoạ / chính sách ở `types.ts`. */
import type { LocaleContentPack } from './types';
import { ZH_CN_PAGES } from './zh-cn-pages';
import { ZH_CN_CHAIN } from './zh-cn-chain';

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
  ...ZH_CN_PAGES,
  chain: ZH_CN_CHAIN,
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
  dining: {
    summary:
      'Pine Hill 没有餐厅：每个车站有一个小早餐台和大堂茶角。晚餐请步行到车站周边，那里有当地人开的小馆。',
    services: {
      breakfast: {
        name: '车站早餐台',
        body: '视当天供应法棍面包、糯米饭、河粉或粥，还有越南滴漏咖啡和热茶。在台前点餐，另行付款；如需在开台前出发，请前一晚告知前台。',
      },
      tea: {
        name: '大堂茶角',
        body: '全天自助茶和咖啡，已含在房价中。大叻站晚上另有一壶热姜茶。',
      },
      evening: {
        name: '车站周边的晚餐',
        body: '车站不做晚餐。前台备有纸质地图，标出步行可到的小馆、营业时间和推荐菜。',
      },
    },
    nearbyLede: '步行 5–15 分钟或短程车程内的推荐。这些店由他人经营，Pine Hill 不代为订位。',
    nearby: {
      DL: ['市中心夜市：烤米纸、热豆浆、烤串。', '湖边坡道上的叶子鸡火锅和小米糕。'],
      PT: ['海边的烧烤海鲜，现场挑选、按重量计价。', '夜市里的越南煎饼、小米糕和生鱼沙拉。'],
      VT: ['后滩附近的小煎饼和魟鱼火锅。', '去灯塔路上的海景咖啡馆。'],
    },
    notes: [
      '素食或食物过敏：请提前一天告知前台，早餐台会做准备。',
      '4 人团（Family 房型）想一起吃早餐：请提前告知，早餐台会留桌。',
      '可以把食物带回房间；多人间请在公共区用餐，保持安静。',
    ],
    seoTitle: '车站餐饮 · Pine Hill',
    seoDescription:
      'Pine Hill 三个车站的早餐台、大堂茶角和周边餐馆推荐：供应时间、房价已含什么、什么需另点。',
    illustrative: true,
  },
  included: {
    included: [
      '客房和公共区 Wi‑Fi',
      '房内瓶装饮用水，每天补充',
      '浴巾、毛巾、洗发水、沐浴露、牙刷',
      '空调或风扇（大叻：风扇和厚被）',
      '入住前、退房后寄存行李',
      '大堂自助茶和咖啡',
    ],
    dorm: ['每张床一个个人储物柜', '每张床有床帘、阅读灯和电源插座'],
    excluded: ['早餐、晚餐和其他饮品', '机场或车站接送', '洗衣', '车站周边的第三方服务'],
  },
};
