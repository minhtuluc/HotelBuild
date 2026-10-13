import { ApiError } from '@pinehill/api-client';
import type { AdminData, AdminReceipt } from './controller';
export function applyReceipt(data: AdminData | null, receipt: AdminReceipt): AdminData | null {
  if (!data) return null;
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
  if (receipt.kind === 'property-update') {
    const row = data.properties.find((item) => item.id === receipt.data.id);
    if (!row || row.version < receipt.data.version)
      throw new ApiError({ kind: 'protocol', message: 'Stale acknowledged projection' });
  } else {
    const row = data.roomTypes.find((item) => item.id === receipt.data.id);
    if (!row) throw new ApiError({ kind: 'protocol', message: 'Missing acknowledged projection' });
  }
}
