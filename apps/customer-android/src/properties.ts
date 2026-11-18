/** Chọn cơ sở khi tìm phòng (HB-249) — phần thuần, kiểm được trên Node. */
export interface PropertyChoice {
  readonly id: string;
  readonly name: string;
}

/** Giữ lựa chọn hiện tại nếu còn trong danh sách; không thì cơ sở đầu; danh sách rỗng → chưa chọn. */
export function initialPropertyId(properties: readonly PropertyChoice[], current: string): string {
  if (properties.some((property) => property.id === current)) return current;
  return properties[0]?.id ?? '';
}
