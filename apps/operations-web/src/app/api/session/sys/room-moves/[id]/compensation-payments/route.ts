import { f6Handler } from '../../../f6-route';

export const dynamic = 'force-dynamic';

const handle = f6Handler('compensation.get', 'compensation.create');
export const GET = handle;
export const POST = handle;
