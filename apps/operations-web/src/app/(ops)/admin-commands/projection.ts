import { ApiError } from '@pinehill/api-client';
import type { AdminData, AdminReceipt } from './controller';
export function applyReceipt(data: AdminData | null, receipt: AdminReceipt): AdminData | null {
  if (!data) return null;
  if (receipt.kind === 'connecting-update') return null;
  if (receipt.kind === 'room-block-create')
    return {
      ...data,
      blocks: [...(data.blocks ?? []).filter((row) => row.id !== receipt.data.id), receipt.data],
    };
  if (receipt.kind === 'room-block-delete')
    return { ...data, blocks: (data.blocks ?? []).filter((row) => row.id !== receipt.id) };
  if (receipt.kind === 'property-update')
    return {
      ...data,
      properties: data.properties.map((row) => (row.id === receipt.data.id ? receipt.data : row)),
    };
  return {
    ...data,
    roomTypes: [...data.roomTypes.filter((row) => row.id !== receipt.data.id), receipt.data],
  };
}
export function assertAcknowledgedProjection(data: AdminData, receipt: AdminReceipt | null): void {
  if (!receipt) return;
  if (receipt.kind === 'room-block-create' || receipt.kind === 'room-block-delete') {
    assertBlockReadback(data, receipt);
    return;
  }
  if (receipt.kind === 'connecting-update') {
    assertConnectingReadback(data, receipt);
    return;
  }
  if (receipt.kind === 'property-update') {
    const row = data.properties.find((item) => item.id === receipt.data.id);
    if (!row || row.version < receipt.data.version)
      throw new ApiError({ kind: 'protocol', message: 'Stale acknowledged projection' });
  } else {
    const row = data.roomTypes.find((item) => item.id === receipt.data.id);
    if (!row) throw new ApiError({ kind: 'protocol', message: 'Missing acknowledged projection' });
  }
}

function assertConnectingReadback(
  data: AdminData,
  receipt: Extract<AdminReceipt, { kind: 'connecting-update' }>,
): void {
  const row = data.rooms?.find((room) => room.id === receipt.data.id);
  if (
    !row ||
    row.version < receipt.data.version ||
    (row.version === receipt.data.version && row.connectingRoomId !== receipt.data.connectingRoomId)
  )
    throw new ApiError({
      kind: 'protocol',
      message: 'Connection readback is older than receipt',
    });
}

function assertBlockReadback(
  data: AdminData,
  receipt: Extract<AdminReceipt, { kind: 'room-block-create' | 'room-block-delete' }>,
): void {
  const id = receipt.kind === 'room-block-create' ? receipt.data.id : receipt.id;
  const present = data.blocks?.some((row) => row.id === id) ?? false;
  if (present !== (receipt.kind === 'room-block-create'))
    throw new ApiError({ kind: 'protocol', message: 'Stale room block readback' });
  return;
}
