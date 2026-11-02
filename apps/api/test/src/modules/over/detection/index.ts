/**
 * Cầu nối tương thích cho test khoá HB-126 giai đoạn A.
 *
 * `detection-helpers/index.ts` dựng specifier `../../src/modules/over/detection/index.js` nhưng file
 * helper nằm ở `test/over/detection-helpers/`, nên đường dẫn thực tế cần `../../../src/...`. Tệp này
 * chỉ re-export use case thật tại `apps/api/src/modules/over/detection/index.ts`; không chứa logic và
 * không thay đổi assertion nào. Khi A sửa specifier (hoặc chuyển helper lên `test/over/`), xoá tệp.
 */
export * from '../../../../../src/modules/over/detection/index.js';
