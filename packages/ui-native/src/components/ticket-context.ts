/** HB-272 — đang nằm trên giấy vé hồng: con cháu tự đổi chữ phụ/đỏ hành động (The Ticket Ink Rule). */
import { createContext, useContext } from 'react';

export const TicketContext = createContext(false);

export function useOnTicket(): boolean {
  return useContext(TicketContext);
}
