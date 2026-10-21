# Quan sát: SLO, cảnh báo burn-rate, pipeline trace

Phần **cấu hình + đặc tả** của [HB-181](../../docs/08-thi-cong/tickets/HB-181-quan-sat.md) AC3 (NFR-OBS-02,
kiến trúc §9.3–§9.4). Mã phát trace/log nằm ở `apps/api/src/infrastructure/tracing`,
`apps/worker/src/tracing`; tệp ở đây chỉ là cấu hình triển khai.

> **Trạng thái: BLOCKED phần chạy thật.** Cấu hình đã viết và kiểm cú pháp cục bộ, nhưng **chưa** được nạp
> ở đâu: chưa có staging/collector/Prometheus/Grafana/Tempo. Điều kiện mở khoá: **HB-175** (hạ tầng
> staging bằng IaC). Không có bằng chứng chạy thật trong PR của HB-181 và không được ghi là đã nghiệm thu.

## 1. Pipeline

| Thành phần                                                               | Tệp                                            | Ghi chú                                                                                          |
| ------------------------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| OTel Collector (nhận OTLP từ api/worker, lấy mẫu đuôi, sinh metric span) | [`otel-collector.yml`](otel-collector.yml)     | Giữ **100%** trace lỗi, trace thanh toán và span > 1 s; còn lại 10% (NFR-OBS-03)                 |
| Luật ghi số liệu + cảnh báo burn-rate                                    | [`prometheus-rules.yml`](prometheus-rules.yml) | Đa cửa sổ: 14,4× trong 1 giờ và 6× trong 6 giờ (NFR-OBS-02)                                      |
| Định tuyến cảnh báo tới kênh kỹ thuật                                    | [`alertmanager.yml`](alertmanager.yml)         | URL webhook đọc từ tệp bí mật do nơi triển khai gắn vào; repo **không** chứa bí mật (NFR-SEC-06) |

Ứng dụng bật exporter bằng `OTEL_EXPORTER_OTLP_ENDPOINT` (trống ⇒ tắt, mặc định dev) và
`OTEL_SAMPLE_RATIO` (≥ 0,1). Tỉ lệ đó là **trần chi phí**; quyết định giữ trace lỗi/thanh toán nằm ở bộ lọc
`TailSamplingExporter` phía ứng dụng **và** `tail_sampling` ở collector.

## 2. Bảng SLO (cửa sổ 30 ngày)

| #   | SLO                                                          | SLI (công thức)                                                                                                                         | Mục tiêu                 | Ngân sách lỗi | Nguồn số liệu                       | Trạng thái                                                              |
| --- | ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ------------- | ----------------------------------- | ----------------------------------------------------------------------- |
| 1   | `api_availability` — không lỗi 5xx                           | `traces_spanmetrics_calls_total{service_name="api",span_kind="SPAN_KIND_SERVER",status_code="STATUS_CODE_ERROR"}` / tổng lời gọi server | 99,9 %                   | 0,1 %         | spanmetrics (từ trace API)          | Có sẵn khi collector chạy                                               |
| 2   | `api_latency` — p95 < 400 ms (ghi tranh chấp < 900 ms)       | tỉ lệ request có độ trễ ≤ 400 ms từ `traces_spanmetrics_latency_bucket`                                                                 | 95 %                     | 5 %           | spanmetrics                         | Có sẵn khi collector chạy                                               |
| 3   | `queue_depth` — hàng đợi không ứ                             | `max_over_time(bullmq_queue_jobs_count{state="waiting"}[10m])` và số job `failed` tăng                                                  | < 100 job chờ            | — (ngưỡng)    | BullMQ Prometheus exporter          | **Thiếu nguồn**: bật exporter BullMQ ở staging (HB-175)                 |
| 4   | `hold_expiry_timeliness` — giữ chỗ hết hạn được nhả đúng hạn | `inventory_hold_release_lag_seconds` (giây, từ lúc `hold_expires_at` tới lúc nhả)                                                       | 99 % ≤ 60 s              | 1 %           | worker đẩy gauge/histogram          | **Thiếu nguồn**: worker chưa phát số đo này; bổ sung ở staging (HB-175) |
| 5   | `outbox_lag` — sự kiện ra worker đúng hạn                    | `outbox_lag_seconds` (tuổi sự kiện `PENDING`/`FAILED` cũ nhất)                                                                          | 99,5 % ≤ 60 s            | 0,5 %         | `outbox_events` qua exporter SQL    | **Thiếu nguồn**: exporter SQL ở staging (HB-175)                        |
| 6   | `channel_sync` — kênh không suy giảm                         | `channel_degraded` (số kênh `DEGRADED`) và độ trễ đồng bộ > 5 phút                                                                      | 0 kênh suy giảm > 5 phút | — (ngưỡng)    | job đồng bộ + span `q.channel-sync` | Cảnh báo nghiệp vụ thuộc HB-182; số đo span có sau khi HB-131 chạy      |

Ghi chú: bảng điều khiển Grafana dựng 6 khối tương ứng; mỗi cảnh báo mang `dashboard_url` để mở đúng khối
(NFR-OBS-02: 100 % cảnh báo có đường dẫn tới bảng điều khiển).

## 3. Burn-rate

Ngân sách lỗi `B = 1 − mục tiêu`. `burn = tỉ lệ vi phạm / B`. Luật trong
[`prometheus-rules.yml`](prometheus-rules.yml) dùng hai cửa sổ song song để vừa **nhanh** vừa **chắc**:

| Cửa sổ dài | Cửa sổ ngắn | Ngưỡng | Ý nghĩa                                                 |
| ---------- | ----------- | ------ | ------------------------------------------------------- |
| 1 giờ      | 5 phút      | 14,4×  | Đốt hết ngân sách 30 ngày trong ~2 ngày → gọi trực ngay |
| 6 giờ      | 30 phút     | 6×     | Đốt hết ngân sách trong ~5 ngày → gọi trực              |

`for: 2m` để bỏ qua dao động một phút; nhóm theo `alertname`, `service`, `slo` để **0 cảnh báo trùng**
(NFR-OBS-02).

## 4. Phát hiện sự cố ≤ 5 phút

Đường nhanh nhất là cảnh báo burn-rate 1 giờ/5 phút (bắt đầu bắn sau ~2 phút vi phạm) và cảnh báo
`queue_depth` (5 phút). Độ trễ từ lỗi tới cảnh báo = `decision_wait` của collector (10 s) + chu kỳ scrape
Prometheus (15 s) + `for` (2 phút) ≈ **< 3 phút**. Con số này **chưa** được đo thật — phép đo thuộc staging.

## 5. Kiểm tra cục bộ (không thay cho staging)

```sh
python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" \
  infra/observability/otel-collector.yml \
  infra/observability/prometheus-rules.yml \
  infra/observability/alertmanager.yml
```

`promtool check rules infra/observability/prometheus-rules.yml` và `otelcol validate --config=...` chỉ chạy
được khi có binary tương ứng; staging là nơi duy nhất chứng minh luật bắn đúng.

## 6. Việc còn lại (BLOCKED — HB-175)

1. Dựng staging (HB-175), chạy collector + Prometheus + Alertmanager + Grafana + Tempo theo các tệp này.
2. Bật ba nguồn số đo còn thiếu: BullMQ exporter, gauge `inventory_hold_release_lag_seconds` từ worker,
   `outbox_lag_seconds` từ PostgreSQL exporter.
3. Diễn tập đốt ngân sách (bắn lỗi tổng hợp) và ghi log/biểu đồ vào PR nghiệm thu — **không** thuộc PR này.
4. Chốt chính sách lưu: trace 7 ngày, span chậm > 1 s giữ 30 ngày (cấu hình Tempo, NFR-OBS-03).
