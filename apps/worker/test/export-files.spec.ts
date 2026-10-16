import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { toCsv } from '../src/export/csv.js';
import { toXlsx } from '../src/export/xlsx.js';
import {
  exportExtension,
  insideExportDir,
  readExportFile,
  removeExportFile,
  writeExportFile,
} from '../src/export/storage.js';

/** CRC-32 dạng bảng tra — viết độc lập với bản tính từng bit trong `src/export/xlsx.ts`. */
const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

interface ZipEntry {
  method: number;
  crc: number;
  data: Buffer;
}

/**
 * Đọc lại gói ZIP bằng tay theo APPNOTE.TXT: EOCD → central directory → local file
 * header, đồng thời khẳng định hai bản ghi mô tả cùng một entry khớp nhau.
 */
function readZipArchive(bytes: Uint8Array): Map<string, ZipEntry> {
  const buffer = Buffer.from(bytes);
  let eocd = buffer.length - 22;
  while (eocd >= 0 && buffer.readUInt32LE(eocd) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    eocd -= 1;
  }
  expect(eocd).toBeGreaterThanOrEqual(0);
  const total = buffer.readUInt16LE(eocd + 10);
  const entries = new Map<string, ZipEntry>();
  let cursor = buffer.readUInt32LE(eocd + 16);
  for (let index = 0; index < total; index += 1) {
    expect(buffer.readUInt32LE(cursor)).toBe(CENTRAL_HEADER_SIGNATURE);
    const method = buffer.readUInt16LE(cursor + 10);
    const crc = buffer.readUInt32LE(cursor + 16);
    const size = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    expect(buffer.readUInt32LE(localOffset)).toBe(LOCAL_HEADER_SIGNATURE);
    expect(buffer.readUInt16LE(localOffset + 8)).toBe(method);
    expect(buffer.readUInt32LE(localOffset + 14)).toBe(crc);
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    expect(buffer.toString('utf8', localOffset + 30, localOffset + 30 + localNameLength)).toBe(
      name,
    );

    const start = localOffset + 30 + localNameLength + localExtraLength;
    entries.set(name, { method, crc, data: buffer.subarray(start, start + size) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

/** Đọc part sheet từ gói đã parse — mọi khẳng định nội dung XML dùng chung đường này. */
function sheetXmlOf(bytes: Uint8Array): string {
  const entry = readZipArchive(bytes).get('xl/worksheets/sheet1.xml');
  if (entry === undefined) throw new Error('Thiếu part xl/worksheets/sheet1.xml');
  return entry.data.toString('utf8');
}

describe('toCsv', () => {
  it('bọc nháy kép theo RFC 4180, mở đầu bằng BOM UTF-8 và kết dòng bằng CRLF', () => {
    const csv = toCsv(['Mã', 'Ghi chú'], [['A1', 'Đổi, có "nháy"']]);
    expect(csv).toBe('\uFEFFMã,Ghi chú\r\nA1,"Đổi, có ""nháy"""\r\n');
    expect([...Buffer.from(csv).subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.slice(1).split('\r\n')).toHaveLength(3);
  });

  it('vô hiệu công thức ở ô và giữ ô nhiều dòng trong đúng một bản ghi', () => {
    const csv = toCsv(
      ['A', 'B', 'C', 'D'],
      [
        ['=cmd|calc', '+1', '-1', '@SUM(1)'],
        ['Dòng 1\nDòng 2', '', '', ''],
      ],
    );
    expect(csv).toContain("'=cmd|calc,'+1,'-1,'@SUM(1)");
    expect(csv).toContain('"Dòng 1\nDòng 2"');
    expect(csv.slice(1).split('\r\n')).toHaveLength(4);
  });
});

describe('toXlsx', () => {
  it('đóng gói đủ 5 part, CRC32 từng entry khớp và ô inline string đã escape', () => {
    const headers = ['Mã đơn', 'Khách "VIP"'];
    const rows = [
      ['A&B<1>', 'Dòng 1\nDòng 2'],
      ['', 'tab\tgiữ'],
      ['1000000', '2026-10-16'],
    ];
    const bytes = toXlsx('Báo cáo & doanh thu', headers, rows);
    expect(bytes).toBeInstanceOf(Uint8Array);

    const archive = readZipArchive(bytes);
    expect([...archive.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
    ]);
    for (const [name, entry] of archive) {
      expect(name.length).toBeGreaterThan(0);
      expect(entry.method).toBe(0);
      expect(crc32(entry.data)).toBe(entry.crc);
    }

    const sheetXml = archive.get('xl/worksheets/sheet1.xml')!.data.toString('utf8');
    expect(sheetXml).toContain('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    expect(sheetXml).toContain(
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve">Mã đơn</t></is></c>',
    );
    expect(sheetXml).toContain(
      '<c r="B1" t="inlineStr"><is><t xml:space="preserve">Khách &quot;VIP&quot;</t></is></c>',
    );
    expect(sheetXml).toContain(
      '<c r="A2" t="inlineStr"><is><t xml:space="preserve">A&amp;B&lt;1&gt;</t></is></c>',
    );
    expect(sheetXml).toContain(
      '<c r="B2" t="inlineStr"><is><t xml:space="preserve">Dòng 1\nDòng 2</t></is></c>',
    );
    expect(sheetXml).toContain(
      '<c r="B3" t="inlineStr"><is><t xml:space="preserve">tab\tgiữ</t></is></c>',
    );
    expect(sheetXml).toContain('<c r="A4" t="inlineStr"><is><t xml:space="preserve">1000000</t>');

    const workbookXml = archive.get('xl/workbook.xml')!.data.toString('utf8');
    expect(workbookXml).toContain(
      '<sheet name="Báo cáo &amp; doanh thu" sheetId="1" r:id="rId1"/>',
    );
  });

  it('loại ký tự điều khiển không hợp lệ với XML và đặt tên cột vượt Z', () => {
    const headers = Array.from({ length: 27 }, (_, index) => `cột${index}`);
    const bytes = toXlsx('Sheet1', headers, [['a\u0001b\u0000c']]);
    const sheetXml = sheetXmlOf(bytes);
    expect(sheetXml).toContain('<c r="A2" t="inlineStr"><is><t xml:space="preserve">abc</t>');
    expect(sheetXml).not.toContain('\u0001');
    expect(sheetXml).not.toContain('\u0000');
    expect(sheetXml).toContain('<c r="AA1" t="inlineStr">');
  });

  it('lùi tên sheet rỗng hoặc toàn ký tự cấm về `Sheet1`', () => {
    expect(sheetXmlOf(toXlsx('[]:*?/\\', [], []))).toContain('</sheetData>');
    const workbookXml = readZipArchive(toXlsx('', [], [])).get('xl/workbook.xml')!;
    expect(workbookXml.data.toString('utf8')).toContain('name="Sheet1"');
  });
});

describe('storage', () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'pinehill-export-'));
    created.push(root);
    return root;
  }

  it('ánh xạ đuôi tệp theo định dạng xuất', () => {
    expect(exportExtension('CSV')).toBe('csv');
    expect(exportExtension('XLSX')).toBe('xlsx');
  });

  it('chỉ nhận đường dẫn nằm trong thư mục xuất, chặn cả ".." và tiền tố trùng tên', () => {
    expect(insideExportDir('/data/exports', '/data/exports/report-1.csv')).toBe(true);
    expect(insideExportDir('/data/exports/', '/data/exports/report-1.csv')).toBe(true);
    expect(insideExportDir('/data/exports', '/data/exports/../secret.csv')).toBe(false);
    expect(insideExportDir('/data/exports', '/data/exports-khac/report-1.csv')).toBe(false);
    expect(insideExportDir('/data/exports', '/data/exports')).toBe(false);
  });

  it('ghi → đọc lại đúng bytes → xoá → đọc lại ném lỗi', async () => {
    const dir = join(await tempRoot(), 'con', 'bao-cao');
    const content = new Uint8Array([0, 1, 2, 127, 254, 255, 10]);

    const path = await writeExportFile(dir, 'op-42', 'CSV', content);
    expect(path).toBe(resolve(dir, 'report-op-42.csv'));
    expect(path.startsWith('/')).toBe(true);

    expect([...(await readExportFile(path))]).toEqual([...content]);

    await removeExportFile(path);
    await expect(readExportFile(path)).rejects.toThrow();
    await removeExportFile(path);
  });

  it('tệp XLSX ghi ra đĩa đọc lại đúng bytes và còn CRC hợp lệ', async () => {
    const bytes = toXlsx('Báo cáo', ['Mã', 'Số tiền'], [['A1', '1000000']]);
    const path = await writeExportFile(await tempRoot(), 'op-xlsx', 'XLSX', bytes);
    expect(path.endsWith('report-op-xlsx.xlsx')).toBe(true);

    const read = await readExportFile(path);
    expect([...read]).toEqual([...bytes]);
    const sheetXml = readZipArchive(read).get('xl/worksheets/sheet1.xml')!.data.toString('utf8');
    expect(sheetXml).toContain('<t xml:space="preserve">Số tiền</t>');
  });

  it('từ chối operationId có thể thoát khỏi thư mục xuất', async () => {
    const root = await tempRoot();
    await expect(writeExportFile(root, '../escape', 'CSV', new Uint8Array())).rejects.toThrow();
    await expect(writeExportFile(root, 'sub/dir', 'CSV', new Uint8Array())).rejects.toThrow();
    await expect(writeExportFile(root, '', 'CSV', new Uint8Array())).rejects.toThrow();
  });
});
