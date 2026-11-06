import { f6Handler } from '../f6-route';

export const dynamic = 'force-dynamic';

const handle = f6Handler('moves.create');
export const POST = handle;
