/**
 * Điểm kiểm tra sẵn sàng: xác nhận cấu hình môi trường hợp lệ ở thời điểm gọi
 * (kiến trúc §7.5, NFR-MAIN-05). Chạy động nên không cản trở `next build`.
 */
import { NextResponse } from 'next/server';
import { webEnv } from '../../../config';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  try {
    const env = webEnv();
    return NextResponse.json({ status: 'ok', apiBaseUrl: env.NEXT_PUBLIC_API_BASE_URL });
  } catch (error) {
    return NextResponse.json(
      { status: 'error', reason: error instanceof Error ? error.message : 'cấu hình không hợp lệ' },
      { status: 500 },
    );
  }
}
