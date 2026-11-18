/** HB-249: app mở thẳng vào tìm phòng — khách xem phòng không cần tài khoản; đăng nhập ở `/login`. */
import type { ReactElement } from 'react';
import { Redirect } from 'expo-router';
import { START_ROUTE } from '../src/navigation';

export default function StartScreen(): ReactElement {
  return <Redirect href={START_ROUTE} />;
}
