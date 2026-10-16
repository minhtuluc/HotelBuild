/**
 * Sinh workbook XLSX (OOXML tối thiểu) cho worker xuất báo cáo (HB-163).
 *
 * Vì sao tự dựng thay vì dùng thư viện: ràng buộc "không thêm dependency" và nhu cầu
 * chỉ là một sheet phẳng. Định dạng cần dùng rất nhỏ: gói OPC chỉ cần 5 part bắt buộc
 * ([Content_Types].xml, _rels/.rels, xl/workbook.xml, xl/_rels/workbook.xml.rels,
 * xl/worksheets/sheet1.xml) và ô ghi bằng inline string nên KHÔNG cần sharedStrings.
 *
 * Đóng gói ZIP dùng phương thức 0 (store, không nén — APPNOTE.TXT §4.3.6) nên không
 * cần `node:zlib`; toàn bộ CRC-32 (§4.4.7) và cấu trúc header/central directory/EOCD
 * do mã này tự ghi để Excel/LibreOffice mở được.
 */

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;

/** Bit 11 của cờ chung: tên tệp mã hoá UTF-8 (APPNOTE §4.4.4). */
const UTF8_NAME_FLAG = 0x0800;
/** Phương thức 0 = store: dữ liệu nằm nguyên trong gói, không nén (APPNOTE §4.4.5). */
const STORE_METHOD = 0;
/** Phiên bản tối thiểu đọc được ZIP store (2.0). */
const VERSION_NEEDED = 20;
/** Mốc thời gian DOS cố định 1980-01-01 00:00 để mọi lần xuất cho ra tệp tất định. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

/** XML 1.0 §2.2 không cho ký tự điều khiển (trừ tab/xuống dòng) xuất hiện trong tài liệu. */
const ILLEGAL_XML_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;
/** Tên sheet Excel không được chứa `: \ / ? * [ ]` và tối đa 31 ký tự. */
const ILLEGAL_SHEET_CHARS = /[:\\/?*[\]]/g;
const MAX_SHEET_NAME_LENGTH = 31;

/** 5 part bắt buộc của một gói OPC tối thiểu (ECMA-376 Part 2 §10.1.2, Part 1 §18.2). */
const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

const WORKBOOK_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

interface ArchiveEntry {
  name: string;
  content: string;
}

/**
 * CRC-32 IEEE 802.3 mà ZIP yêu cầu: đa thức đảo 0xEDB88320, vào/ra đảo bit
 * (APPNOTE §4.4.7). Tính từng bit để không cần bảng tra.
 */
function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Tên cột kiểu Excel: 0→A, 25→Z, 26→AA (bijective base-26). */
function columnName(index: number): string {
  let name = '';
  let remaining = index;
  do {
    name = String.fromCharCode(65 + (remaining % 26)) + name;
    remaining = Math.floor(remaining / 26) - 1;
  } while (remaining >= 0);
  return name;
}

/** Escape văn bản XML và loại ký tự điều khiển không hợp lệ (XML 1.0 §2.4). */
function xmlText(value: string): string {
  const printable = value.replaceAll(ILLEGAL_XML_CHARS, '');
  return printable
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

/** Tên sheet hợp lệ theo luật Excel; rỗng thì lùi về `Sheet1` để workbook luôn mở được. */
function sheetNameOf(name: string): string {
  const cleaned = name.replaceAll(ILLEGAL_SHEET_CHARS, '').trim().slice(0, MAX_SHEET_NAME_LENGTH);
  return cleaned.length > 0 ? cleaned : 'Sheet1';
}

/** Sheet với ô inline string: `t="inlineStr"` để không phải sinh sharedStrings.xml. */
function worksheetXml(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const body = [headers, ...rows]
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cellsXml = cells
        .map(
          (value, columnIndex) =>
            `<c r="${columnName(columnIndex)}${rowNumber}" t="inlineStr"><is>` +
            `<t xml:space="preserve">${xmlText(value)}</t></is></c>`,
        )
        .join('');
      return `<row r="${rowNumber}">${cellsXml}</row>`;
    })
    .join('');
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${body}</sheetData></worksheet>`
  );
}

function localFileHeader(nameUtf8: Buffer, data: Buffer, checksum: number): Buffer {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(LOCAL_HEADER_SIGNATURE, 0);
  header.writeUInt16LE(VERSION_NEEDED, 4);
  header.writeUInt16LE(UTF8_NAME_FLAG, 6);
  header.writeUInt16LE(STORE_METHOD, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameUtf8.length, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralDirectoryEntry(
  nameUtf8: Buffer,
  data: Buffer,
  checksum: number,
  localOffset: number,
): Buffer {
  const entry = Buffer.alloc(46);
  entry.writeUInt32LE(CENTRAL_HEADER_SIGNATURE, 0);
  entry.writeUInt16LE(VERSION_NEEDED, 4);
  entry.writeUInt16LE(VERSION_NEEDED, 6);
  entry.writeUInt16LE(UTF8_NAME_FLAG, 8);
  entry.writeUInt16LE(STORE_METHOD, 10);
  entry.writeUInt16LE(DOS_TIME, 12);
  entry.writeUInt16LE(DOS_DATE, 14);
  entry.writeUInt32LE(checksum, 16);
  entry.writeUInt32LE(data.length, 20);
  entry.writeUInt32LE(data.length, 24);
  entry.writeUInt16LE(nameUtf8.length, 28);
  entry.writeUInt16LE(0, 30);
  entry.writeUInt16LE(0, 32);
  entry.writeUInt16LE(0, 34);
  entry.writeUInt16LE(0, 36);
  entry.writeUInt32LE(0, 38);
  entry.writeUInt32LE(localOffset, 42);
  return entry;
}

function endOfCentralDirectory(count: number, size: number, offset: number): Buffer {
  const record = Buffer.alloc(22);
  record.writeUInt32LE(END_OF_CENTRAL_DIRECTORY_SIGNATURE, 0);
  record.writeUInt16LE(0, 4);
  record.writeUInt16LE(0, 6);
  record.writeUInt16LE(count, 8);
  record.writeUInt16LE(count, 10);
  record.writeUInt32LE(size, 12);
  record.writeUInt32LE(offset, 16);
  record.writeUInt16LE(0, 20);
  return record;
}

/** Gói ZIP store: local header + dữ liệu cho từng entry, rồi central directory và EOCD. */
function zipStore(entries: readonly ArchiveEntry[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const nameUtf8 = Buffer.from(entry.name, 'utf8');
    const data = Buffer.from(entry.content, 'utf8');
    const checksum = crc32(data);
    const header = localFileHeader(nameUtf8, data, checksum);
    parts.push(header, nameUtf8, data);
    central.push(centralDirectoryEntry(nameUtf8, data, checksum, localOffset), nameUtf8);
    localOffset += header.length + nameUtf8.length + data.length;
  }
  const centralSize = central.reduce((total, part) => total + part.length, 0);
  parts.push(...central, endOfCentralDirectory(entries.length, centralSize, localOffset));
  return Buffer.concat(parts);
}

/** Workbook XLSX một sheet: tiêu đề là dòng 1, mỗi dòng dữ liệu một dòng kế tiếp. */
export function toXlsx(
  sheetName: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
): Uint8Array {
  const sheet = sheetNameOf(sheetName);
  const workbookXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<sheets><sheet name="${xmlText(sheet)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
  return zipStore([
    { name: '[Content_Types].xml', content: CONTENT_TYPES_XML },
    { name: '_rels/.rels', content: PACKAGE_RELS_XML },
    { name: 'xl/workbook.xml', content: workbookXml },
    { name: 'xl/_rels/workbook.xml.rels', content: WORKBOOK_RELS_XML },
    { name: 'xl/worksheets/sheet1.xml', content: worksheetXml(headers, rows) },
  ]);
}
