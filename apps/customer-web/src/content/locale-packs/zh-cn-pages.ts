/** Trang ga và trang hạng bằng 简体中文 (HB-310, HB-311). Tách khỏi gói chính để mỗi tệp dưới 400 dòng. */
import type { LocalePagesCopy } from './types';

export const ZH_CN_PAGES: LocalePagesCopy = {
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
    'phan-thiet': {
      summary:
        '线路的中间一站，紧挨大海。藩切是阳光、风和沙丘：清晨上沙丘，中午避开烈日，下午去海边。',
      story: [
        '酒店靠近大海，离大路足够远，夜里能听见海浪。11 月至次年 4 月风大、天晴；沙丘在日出时最美，趁沙子还没变热。',
        '藩切适合慢慢住几晚：一个早晨去沙丘，一个下午去渔村，其余时间留给大海。每一晚的价格单独印在票上，哪晚是周末、哪晚在风季一目了然。',
      ],
      arrival: [
        '从西贡站乘火车到藩切站约 4 小时，再从车站乘出租车。',
        '从胡志明市走高速公路约 3 小时。',
        '早于入住时间到达时，可把行李寄存在前台；入住和退房时间见上方时刻表。',
      ],
      seoTitle: '藩切站 · Pine Hill',
      seoDescription:
        'Pine Hill 藩切海边酒店：入住和退房时间、交通、房型和照片。选好日期即可查看每晚价格。',
      illustrative: true,
    },
    'vung-tau': {
      summary: '线路的最后一站，离城市最近。头顿全年海水温暖，有小山和俯瞰海湾的灯塔。',
      story: [
        '酒店位于大海和小山之间，步行可到海滩。全年温暖；5 月至 10 月雨季多是午后短暂阵雨，很快就停。',
        '头顿适合短短一个周末，但工作日安静得多。上灯塔的路很陡，建议傍晚阳光柔和时去。每一晚的价格单独印在票上，周五和周二晚的差价在预留前就看得清楚。',
      ],
      arrival: [
        '从胡志明市走高速公路约 2 小时。',
        '从白藤码头乘快船到头顿，再从码头乘出租车。',
        '早于入住时间到达时，可把行李寄存在前台；入住和退房时间见上方时刻表。',
      ],
      seoTitle: '头顿站 · Pine Hill',
      seoDescription:
        'Pine Hill 头顿酒店，位于大海与小山之间：入住和退房时间、交通、房型和照片。选好日期即可查看每晚价格。',
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
    STD: {
      summary: '双人车厢：两位成人的紧凑房间，适合短途旅行。',
      description: [
        'Standard 是线路的基础房型：两人的紧凑房间，房价已含基础设施。适合一两晚的行程，大部分时间都在外面。',
        'Standard 按晚计价，随季节、周末和住宿晚数变化。在搜索中选择车站和日期，即可在预留前看到印在每一段上的价格。',
      ],
      suits: '情侣或两位朋友的短途旅行',
      seoTitle: 'Standard 房型（双人车厢）· Pine Hill',
      seoDescription:
        'Pine Hill Standard：两位成人的房间，大叻、藩切、头顿三家酒店均有。选好日期后按晚显示价格。',
      illustrative: true,
    },
    SUP: {
      summary: '大双人车厢：比 Standard 宽敞，适合住两晚以上。',
      description: [
        'Superior 同样供两位成人入住，但房间比 Standard 大，有更多放东西和坐的空间。住两晚以上时，这份宽敞很值得。',
        'Superior 按晚计价，随季节、周末和住宿晚数变化；住满三晚有住宿时长系数优惠。选择车站和日期即可看到每一段的价格。',
      ],
      suits: '两人住三晚以上',
      seoTitle: 'Superior 房型（大双人车厢）· Pine Hill',
      seoDescription:
        'Pine Hill Superior：两位成人的宽敞房间，三家酒店均有。选好日期后按晚显示价格。',
      illustrative: true,
    },
    FAM: {
      summary: '四人车厢：一间房有四位成人的床位，适合一家人或四人同行。',
      description: [
        'Family 为四人同行准备：带大孩子的家庭、两对情侣或一群朋友。四个床位在同一间房，不用分成两间。',
        'Family 按晚计价，随季节、周末和住宿晚数变化。四人想一起吃早餐，请提前告知车站。',
      ],
      suits: '家庭或四位成人同行',
      seoTitle: 'Family 房型（四人车厢）· Pine Hill',
      seoDescription:
        'Pine Hill Family：一间房四位成人的床位，三家酒店均有。选好日期后按晚显示价格。',
      illustrative: true,
    },
    DOR: {
      summary: '六人车厢，按床位出售：每位客人在六人间里预订一张床。',
      description: [
        'Dorm 适合独自出行或想省钱的小团体。每张床都有床帘、阅读灯、电源插座和个人储物柜；浴室在房内共用。',
        'Dorm 按床位、按晚计价。房间有六张床，会与其他客人同住；人多的团体可以在一次预订中订多张床。',
      ],
      suits: '独自出行或想省钱的小团体',
      seoTitle: 'Dorm 房型（六人车厢）· Pine Hill',
      seoDescription:
        'Pine Hill Dorm：六人间里的一张床，有床帘、灯和储物柜，三家酒店均有。选好日期后按晚显示价格。',
      illustrative: true,
    },
  },
};
