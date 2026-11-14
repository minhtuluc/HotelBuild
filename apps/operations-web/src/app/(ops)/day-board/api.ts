import {
  ApiError,
  createPropertyApi,
  createInventoryApi,
  type ApiClient,
} from '@pinehill/api-client';
import { checkBoard, projectDayBoard, type DayData } from './model';

export function dayApi(client: ApiClient) {
  const properties = createPropertyApi(client),
    inventory = createInventoryApi(client);
  return {
    /**
     * `preferred` là cơ sở đang làm việc của phiên (TD-44): chỉ dùng khi chưa chọn cơ sở nào và cơ sở đó
     * có trong danh sách máy chủ trả; không thì lấy cơ sở đầu tiên như cũ.
     */
    load: async (propertyId: string, date: string, preferred = ''): Promise<DayData> => {
      const page = await properties.list();
      if (page.data.meta.hasMore) throw new Error('Incomplete property projection');
      const available = page.data.data.map((item) => ({ id: item.id, name: item.name }));
      const selected = chooseProperty(available, propertyId, preferred);
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
      const [response, board] = await Promise.all([
        inventory.grid({ propertyId: selected, from: date, to: date }),
        loadBoard(inventory, selected, date),
      ]);
      return {
        ...projectDayBoard(selected, date, types.data.data, response.data),
        properties: available,
        ...board,
      };
    },
  };
}

/**
 * Phần đến/đi/ở của bảng ngày. Lỗi riêng phần này không xoá bảng tồn khả dụng. 403 cũng chỉ ẩn phần
 * này: RESERVATION_AGENT được xem tồn (`inventory.grid`) nhưng không được xem danh sách khách trong ngày.
 * Riêng 401 (hết phiên) vẫn ném ra để màn hình che toàn bộ số liệu.
 */
async function loadBoard(
  inventory: ReturnType<typeof createInventoryApi>,
  propertyId: string,
  date: string,
): Promise<Pick<DayData, 'board' | 'boardError'>> {
  try {
    const response = await inventory.dayBoard({ propertyId, date });
    return { board: checkBoard(response.data, propertyId, date), boardError: null };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) throw error;
    return { board: null, boardError: error };
  }
}

function chooseProperty(
  available: readonly { id: string }[],
  propertyId: string,
  preferred: string,
): string {
  if (propertyId) return propertyId;
  if (available.some((item) => item.id === preferred)) return preferred;
  return available[0]?.id ?? '';
}
