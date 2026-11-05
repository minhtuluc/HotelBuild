import { f6Handler } from '../../../f6-route';

export const dynamic = 'force-dynamic';

const handle = f6Handler('syncStatus.get');
export const GET = handle;
