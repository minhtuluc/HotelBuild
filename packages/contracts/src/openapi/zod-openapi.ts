/**
 * Bật phần mở rộng `.openapi()` cho zod — bắt buộc trước khi đăng ký schema vào registry.
 * Đây là hiệu ứng một lần, chỉ áp trong gói contracts (nơi duy nhất được dùng zod — QT §2).
 */
import { extendZodWithOpenApi } from '@asteasolutions/zod-to-openapi';
import { z } from 'zod';

extendZodWithOpenApi(z);
