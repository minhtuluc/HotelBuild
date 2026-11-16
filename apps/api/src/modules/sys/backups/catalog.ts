/**
 * Đọc ảnh chụp `pgbackrest info --output=json` mà sidecar ghi vào `backup_catalog`. Dữ liệu do công cụ
 * ngoài sinh nên parse **khoan dung**: phần tử lạ bị bỏ qua thay vì làm hỏng màn hình trạng thái.
 */
import { z } from 'zod';
import type { BackupSet } from '@pinehill/contracts';
import { BACKUP_LABEL } from './validation.js';

const TYPES = { full: 'FULL', diff: 'DIFF', incr: 'INCR' } as const;

const setSchema = z.object({
  label: z.string().regex(BACKUP_LABEL),
  type: z.enum(['full', 'diff', 'incr']),
  timestamp: z.object({ start: z.number().int().positive(), stop: z.number().int().positive() }),
  info: z
    .object({
      size: z.number().int().min(0).optional(),
      repository: z.object({ size: z.number().int().min(0).optional() }).optional(),
    })
    .optional(),
});

const stanzaSchema = z.object({ name: z.string(), backup: z.array(z.unknown()).default([]) });

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

/** Mọi bản sao lưu của stanza (mặc định `pinehill`), mới nhất trước. */
export function backupSets(info: unknown, stanza = 'pinehill'): BackupSet[] {
  const stanzas = z.array(z.unknown()).safeParse(info);
  if (!stanzas.success) return [];
  const found = stanzas.data
    .map((item) => stanzaSchema.safeParse(item))
    .find((item) => item.success && item.data.name === stanza);
  if (found === undefined || !found.success) return [];
  return found.data.backup
    .flatMap((item) => {
      const parsed = setSchema.safeParse(item);
      return parsed.success ? [parsed.data] : [];
    })
    .map((data) => ({
      backupId: data.label,
      type: TYPES[data.type],
      startedAt: iso(data.timestamp.start),
      finishedAt: iso(data.timestamp.stop),
      databaseSizeBytes: data.info?.size ?? null,
      repositorySizeBytes: data.info?.repository?.size ?? null,
    }))
    .sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}
