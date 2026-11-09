-- HB-184 — truy vấn bất biến sau lượt tải (kế hoạch kiểm thử §7.3 hàng 5/7, §6).
-- Mỗi truy vấn trả `vi_pham`; mọi giá trị khác 0 là KHÔNG ĐẠT.

-- BB-01: không có hai assignment còn hiệu lực chồng đêm trên cùng một đơn vị bán (NFR-REL-01).
SELECT 'BB-01 ban trung' AS bat_bien, count(*) AS vi_pham
  FROM room_assignments a
  JOIN room_assignments b
    ON a.room_id = b.room_id AND a.bed_no = b.bed_no AND a.id < b.id
   AND a.released_at IS NULL AND b.released_at IS NULL
   AND daterange(a.start_date::date, a.end_date::date) && daterange(b.start_date::date, b.end_date::date);

-- Mỗi đêm của loại phòng KB-B: số booking không oversold còn chiếm chỗ ≤ số đơn vị ACTIVE không bị khoá.
SELECT 'BB-01 dem phong cuoi' AS bat_bien, count(*) AS vi_pham
  FROM (
    SELECT d.day, count(DISTINCT br.id) AS held
      FROM bookings b
      JOIN booking_rooms br ON br.booking_id = b.id AND br.status <> 'CANCELLED'
      CROSS JOIN LATERAL generate_series(b.check_in::date, b.check_out::date - 1, interval '1 day') AS d(day)
     WHERE b.room_type_id = :'last_type'::uuid AND NOT b.oversold
       AND (b.status IN ('CONFIRMED', 'CHECKED_IN', 'PENDING_PAYMENT')
            OR (b.status = 'HELD' AND b.hold_expires_at > clock_timestamp()))
     GROUP BY d.day
  ) n
 WHERE n.held > (
   SELECT count(*) FROM rooms r
    WHERE r.room_type_id = :'last_type'::uuid AND r.status = 'ACTIVE'
      AND NOT EXISTS (SELECT 1 FROM room_blocks k WHERE k.room_id = r.id
                       AND k.start_date <= n.day AND k.end_date > n.day)
 );

-- NFR-REL-02: hold đã hết hạn quá 60 giây mà chưa được giải phóng (booking vẫn HELD).
SELECT 'REL-02 hold khong giai phong' AS bat_bien, count(*) AS vi_pham
  FROM bookings
 WHERE status = 'HELD' AND hold_expires_at < clock_timestamp() - interval '60 seconds';

-- Tiền: không âm, hoàn không vượt đã thu.
SELECT 'Tien khong am' AS bat_bien, count(*) AS vi_pham
  FROM bookings
 WHERE balance_due < 0 OR paid_amount < 0 OR refunded_amount > paid_amount;
