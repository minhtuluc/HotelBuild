/**
 * So hợp đồng OpenAPI ứng viên với bản nền đã phát hành (api.md §7).
 * Phân loại thay đổi theo quy tắc phiên bản của tài liệu:
 * - Thêm path/phương thức/thuộc tính không bắt buộc/giá trị enum ⇒ tương thích.
 * - Bỏ path/phương thức/thuộc tính, thêm trường bắt buộc trong yêu cầu, đổi kiểu,
 *   bỏ mã phản hồi, thu hẹp enum, thêm tham số bắt buộc ⇒ phá vỡ.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function schemaTypeOf(schema) {
  if (!isObject(schema)) return 'unknown';
  if (typeof schema.type === 'string') return schema.type;
  if (Array.isArray(schema.enum)) return 'enum';
  if (isObject(schema.properties)) return 'object';
  if (schema.items !== undefined) return 'array';
  if (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) return 'union';
  return 'unknown';
}

function propertiesOf(schema) {
  return isObject(schema) && isObject(schema.properties) ? schema.properties : {};
}

function requiredNames(schema) {
  if (!isObject(schema) || !Array.isArray(schema.required)) return [];
  return schema.required.filter((name) => typeof name === 'string');
}

function enumValues(schema) {
  return isObject(schema) && Array.isArray(schema.enum) ? schema.enum : [];
}

function collectOperation(operation) {
  const request = operation.request?.body?.content?.['application/json']?.schema;
  const responses = {};
  const responseCodes = [];
  for (const [code, response] of Object.entries(operation.responses ?? {})) {
    responseCodes.push(code);
    const schema = response?.content?.['application/json']?.schema;
    // Phản hồi không có schema JSON (204 chỉ mô tả) không so thuộc tính.
    if (schema !== undefined) responses[code] = schema;
  }
  return {
    request,
    responses,
    responseCodes,
    parameters: Array.isArray(operation.parameters) ? operation.parameters : [],
  };
}

/** So đệ quy hai schema: bỏ thuộc tính/đổi kiểu/thu hẹp enum là phá vỡ. */
function compareSchemas(baselineSchema, candidateSchema, label, breaking, additive) {
  const before = propertiesOf(baselineSchema);
  const after = propertiesOf(candidateSchema);

  for (const name of Object.keys(before)) {
    if (!(name in after)) {
      breaking.push(`${label}: bỏ thuộc tính "${name}"`);
      continue;
    }
    const beforeProperty = before[name];
    const afterProperty = after[name];
    const beforeType = schemaTypeOf(beforeProperty);
    const afterType = schemaTypeOf(afterProperty);
    if (beforeType !== afterType && beforeType !== 'unknown' && afterType !== 'unknown') {
      breaking.push(`${label}: đổi kiểu "${name}" ${beforeType} → ${afterType}`);
    }
    const beforeEnum = enumValues(beforeProperty);
    const afterEnum = enumValues(afterProperty);
    for (const value of beforeEnum) {
      if (!afterEnum.includes(value)) breaking.push(`${label}: thu hẹp enum của "${name}"`);
    }
    for (const value of afterEnum) {
      if (!beforeEnum.includes(value)) additive.push(`${label}: thêm giá trị enum vào "${name}"`);
    }
    compareSchemas(beforeProperty, afterProperty, `${label}.${name}`, breaking, additive);
  }

  for (const name of Object.keys(after)) {
    if (!(name in before)) additive.push(`${label}: thêm thuộc tính "${name}"`);
  }
}

function compareOperation(baselineOperation, candidateOperation, label, breaking, additive) {
  const before = collectOperation(baselineOperation);
  const after = collectOperation(candidateOperation);

  for (const name of propertiesOf(after.request) ? requiredNames(after.request) : []) {
    const existed = name in propertiesOf(before.request);
    if (!existed) breaking.push(`${label}: thêm trường bắt buộc "${name}" trong yêu cầu`);
    else if (!requiredNames(before.request).includes(name)) {
      breaking.push(`${label}: trường "${name}" trong yêu cầu trở thành bắt buộc`);
    }
  }
  compareSchemas(before.request, after.request, `${label} yêu cầu`, breaking, additive);

  for (const code of before.responseCodes) {
    if (!after.responseCodes.includes(code)) breaking.push(`${label}: bỏ phản hồi ${code}`);
  }
  for (const code of after.responseCodes) {
    if (!before.responseCodes.includes(code)) additive.push(`${label}: thêm phản hồi ${code}`);
  }
  for (const [code, baselineSchema] of Object.entries(before.responses)) {
    const candidateSchema = after.responses[code];
    if (candidateSchema === undefined) continue;
    compareSchemas(baselineSchema, candidateSchema, `${label} phản hồi ${code}`, breaking, additive);
  }

  const baselineRequiredParameters = before.parameters
    .filter((parameter) => parameter?.required === true)
    .map((parameter) => `${parameter.in}:${parameter.name}`);
  for (const parameter of after.parameters) {
    if (parameter?.required !== true) continue;
    const key = `${parameter.in}:${parameter.name}`;
    if (baselineRequiredParameters.includes(key)) continue;
    const existed = before.parameters.some((p) => p?.in === parameter.in && p?.name === parameter.name);
    breaking.push(
      existed
        ? `${label}: tham số "${parameter.name}" trở thành bắt buộc`
        : `${label}: thêm tham số bắt buộc "${parameter.name}"`,
    );
  }
}

/** Trả về `{ breaking, additive }` — mảng chuỗi mô tả từng thay đổi. */
export function compareContracts(baseline, candidate) {
  const breaking = [];
  const additive = [];
  const baselinePaths = baseline?.paths ?? {};
  const candidatePaths = candidate?.paths ?? {};

  for (const [path, baselineItem] of Object.entries(baselinePaths)) {
    const candidateItem = candidatePaths[path];
    if (candidateItem === undefined) {
      breaking.push(`bỏ path ${path}`);
      continue;
    }
    for (const method of METHODS) {
      const baselineOperation = baselineItem?.[method];
      if (baselineOperation === undefined) continue;
      const candidateOperation = candidateItem?.[method];
      if (candidateOperation === undefined) {
        breaking.push(`bỏ phương thức ${method.toUpperCase()} ${path}`);
        continue;
      }
      compareOperation(baselineOperation, candidateOperation, `${method.toUpperCase()} ${path}`, breaking, additive);
    }
  }

  for (const path of Object.keys(candidatePaths)) {
    if (baselinePaths[path] === undefined) additive.push(`thêm path ${path}`);
  }

  return { breaking, additive };
}
