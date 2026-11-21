import { webEnv } from '../../../../config';
import { vnpayIpnUrl, vnpayRelayPath } from '../../../(guest)/booking/[bookingId]/pay/vnpay-return';

export const dynamic = 'force-dynamic';

/** Go-live: relay chuỗi return VNPay đã ký sang IPN của API (xem `vnpay-return.ts`). Không đọc/ghi phiên. */
export async function GET(request: Request): Promise<Response> {
  const search = new URL(request.url).search;
  if (vnpayRelayPath(search) === null) return Response.json({ relayed: false }, { status: 400 });
  try {
    const upstream = await fetch(vnpayIpnUrl(webEnv().NEXT_PUBLIC_API_BASE_URL, search), {
      cache: 'no-store',
      signal: AbortSignal.timeout(10_000),
    });
    return Response.json({ relayed: upstream.ok }, { status: upstream.ok ? 200 : 502 });
  } catch {
    return Response.json({ relayed: false }, { status: 502 });
  }
}
