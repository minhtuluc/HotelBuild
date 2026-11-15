/** Gói nội dung tiếng Nhật (HB-313). Xem ranh giới minh hoạ / chính sách ở `types.ts`. */
import type { LocaleContentPack } from './types';

export const JA_PACK: LocaleContentPack = {
  landing: {
    stations: [
      {
        code: 'DL',
        name: 'ダラット',
        kind: '高原、松の丘',
        altitude: '約 1,500 m',
        climate: '一年中涼しく、夜は 15 °C を下回ることも',
        bestMonths: '11 月〜3 月の乾季',
        getThere: 'リエンクオン空港から約 30 km。ホーチミン市から長距離バスで約 7 時間',
        note: '夜は上着をお持ちください。朝霧はたいてい 9 時前に晴れます。',
        illustrative: true,
      },
      {
        code: 'PT',
        name: 'ファンティエット',
        kind: '海、砂丘',
        altitude: '海抜 0 m',
        climate: '日差しが強く、11 月〜4 月は風が強い',
        bestMonths: '12 月〜4 月の風が強く晴れる季節',
        getThere: 'サイゴン駅からファンティエット駅まで列車で約 4 時間。高速道路で約 3 時間',
        note: '砂丘は砂が熱くなる前の日の出どきがおすすめです。',
        illustrative: true,
      },
      {
        code: 'VT',
        name: 'ブンタウ',
        kind: '海、小山、灯台',
        altitude: '海抜 0 m',
        climate: '一年中暖かく、5 月〜10 月は雨季',
        bestMonths: '通年。週末より平日のほうが静か',
        getThere: 'ホーチミン市から高速道路で約 2 時間。バクダン埠頭から高速船も',
        note: '灯台への道は急坂です。夕方に行くのがおすすめです。',
        illustrative: true,
      },
    ],
    cabinClasses: [
      {
        code: 'STD',
        name: 'Standard',
        cabin: '2 人用客車',
        capacity: '大人 2 名',
        detail: '2 人用のコンパクトな客室。短い旅に。',
      },
      {
        code: 'SUP',
        name: 'Superior',
        cabin: '広めの 2 人用客車',
        capacity: '大人 2 名',
        detail: 'Standard より広く、2 泊以上の滞在に向いています。',
      },
      {
        code: 'DLX',
        name: 'Deluxe',
        cabin: '3 人用客車',
        capacity: '大人 3 名',
        detail: '2 部屋目を予約せずに 3 人目が泊まれます。',
      },
      {
        code: 'FAM',
        name: 'Family',
        cabin: '4 人用客車',
        capacity: '大人 4 名',
        detail: 'ご家族や 4 人グループに。',
      },
      {
        code: 'DOR',
        name: 'Dorm',
        cabin: '6 人用客車、ベッド単位で販売',
        capacity: '1 人 1 ベッド',
        detail: '一人旅や少人数に：6 人部屋のベッドを 1 台ずつ予約。',
      },
    ],
    fareFactors: [
      { label: '客室クラスの料金', hint: '選んだクラスの基本料金' },
      { label: '× シーズン', hint: '閑散期は安く、夏休みとテト（旧正月）は高め' },
      { label: '× 週末', hint: '金曜と土曜の夜' },
      { label: '× 稼働率', hint: '施設が満室に近いとき' },
      { label: '× 滞在日数', hint: '3 泊以上、14 泊以上で割引' },
      { label: '× チャネル', hint: '公式サイトの直接予約はウェブの係数' },
    ],
    sampleTicket: {
      room: 'Deluxe (DLX)',
      checkIn: '2026/12/11',
      checkOut: '2026/12/14',
      nights: [
        { date: '12/11', weekday: '金', amount: 1_066_000, why: '閑散期 × 週末 × 3 泊' },
        { date: '12/12', weekday: '土', amount: 1_066_000, why: '閑散期 × 週末 × 3 泊' },
        { date: '12/13', weekday: '日', amount: 889_000, why: '閑散期 × 3 泊' },
      ],
      total: 3_021_000,
    },
    farePlans: [
      {
        code: 'FLEX7',
        name: 'フレックス',
        deposit: 'デポジット 30%',
        steps: [
          { fromHours: 168, label: '7 日以上前', refundPercent: 100, firstNightCharge: false },
          { fromHours: 72, label: '3〜7 日前', refundPercent: 50, firstNightCharge: false },
          { fromHours: 24, label: '1〜3 日前', refundPercent: 0, firstNightCharge: false },
          { fromHours: null, label: '24 時間未満', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'SAVER3',
        name: 'セーバー',
        deposit: 'デポジット 50%',
        steps: [
          { fromHours: 72, label: '3 日以上前', refundPercent: 100, firstNightCharge: false },
          { fromHours: 24, label: '1〜3 日前', refundPercent: 50, firstNightCharge: false },
          { fromHours: null, label: '24 時間未満', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'LONGSTAY14',
        name: 'ロングステイ',
        deposit: 'デポジット 30%',
        steps: [
          { fromHours: 336, label: '14 日以上前', refundPercent: 100, firstNightCharge: false },
          { fromHours: 168, label: '7〜14 日前', refundPercent: 50, firstNightCharge: false },
          { fromHours: null, label: '7 日未満', refundPercent: 0, firstNightCharge: true },
        ],
      },
      {
        code: 'NONREF',
        name: '返金不可',
        deposit: '全額支払い',
        steps: [{ fromHours: null, label: 'いつでも', refundPercent: 0, firstNightCharge: false }],
      },
    ],
    bookingSteps: [
      {
        title: '駅と日程を選ぶ',
        body: '施設、チェックイン・チェックアウト日、人数を選びます。滞在期間すべてで空きのある客室クラスだけが表示されます。',
      },
      {
        title: '区間ごとの料金を見る',
        body: '一泊ごとに料金が 1 行。料金プランを選ぶと、デポジットとキャンセル時の返金期限が表示されます。',
      },
      {
        title: '10 分間の仮押さえ',
        body: '客室を 10 分間お客様だけのために確保し、画面にカウントダウンを表示します。',
      },
      {
        title: 'デポジットを払って切符を受け取る',
        body: 'VNPay または MoMo でデポジットを支払います。PH-… 形式の予約番号が発行され、いつでも検索できます。',
      },
    ],
    faq: [
      {
        q: 'キャンセル期限はいつから数えますか？',
        a: '暦日ではなく、施設のチェックイン時刻（通常ベトナム時間 14:00）までの時間で数えます。チェックイン当日の朝 9 時のキャンセルは 24 時間未満です。',
      },
      {
        q: '返金額は何をもとに計算しますか？',
        a: '予約の総額ではなく、実際にお支払いいただいた金額をもとに計算します。',
      },
      {
        q: '自然災害や感染症の流行のときは？',
        a: '不可抗力によるキャンセルは、お支払い額の 100% を返金します。',
      },
      {
        q: '日程の変更に手数料はかかりますか？',
        a: 'チェックインの 7 日以上前なら 1 回まで無料です。「返金不可」プランは 10% の手数料がかかります。',
      },
      {
        q: '予約後に施設がオーバーブッキングになったら？',
        a: '同じクラスの客室への移動か無料のアップグレードとなり、料金は予約時のままです。ほかに方法がない場合は全額返金に加えて補償をお支払いします。',
      },
    ],
  },
  properties: {
    'da-lat': {
      summary:
        '路線の始発駅は高原の上。ダラットはゆっくり過ごすための場所です。朝は霧、昼はやわらかな日差し、夜は上着がほしいほど涼しくなります。',
      story: [
        '施設は松の丘に囲まれ、風の音が聞こえるほど中心部から離れています。朝霧は低く立ちこめ、9 時前には晴れます。夜は気温が急に下がるので、平地から来る方は暖かい一枚をお持ちください。',
        'ダラットは数泊の滞在に向いています。初日の夜は移動の疲れを取り、翌日からは湖のまわりを歩いたり自転車で回ったり、何もせずに過ごしたり。料金は一泊ごとに切符の区間に印字されるので、どの夜が週末か、どの夜が繁忙期かがすぐわかります。',
      ],
      arrival: [
        'リエンクオン空港へ飛び、タクシーか空港シャトルで約 30 km。',
        'ホーチミン市からの寝台バスは約 7 時間。夜行便が多く、チェックイン時刻より前の早朝に着きます。',
        'チェックイン時刻より早く着いたら、フロントに荷物を預けられます。チェックイン・チェックアウトの時刻は上の時刻表にあります。',
      ],
      seoTitle: 'ダラット駅 · Pine Hill',
      seoDescription:
        'ダラット高原の Pine Hill：チェックイン・チェックアウト時刻、アクセス、客室クラス、写真。日程を選ぶと一泊ごとの料金が見られます。',
      illustrative: true,
    },
  },
  roomTypes: {
    DLX: {
      summary:
        '3 人用客車：大人 3 名分の寝台がある 1 部屋なので、3 人グループでも 2 部屋目は不要です。',
      description: [
        'Deluxe は 3 人旅のためのクラスです。カップルと親御さん、友人 3 人、大きなお子さんのいるご家族など。同じ部屋で一人ひとりに寝台があります。',
        'Deluxe の料金は一泊ごとに決まり、シーズン、週末、泊数によって変わります。検索で駅と日程を選ぶと、仮押さえ前に各区間に印字された料金を確認できます。',
      ],
      suits: '大人 3 名のグループ、または大きなお子さんのいるご家族',
      seoTitle: 'Deluxe クラス（3 人用客車）· Pine Hill',
      seoDescription:
        'Pine Hill の Deluxe：大人 3 名分の寝台。ダラット、ファンティエット、ブンタウの 3 施設すべてにあります。日程を選ぶと一泊ごとの料金を表示。',
      illustrative: true,
    },
  },
  photoAlts: {
    'ga-DL-poster': '緑の庭のプールサイドに建つ木造のヴィラ',
    'ga-DL-phong': 'ダブルベッドとくつろぎスペースのある広い木の寝室',
    'ga-DL-canh': 'ラムドン省チャウソンの松林を抜ける道',
    'ga-PT-poster': '緑の丘のふもとにある水辺のレストラン',
    'ga-PT-phong': '庭を望む広い木の寝室',
    'ga-PT-canh': 'ファンティエット・ムイネーの砂丘に立つ一本の木',
    'ga-VT-poster': '木々の丘に囲まれたプール付きヴィラ',
    'ga-VT-phong': 'ダブルベッドと窓辺に椅子が 2 脚ある木の寝室',
    'ga-VT-canh': 'ブンタウの湾に沈む夕日',
    'hang-STD': '木の寝室にあるダブルベッドのクローズアップ',
    'hang-SUP': 'ダブルベッド、机、くつろぎスペースのある木の寝室',
    'hang-DLX': 'ベッド 2 台と海を望むくつろぎスペースのある寝室',
    'hang-FAM': 'ベッド 2 台、テーブルと椅子、海側の窓がある寝室',
    'hang-DOR': 'カーテン付きの二段ベッドと引き出しが並ぶドミトリー',
    'chia-se': '夕暮れの湾に面したリゾートの全景',
  },
  dining: {
    summary:
      'Pine Hill にはレストランがありません。各駅に小さな朝食カウンターとロビーのティーコーナーがあります。夕食は駅のまわりを歩いて、地元の店へどうぞ。',
    services: {
      breakfast: {
        name: '駅の朝食カウンター',
        body: '日によってバインミー、おこわ、フォーまたはお粥、ベトナム式ドリップコーヒーと温かいお茶。カウンターで注文し、別料金でお支払いください。開店前に出発する場合は前の晩にフロントへ。',
      },
      tea: {
        name: 'ロビーのティーコーナー',
        body: 'お茶とコーヒーは終日セルフサービスで、客室料金に含まれます。ダラットでは夜に温かいしょうが茶も用意します。',
      },
      evening: {
        name: '駅まわりの夕食',
        body: '駅では夕食を作りません。フロントに、歩いて行ける店と営業時間、おすすめ料理をのせた紙の地図があります。',
      },
    },
    nearbyLede:
      '徒歩 5〜15 分か短い移動で行けるおすすめです。いずれも外部の店で、Pine Hill は席の予約を代行しません。',
    nearby: {
      DL: [
        '中心部のナイトマーケット：焼きライスペーパー、温かい豆乳、串焼き。',
        '湖のまわりの坂道にある鶏鍋とバインカン。',
      ],
      PT: [
        '海辺の店の海鮮焼き。いけすから選び、重さで支払い。',
        'ナイトマーケットのバインセオ、バインカン、魚の和え物。',
      ],
      VT: [
        'バック・ビーチ近くのバインコットとエイの鍋。',
        '灯台へ向かう道沿いの海が見えるカフェ。',
      ],
    },
    notes: [
      'ベジタリアンや食物アレルギーの方は、前日までにフロントへお知らせください。',
      '4 名（Family クラス）で朝食をそろって取りたい場合は、事前にお知らせいただければ席を確保します。',
      '食べ物を客室に持ち込めます。ドミトリーでは同室の方のため共用スペースをご利用ください。',
    ],
    seoTitle: '駅での食事 · Pine Hill',
    seoDescription:
      'Pine Hill の 3 つの駅の朝食カウンター、ロビーのティーコーナー、周辺の店：提供時間、客室料金に含まれるもの、別注文のもの。',
    illustrative: true,
  },
  included: {
    included: [
      '客室と共用スペースの Wi‑Fi',
      '客室のボトル入り飲料水（毎日補充）',
      'バスタオル、フェイスタオル、シャンプー、ボディソープ、歯ブラシ',
      'エアコンまたは扇風機（ダラット：扇風機と厚手の布団）',
      'チェックイン前とチェックアウト後の荷物預かり',
      'ロビーのセルフサービスのお茶とコーヒー',
    ],
    dorm: ['ベッドごとの個人ロッカー', 'ベッドごとのカーテン、読書灯、コンセント'],
    excluded: [
      '朝食、夕食、その他の飲み物',
      '空港・バスターミナルの送迎',
      'ランドリー',
      '駅周辺の第三者のサービス',
    ],
  },
};
