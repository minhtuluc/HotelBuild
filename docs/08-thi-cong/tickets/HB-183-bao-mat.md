---
id: HB-183
title: Job CI security (gitleaks, CodeQL, trivy, pnpm audit) + checklist pentest
risk: R2
owner: codex
max_lines: 400
allow:
  - .github/workflows/**
  - docs/07-ban-giao/van-hanh/**
unlock:
  - .github/workflows/**
---

# HB-183 — Job CI security (gitleaks, CodeQL, trivy, pnpm audit) + checklist pentest

## Mục tiêu

Không phát hành với lỗ hổng nghiêm trọng, bí mật lộ hay dữ liệu thẻ trong log.

## Căn cứ

- NFR-SEC-02, NFR-SEC-06; api.md §2.14; TC-SYS-04, TC-SYS-05
- Phụ thuộc: HB-176

## Tiêu chí nghiệm thu

1. Job `security` chạy trên PR và hằng đêm; CVSS ≥ 7 quá 7 ngày chưa xử lý → chặn release.
2. Checklist pentest `docs/07-ban-giao/van-hanh/pentest-checklist.md` (OWASP ASVS mức phù hợp): IDOR, phân quyền theo phạm vi, rate limit, CSRF cookie BFF, upload, SQLi (TC-SYS-04), PII trong log (TC-SYS-05); chạy một lượt trên staging, ghi kết quả.

## Cổng phải xanh

`pnpm check:scope` · `pnpm run ci` · chạy thật trên staging, log trong PR

## Ghi chú cho người làm

Đặc tả viết **trước** khi các phụ thuộc build xong. Tên file/module, hình dạng dữ liệu nội bộ và cách chia lớp do người làm quyết theo mã thật; lệch đặc tả thì ghi vào mục "Quyết định tự đưa ra" của PR (AGENTS.md §4). Chỉ dừng khi chạm danh mục leo thang (tiền, tồn, quyền, bảo mật, hợp đồng phá vỡ, hai BR mâu thuẫn).
