import {
  ApiError,
  createPropertyApi,
  createInventoryApi,
  type ApiClient,
} from '@pinehill/api-client';
import { projectDayBoard, type DayData } from './model';

export function dayApi(client: ApiClient) {
  const properties = createPropertyApi(client),
    inventory = createInventoryApi(client);
  return {
    load: async (propertyId: string, date: string): Promise<DayData> => {
      const page = await properties.list();
      if (page.data.meta.hasMore) throw new Error('Incomplete property projection');
      const available = page.data.data.map((item) => ({ id: item.id, name: item.name }));
      const selected = propertyId || available[0]?.id || '';
      if (!selected) return { properties: [], propertyId: '', date, capturedAt: null, rows: [] };
      if (!available.some((item) => item.id === selected))
        throw new ApiError({
          kind: 'http',
          status: 403,
          code: 'E_AUTH_OUT_OF_SCOPE',
          message: 'Out of scope',
        });
      const types = await properties.listRoomTypes({ propertyId: selected });
      if (types.data.meta.hasMore) throw new Error('Incomplete type projection');
      if (!types.data.data.length)
        return { properties: available, propertyId: selected, date, capturedAt: null, rows: [] };
      const response = await inventory.grid({ propertyId: selected, from: date, to: date });
      return {
        ...projectDayBoard(selected, date, types.data.data, response.data),
        properties: available,
      };
    },
  };
}
