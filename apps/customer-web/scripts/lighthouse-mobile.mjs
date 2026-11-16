#!/usr/bin/env node
/**
 * Đo Lighthouse mobile cho trang nội dung (HB-325). Kết quả và cách đọc: docs/04-thiet-ke/do-lighthouse-trang-noi-dung.md.
 *
 * Lighthouse **không** nằm trong lockfile (công cụ đo, không phải phụ thuộc của app). Cài tạm ngoài repo:
 *   mkdir -p /tmp/lh && cd /tmp/lh && npm init -y && npm i lighthouse@13.6.0
 *   NODE_PATH=/tmp/lh/node_modules node apps/customer-web/scripts/lighthouse-mobile.mjs
 * hoặc chép file này vào thư mục đã cài rồi chạy ở đó.
 *
 * Biến môi trường:
 *   BASE        gốc trang (mặc định http://127.0.0.1:3003; chạy trên `next build` + `next start` + API giả)
 *   PAGES       đường dẫn cách nhau bằng dấu phẩy, **không** có `/` đầu (Git Bash đổi `/x` thành đường dẫn
 *               Windows); `ROOT` là trang chủ
 *   RUNS        số lần đo mỗi trang (mặc định 3), lấy trung vị LCP
 *   THROTTLE    `simulate` (mặc định của Lighthouse) hoặc `devtools` (giới hạn mạng/CPU thật)
 *   CHROME_PATH đường dẫn Chrome/Chromium (vd. Chromium của Playwright)
 *   OUT         tệp JSON kết quả (mặc định results.json)
 *
 * Đo khi máy rảnh: Lighthouse nhân thời gian CPU đo được lên 4 lần, việc nặng chạy song song làm lệch số.
 */
import { writeFileSync } from 'node:fs';
import lighthouse from 'lighthouse';
import * as chromeLauncher from 'chrome-launcher';

const BASE = process.env.BASE ?? 'http://127.0.0.1:3003';
const RUNS = Number(process.env.RUNS ?? 3);
const PAGES = (process.env.PAGES ?? 'ROOT')
  .split(',')
  .map((page) => `/${page.replace(/^ROOT$/, '').trim()}`);
const OUT = process.env.OUT ?? 'results.json';
const THROTTLE = process.env.THROTTLE ?? 'simulate';

const chrome = await chromeLauncher.launch({
  chromePath: process.env.CHROME_PATH,
  chromeFlags: ['--headless=new', '--no-sandbox', '--disable-gpu'],
});
const results = [];
try {
  for (const path of PAGES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const result = await lighthouse(`${BASE}${path}`, {
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: ['performance'],
        throttlingMethod: THROTTLE,
      });
      const audits = result.lhr.audits;
      const lcpItems = audits['lcp-breakdown-insight']?.details?.items ?? [];
      const lcpElement = lcpItems.find((item) => item.type === 'node');
      runs.push({
        lcp: audits['largest-contentful-paint'].numericValue,
        fcp: audits['first-contentful-paint'].numericValue,
        cls: audits['cumulative-layout-shift'].numericValue,
        tbt: audits['total-blocking-time'].numericValue,
        score: result.lhr.categories.performance.score,
        lcpNode: lcpElement ? lcpElement.selector : null,
      });
    }
    const sorted = [...runs].sort((a, b) => a.lcp - b.lcp);
    const median = sorted[Math.floor(sorted.length / 2)];
    results.push({ path, throttle: THROTTLE, median, runs: runs.map((r) => Math.round(r.lcp)) });
    console.log(
      `${path.padEnd(22)} LCP ${(median.lcp / 1000).toFixed(2)}s  FCP ${(median.fcp / 1000).toFixed(2)}s  CLS ${median.cls.toFixed(3)}  TBT ${Math.round(median.tbt)}ms  điểm ${Math.round(median.score * 100)}  lần=${runs.map((r) => (r.lcp / 1000).toFixed(2)).join('/')}  LCP=${median.lcpNode}`,
    );
  }
} finally {
  await chrome.kill();
}
writeFileSync(OUT, JSON.stringify(results, null, 2));
