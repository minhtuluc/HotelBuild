# Backlog F8–F9 — báo cáo, CRM, thông báo, hardening, hạ tầng, phát hành

**Đặc tả đủ cho F8 + F9 (03/10/2026, lead).** Báo cáo/CRM/thông báo là R1 (đọc dữ liệu, không đổi tiền/tồn) → DeepSeek; hạ tầng, bảo mật, tải, sao lưu → Codex; rà soát, UAT, checklist → Gemini.

Mục lục: [backlog](backlog.md) · [lộ trình đến deploy](lo-trinh-den-deploy.md) · [sổ tay lead](so-tay-lead.md). F9 là nơi mọi cổng vận hành được kiểm bằng chạy thật: restore, tải, bảo mật, UAT — không cổng nào đạt bằng tài liệu.

## F8 — báo cáo, thông báo, CRM (operations web)

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| [HB-160](tickets/HB-160-hop-dong-f8.md) | Hợp đồng F8: `reports/*` (occupancy, adr-revpar, revenue-by-channel, cancellations, force-majeure, overbooking, export), `notifications` (+resend), `guests/{id}/anonymize`, `/loyalty`, `/blacklist`. SYS đã ở HB-030 | R2 | DeepSeek | HB-140 | api.md §2.10–§2.12, §2.14; NFR-MAIN-04 | 0 phá vỡ; không sinh endpoint cấm của §2.14 |
| [HB-161](tickets/HB-161-engine-chi-so-bao-cao.md) | Engine chỉ số báo cáo thuần: công suất, ADR, RevPAR, tỷ lệ huỷ, chi phí quá tải theo một định nghĩa | R2 | Codex | HB-003 | BR-REP-01, BR-RATE-08; UC-REP-01; TC-REP-01 | DOR đếm theo đơn vị bán; nhánh ≥ 90% |
| [HB-162](tickets/HB-162-uc-bao-cao.md) | UC + endpoint báo cáo đọc + RBAC phạm vi cơ sở | R1 | DeepSeek | HB-014, HB-161 | UC-REP-01…04; BR-REP-01; TC-REP-02, TC-REP-03 | Báo cáo tài chính chỉ ACCOUNTANT/OWNER |
| [HB-163](tickets/HB-163-xuat-bao-cao.md) | Xuất báo cáo bất đồng bộ (202 + `operationId`, worker CSV/XLSX, audit mỗi lần xuất) | R1 | DeepSeek | HB-009, HB-029, HB-162 | NFR-COMP-04; UC-REP-01 | 100.000 dòng ≤ 60 giây; số CSV khớp màn hình |
| [HB-164](tickets/HB-164-scr52-53-bao-cao-cong-suat-doanh-thu.md) | SCR-52 + SCR-53 công suất/ADR/RevPAR, doanh thu theo kênh | R1 | DeepSeek | HB-162, HB-163 | SCR-52, SCR-53; UC-REP-01, UC-REP-02 | UI không tự định nghĩa chỉ số |
| [HB-165](tickets/HB-165-scr54-55-bao-cao-huy-qua-tai.md) | SCR-54 + SCR-55 huỷ/hoàn, quá tải | R1 | DeepSeek | HB-162 | SCR-54, SCR-55; UC-REP-03, UC-REP-04 | Số khớp engine |
| [HB-166](tickets/HB-166-uc-crm-quan-tri.md) | CRM quản trị: loyalty, blacklist (thêm/gỡ), anonymize (không xoá cứng) | R1 | DeepSeek | HB-149, HB-160 | UC-CRM-01…03; BR-CRM-01…05; NFR-COMP-01 | Không có `DELETE /guests`; mọi thao tác có audit |
| [HB-167](tickets/HB-167-scr49-50-crm.md) | SCR-49 hồ sơ & danh sách đen + SCR-50 hạng & điểm | R1 | DeepSeek | HB-166 | SCR-49, SCR-50; UC-CRM-01…03 | Không có thao tác xoá cứng |
| [HB-168](tickets/HB-168-uc-thong-bao.md) | NOTI: danh sách + gửi lại ≤ 3 lần cách 5 phút (worker). Hợp nhất mailer của HB-028 vào đây | R1 | DeepSeek | HB-006, HB-009, HB-160, HB-028 | UC-NOTI-01, UC-NOTI-02; BR-SYS-06; TC-NOTI-01, TC-NOTI-02 | Sau 3 lần → `FAILED` + cảnh báo |
| [HB-169](tickets/HB-169-scr51-thong-bao.md) | SCR-51 mẫu & hàng đợi thông báo | R1 | DeepSeek | HB-168 | SCR-51; UC-NOTI-01 | Hiện số lần thử |
| ~~HB-170, HB-171~~ | Gộp vào HB-036, HB-043, HB-044 (F2) | — | — | — | — | — |
| [HB-172](tickets/HB-172-qa-f8.md) | QA F8: đối chiếu số báo cáo ↔ SQL, RBAC báo cáo | R0 | Gemini | HB-164…HB-169 | TC-REP-01…04, TC-NOTI-01, TC-NOTI-02 | MANAGER không thấy báo cáo tài chính |
| [HB-173](tickets/HB-173-nghiem-thu-f8.md) | Nghiệm thu F8 | — | lead | HB-172 | lộ trình §7.10 | Bằng chứng đủ |

## F9 — hạ tầng, hardening, UAT, phát hành

| Ticket | Việc | Hạng | Làm | Phụ thuộc | Căn cứ | Tiêu chí chính |
|---|---|---|---|---|---|---|
| [HB-174](tickets/HB-174-qd-hosting.md) | **QĐ hosting production** (nhà cung cấp, vùng, chi phí, backup off-site) — xem [lộ trình §5](lo-trinh-den-deploy.md#5-quyết-định-còn-mở) | — | Người dùng + lead | — | kiến trúc §7 | Có QĐ-nn ký trước HB-175 |
| [HB-175](tickets/HB-175-ha-tang-iac.md) | Hạ tầng staging/production bằng IaC: api + worker (một image, 2 entrypoint), PostgreSQL 16 (WAL/PITR), Redis 7 (AOF), reverse proxy + TLS | R2 | Codex | HB-174, HB-027 | kiến trúc §7; NFR-SEC-03 | Dựng lại staging từ đầu bằng một lệnh |
| [HB-176](tickets/HB-176-bi-mat-moi-truong.md) | Bí mật & biến môi trường (GitHub secrets / Vercel env / EAS secrets), quét `gitleaks` | R2 | Codex | HB-175 | kiến trúc §7.1; NFR-SEC-06 | 0 bí mật trong repo |
| [HB-177](tickets/HB-177-pipeline-deploy.md) | Pipeline deploy: build image → registry → triển khai cuốn chiếu; web lên Vercel; gate contract version (ADR-018 cổng 4) | R2 | Codex | HB-175, HB-176 | ADR-018; NFR-MAIN-04 | Deploy không gián đoạn; gate chặn khi hợp đồng không tương thích |
| [HB-178](tickets/HB-178-migration-production.md) | Migration production (expand → migrate → contract) + chạy kiểm csdl §8.3 sau migrate | R2 | Codex | HB-005, HB-177 | csdl §8.2, §8.3; QĐ-02 mục 2–3 | §8.3 xanh trên staging |
| [HB-179](tickets/HB-179-sao-luu-phuc-hoi.md) | Backup + diễn tập restore (WAL + full hằng ngày), `POST /system/backups`, `/restore` vào môi trường tạm | R2 | Codex (test khoá) → DeepSeek | HB-175, HB-178 | BR-SYS-03; NFR-REL-04; TC-SYS-07 | RPO ≤ 15 phút, RTO ≤ 4 giờ, có biên bản |
| [HB-180](tickets/HB-180-runbook-rollback.md) | Runbook rollback (snapshot trước migrate, migration bù, PITR, phê duyệt + audit) | R2 | Codex | HB-178, HB-179 | csdl §8.4; NFR-REL-04; TC-SYS-09 | Diễn tập rollback trên staging |
| [HB-181](tickets/HB-181-quan-sat.md) | Quan sát: OpenTelemetry, log JSON có `correlationId`/che PII, bảng SLO, cảnh báo burn-rate | R2 | Codex | HB-175 | kiến trúc §9; NFR-OBS-01…03 | 100% log có trace id, 0 PII |
| [HB-182](tickets/HB-182-canh-bao-van-hanh.md) | Cảnh báo vận hành: xung đột gán phòng, tồn âm, kênh DEGRADED, đăng nhập bất thường, hoàn quá SLA | R2 | Codex (test khoá) → DeepSeek | HB-181 | NFR-OBS-04; BR-INV-03, BR-CHAN-07, BR-RBAC-06, BR-CANCEL-12 | Mỗi cảnh báo đúng đích, không trùng |
| [HB-183](tickets/HB-183-bao-mat.md) | Job CI `security` (gitleaks, CodeQL, trivy, `pnpm audit`) + checklist pentest | R2 | Codex | HB-176 | NFR-SEC-02, NFR-SEC-06; TC-SYS-04, TC-SYS-05 | 0 lỗ hổng CVSS ≥ 7 quá 7 ngày |
| [HB-184](tickets/HB-184-tai-k6.md) | k6: 200 VU (60% đọc / 30% ghi / 10% báo cáo) + spike 600 VU | R2 | Codex | HB-175, HB-181 | NFR-PERF-01…03; TC-INV-10, TC-REP-04 | p95 tồn < 800 ms, p95 khác < 400 ms, lỗi < 0,1% |
| [HB-185](tickets/HB-185-ra-soat-truy-cap.md) | Rà accessibility 83 màn hình (6 cấu hình trình duyệt, TalkBack, zoom 200%, 360 px) | R0 | Gemini | HB-173 | NFR-USE-03…05; TC-SYS-10 | axe 0 serious/critical |
| [HB-186](tickets/HB-186-ra-soat-i18n.md) | Rà i18n toàn bộ: 0 chuỗi cứng, tiền số nguyên, nhãn giờ VN | R0 | Gemini | HB-173 | NFR-LOC-01…03 | 0 vi phạm |
| [HB-187](tickets/HB-187-doi-chieu-gia-5-nguon.md) | Đối chiếu giá 5 nguồn + đo lại NFR giao diện | R1 | DeepSeek | HB-173 | NFR-PERF-05; BR-RATE-17; TC-RATE-21 | Sai 0 VND |
| [HB-188](tickets/HB-188-e2e-nightly-day-du.md) | Nightly: Playwright 2 web + Maestro 2 Android + k6 | R2 | Codex | HB-184 | kiến trúc §7; NFR-MAIN-03 | Playwright < 20 phút, Maestro < 10 phút |
| [HB-189](tickets/HB-189-phat-hanh-android.md) | Phát hành Android: EAS build, 2 application ID, EAS Update chỉ vá JS, APK dự phòng | R1 | DeepSeek | HB-176, HB-188 | kiến trúc §7; ADR-018 | 2 app build được |
| [HB-190](tickets/HB-190-checklist-go-live.md) | Checklist go-live + release checklist từng app (build, contract version, cửa sổ tương thích) | R0 | Gemini → lead | HB-177, HB-179, HB-183, HB-188, HB-189 | ADR-018; [bàn giao](../07-ban-giao/huong-dan-thi-cong.md) §5 | Có bằng chứng restore thật |
| [HB-191](tickets/HB-191-uat.md) | UAT 3 kịch bản × 4 frontend × từng actor; biên bản ký | R0 | Gemini → người dùng | HB-185, HB-187, HB-188 | bàn giao §5; lộ trình M8 | 0 P0/P1 mở |
| [HB-192](tickets/HB-192-ho-so-ban-giao.md) | Hồ sơ bàn giao: ma trận truy vết, README tái lập máy sạch, danh mục nợ kỹ thuật | R0 | Gemini → DeepSeek | HB-190, HB-191 | lộ trình M8; QG-4 | README chạy được trên máy sạch |
| [HB-193](tickets/HB-193-nghiem-thu-go-live.md) | Nghiệm thu F9 + **cổng go-live** | — | lead (hoặc người thay vai) + người dùng ký | HB-190…HB-192 | lộ trình §7.11; QG-4 | Đủ mục [lộ trình §4](lo-trinh-den-deploy.md#4-cổng-go-live) |
| HB-198, HB-199 | Dự phòng tách ticket | — | lead cấp | — | — | — |

## Khoảng trống tài liệu

1. Pha sở hữu SCR-16/17/18 lệch giữa thiết kế màn hình, lộ trình §8 và hợp đồng — đã chốt: SCR-16/17 ở F2 (HB-043/HB-044), SCR-18 làm cùng F9 (HB-045 phụ thuộc HB-179).
2. Lộ trình gọi kịch bản tải "KB-A/B/C" nhưng kế hoạch kiểm thử chỉ có "§7 kịch bản A/B/C" — dùng mã TC thật.
3. Checklist pentest chưa có mã TC riêng — HB-183 tạo checklist.
4. Phân mảnh `audit_logs` chưa có ticket (lưu 5 năm) — làm khi vượt ngưỡng csdl ghi; không chặn go-live.
5. NFR-OBS không nêu tên Prometheus/Grafana — thuộc quyết định mở ở lộ trình §5.
