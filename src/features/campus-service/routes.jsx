import CampusServicePage from './CampusServicePage'
import { t } from '../../i18n'

export default [
  { path: '/tools/campus-service', element: <CampusServicePage /> },
  { path: '/tools/campus-service/:feature', element: <CampusServicePage /> },
]

// parent 指向既有导航项的 path：条目渲染进对应下拉，而不是顶层
export const nav = [{ label: t('campusService.navLabel'), path: '/tools/campus-service', parent: '/tools' }]
