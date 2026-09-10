// 默认寝室的「单个 dorm 串 ⇄ 校区 / 楼号 / 宿舍号」转换。
// 后端只有 CampusCred.dorm 一个字段，故保存时拼串、加载时反解析。
// 串格式：`${campus} ${building}号楼${room}`（例：奉贤校区 24号楼1016）；
// 旧数据可能只有「24号楼1016」（无校区）→ 视为奉贤校区。

export const CAMPUSES = ['奉贤校区', '徐汇校区']
export const DEFAULT_CAMPUS = CAMPUSES[0]

/** 寝室串 → { campus, building, room }；解析不出则回默认校区 + 空楼号/宿舍号 */
export function parseDorm(dorm) {
  const raw = (dorm || '').trim()
  let campus = DEFAULT_CAMPUS
  let rest = raw
  for (const c of CAMPUSES) {
    if (raw.startsWith(c)) {
      campus = c
      rest = raw.slice(c.length).trim()
      break
    }
  }
  // 楼号与宿舍号之间必须有「号楼 / 号 / 楼」标记或分隔符，避免把单个号码（如 1016）误拆成 101 + 6
  const m = rest.match(/^(\d{1,4})\s*(?:号楼|号|楼)\s*[-\s]?\s*([0-9A-Za-z]{1,12})$/)
    || rest.match(/^(\d{1,4})\s*[-\s]\s*([0-9A-Za-z]{1,12})$/)
  if (!m) return { campus, building: '', room: '' }
  return { campus, building: m[1], room: m[2] }
}

/** 三个字段 → 寝室串；楼号与宿舍号必须成对，否则返回空串（= 清空） */
export function buildDorm(campus, building, room) {
  const b = (building || '').trim()
  const r = (room || '').trim()
  if (!b || !r) return ''
  return `${(campus || '').trim() || DEFAULT_CAMPUS} ${b}号楼${r}`
}
