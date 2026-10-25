-- HB-214: trần hoàn luỹ kế ép ở CSDL (TC-PAY-21, BR-CANCEL-17, BR-PAY-07).
--
-- `payments.amount` là VND nguyên và dòng REFUND mang dấu âm (`ck_payments_sign`), nên tổng đã hoàn
-- của một booking là `-sum(amount)` của các dòng REFUND **chưa FAILED**; tổng đã thu là `sum(amount)`
-- của các dòng thu SUCCEEDED (cùng tập `type` mà ledger coi là tiền thu). Trước migration này chỉ
-- `modules/pay/ledger` giữ bất biến; F5-QA-05 cho thấy `INSERT` thẳng một `Payment` vẫn lọt, nên
-- bất biến §1 #8 ("ép được ở CSDL thì ép ở CSDL") buộc phải chặn ở đây.
--
-- Khoá theo đúng thứ tự ADR-014 (`bookings` → `payments`) trước khi đọc tổng — trùng thứ tự
-- `loadLocked()` của API và worker chi hoàn. Hai REFUND đồng thời cùng booking vì thế không thể
-- cùng lọt, và không phát sinh chu trình khoá với đường ứng dụng.
--
-- Migration chỉ tiến: nếu dữ liệu hiện có đã vi phạm thì DỪNG và báo số booking, không tự sửa tiền.

CREATE FUNCTION fn_guard_refund_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_refunded  bigint;
  v_collected bigint;
BEGIN
  -- Chỉ dòng REFUND còn hiệu lực mới chi tiền; REFUND FAILED không tính vào trần.
  IF NEW.type <> 'REFUND' OR NEW.status = 'FAILED' THEN
    RETURN NEW;
  END IF;
  -- ADR-014: khoá booking trước payments. Khoá này là hàng rào duy nhất tuần tự hoá hai lần tính
  -- tổng đồng thời; đọc lại tổng SAU khi có khoá (READ COMMITTED) nên thấy REFUND vừa commit.
  PERFORM 1 FROM bookings WHERE id = NEW.booking_id FOR UPDATE;
  IF NOT FOUND THEN
    -- Booking chưa tồn tại: để ràng buộc FK của `payments` báo lỗi, không che bằng lỗi trần hoàn.
    RETURN NEW;
  END IF;
  SELECT coalesce(-sum(p.amount), 0) INTO v_refunded FROM payments p
   WHERE p.booking_id = NEW.booking_id AND p.type = 'REFUND'
     AND p.status <> 'FAILED' AND (TG_OP = 'INSERT' OR p.id <> NEW.id);
  v_refunded := v_refunded - NEW.amount;
  SELECT coalesce(sum(p.amount), 0) INTO v_collected FROM payments p
   WHERE p.booking_id = NEW.booking_id AND p.status = 'SUCCEEDED'
     AND p.type IN ('DEPOSIT','BALANCE','PENALTY','EXTRA_SERVICE','RESCHEDULE_FEE');
  IF v_refunded > v_collected THEN
    RAISE EXCEPTION 'BR-CANCEL-17/BR-PAY-07: cumulative refund % exceeds collected % for booking %',
      v_refunded, v_collected, NEW.booking_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Tiền kiểm dữ liệu hiện có TRƯỚC khi bật trigger: vi phạm ⇒ dừng migration, không tự sửa tiền.
DO $$
DECLARE
  v_violations bigint;
  v_sample     text;
BEGIN
  SELECT count(*) INTO v_violations FROM (
    SELECT b.id
      FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
     GROUP BY b.id
    HAVING coalesce(-sum(p.amount) FILTER (
             WHERE p.type = 'REFUND' AND p.status <> 'FAILED'), 0)
         > coalesce(sum(p.amount) FILTER (
             WHERE p.status = 'SUCCEEDED'
               AND p.type IN ('DEPOSIT','BALANCE','PENALTY','EXTRA_SERVICE','RESCHEDULE_FEE')), 0)
  ) violating;
  IF v_violations > 0 THEN
    SELECT string_agg(id::text, ', ' ORDER BY id) INTO v_sample FROM (
      SELECT b.id
        FROM bookings b LEFT JOIN payments p ON p.booking_id = b.id
       GROUP BY b.id
      HAVING coalesce(-sum(p.amount) FILTER (
               WHERE p.type = 'REFUND' AND p.status <> 'FAILED'), 0)
           > coalesce(sum(p.amount) FILTER (
               WHERE p.status = 'SUCCEEDED'
                 AND p.type IN ('DEPOSIT','BALANCE','PENALTY','EXTRA_SERVICE','RESCHEDULE_FEE')), 0)
      ORDER BY b.id
      LIMIT 5
    ) sample;
    RAISE EXCEPTION 'BR-CANCEL-17: % booking(s) already exceed the refund cap; reconcile money '
      'before applying 0008 (sample: %)', v_violations, v_sample USING ERRCODE = '23514';
  END IF;
END $$;

CREATE TRIGGER trg_payments_refund_cap BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_refund_cap();

-- TD-12: hàm mới không mở quyền EXECUTE cho PUBLIC; chỉ vai trò ứng dụng (nơi trigger chạy) được giữ.
REVOKE ALL ON FUNCTION fn_guard_refund_cap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_guard_refund_cap() TO app_rw;
