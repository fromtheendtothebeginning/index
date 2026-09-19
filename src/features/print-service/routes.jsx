import PrintPage from './PrintPage'
import { t } from '../../i18n'

export default [
  { path: '/tools/print', element: <PrintPage /> },
]

// parent 指向既有导航项的 path：条目渲染进对应下拉，而不是顶层
export const nav = [{ label: t('printService.navLabel'), path: '/tools/print', parent: '/tools' }]
