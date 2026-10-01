---
id: HB-014
title: RBAC — ma trận quyền vai trò × thao tác × phạm vi cơ sở, deny mặc định
risk: R2
owner: codex
max_lines: 500
allow:
  - apps/api/src/common/rbac/**
  - apps/api/src/common/actor/**
  - apps/api/src/common/guards/**
  - apps/api/src/modules/sys/**
  - apps/api/test/rbac/**
---

# HB-014 — RBAC

## Mục tiêu

Một nơi duy nhất khai quyền theo route; máy chủ cưỡng chế thứ tự **xác thực → vai trò → phạm vi cơ sở → trạng thái nghiệp vụ** và từ chối mọi route chưa khai quyền. Có bộ test tự động phủ ma trận để mọi endpoint sau này tự được kiểm.

## Căn cứ

- BR-RBAC-01, BR-RBAC-02, BR-RBAC-03; FR-AUTH-03, FR-AUTH-04; NFR-SEC-01
- api.md §1.2, §6.1–6.3 (ma trận quyền); [thiết kế lớp](../../04-thiet-ke/thiet-ke-lop.md) `ActorContext`
- TC-AUTH-04, TC-AUTH-05, TC-AUTH-06, TC-AUTH-07, TC-AUTH-08; [QĐ-03](../../05-ke-hoach/nhat-ky/QD-03-dinh-danh-phien-f1.md) quyết định 7, 9

## Tiêu chí nghiệm thu

1. Decorator `@Permission('<thao-tác>')` + bảng `permission → role set` là dữ liệu lấy từ api.md §6.3. Bảng **ghép từ từng module** (`modules/<mod>/**/permissions.ts` khai phần của mình, `common/rbac` gom lại và báo lỗi khi hai module khai trùng thao tác), để các ticket song song không sửa chung một file. Route thiếu decorator mà không `@Public()` → **khởi động thất bại** (kiểm lúc bootstrap, có test).
2. `ActorContext`: `canActOn(propertyId)`, `hasPermission(p)`, `isOwner()`. OWNER phạm vi chuỗi; SYSADMIN không được cấp quyền đọc dữ liệu nghiệp vụ.
3. Helper truy vấn bắt buộc lọc `property_id IN scope` ở tầng truy vấn (không lọc sau khi đọc). Ngoài phạm vi: nhân viên nhận 403 `E_AUTH_OUT_OF_SCOPE`, khách nhận 404 `E_GEN_NOT_FOUND`.
4. Test ma trận sinh tự động từ bảng quyền: với mỗi route đã đăng ký × 7 vai trò → kỳ vọng cho/từ chối đúng bảng (TC-AUTH-07, TC-AUTH-08); ca IDOR đổi ID sang cơ sở khác (TC-AUTH-04, TC-AUTH-05); gửi `role`/`propertyScope` trong body không làm thay đổi quyền (TC-AUTH-06). Dùng route giả đăng ký trong test cho các thao tác chưa có endpoint thật.
5. `pnpm run ci` + `pnpm test:integration` xanh.

## Ngoài phạm vi

- Endpoint nghiệp vụ; thu hồi phiên khi đổi quyền (HB-016).

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · `pnpm test:integration`
