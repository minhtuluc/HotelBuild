-- HB-214: trần hoàn luỹ kế ép ở CSDL (TC-PAY-21, BR-CANCEL-17, BR-PAY-07).
--
-- `payments.amount` là VND nguyên và dòng REFUND mang dấu âm (`ck_payments_sign`), nên tổng đã hoàn
-- của một booking là `-sum(amount)` của các dòng REFUND **chưa FAILED**; tổng đã thu là `sum(amount)`
-- của các dòng thu SUCCEEDED (cùng tập `type` mà ledger coi là tiền thu). Trước migration này chỉ
-- `modules/pay/ledger` giữ bất biến; F5-QA-05 cho thấy `INSERT` thẳng một `Payment` vẫn lọt, nên
-- bất biến §1 #8 ("ép được ở CSDL thì ép ở CSDL") buộc phải chặn ở đây.
--
-- Migration chỉ tiến: nếu dữ liệu hiện có đã vi phạm thì DỪNG và báo số booking, không tự sửa tiền.

-- BEFORE: khoá dòng `bookings` theo đúng thứ tự ADR-014 (`bookings` → `payments`) trước khi ghi —
-- trùng thứ tự `loadLocked()` của API và `settle.ts` của worker. Khoá này tuần tự hoá mọi lần ghi
-- REFUND của cùng booking nên hai giao dịch đồng thời không thể cùng lọt, và không tạo chu trình khoá.
CREATE FUNCTION fn_lock_refund_booking() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type <> 'REFUND' OR NEW.status = 'FAILED' THEN
    RETURN NEW; -- Dòng không phải REFUND còn hiệu lực không đụng trần, không cần khoá.
  END IF;
  PERFORM 1 FROM bookings WHERE id = NEW.booking_id FOR UPDATE;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_refund_cap BEFORE INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_lock_refund_booking();

-- AFTER: cả câu lệnh đã ghi xong nên tổng nhìn thấy đủ mọi dòng — kể cả dòng vừa ghi và các dòng
-- trong cùng một `INSERT` nhiều VALUES (BEFORE chỉ thấy dòng ghi trước đó nên sẽ hở trần).
CREATE FUNCTION fn_guard_refund_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_refunded  bigint;
  v_collected bigint;
BEGIN
  -- Chỉ dòng REFUND còn hiệu lực mới chi tiền; REFUND FAILED không tính vào trần.
  IF NEW.type <> 'REFUND' OR NEW.status = 'FAILED' THEN
    RETURN NEW;
  END IF;
  SELECT coalesce(-sum(p.amount), 0) INTO v_refunded FROM payments p
   WHERE p.booking_id = NEW.booking_id AND p.type = 'REFUND' AND p.status <> 'FAILED';
  SELECT coalesce(sum(p.amount), 0) INTO v_collected FROM payments p
   WHERE p.booking_id = NEW.booking_id AND p.status = 'SUCCEEDED'
     AND p.type IN ('DEPOSIT','BALANCE','PENALTY','EXTRA_SERVICE','RESCHEDULE_FEE');
  IF v_refunded > v_collected THEN
    RAISE EXCEPTION 'BR-CANCEL-17/BR-PAY-07: cumulative refund % exceeds collected % for booking %',
      v_refunded, v_collected, NEW.booking_id USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_payments_refund_cap_check AFTER INSERT OR UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION fn_guard_refund_cap();

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

-- TD-12: hàm mới không mở quyền EXECUTE cho PUBLIC; chỉ vai trò chạy trigger (app_rw) được giữ.
REVOKE ALL ON FUNCTION fn_lock_refund_booking() FROM PUBLIC;
REVOKE ALL ON FUNCTION fn_guard_refund_cap() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION fn_lock_refund_booking() TO app_rw;
GRANT EXECUTE ON FUNCTION fn_guard_refund_cap() TO app_rw;
