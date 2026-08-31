import Img2LatexPage from './Img2LatexPage'
import { t } from '../../i18n'

export default [
  { path: '/tools/img2latex', element: <Img2LatexPage /> },
]

// parent 指向既有导航项的 path：条目渲染进对应下拉，而不是顶层
export const nav = [{ label: t('img2latex.navLabel'), path: '/tools/img2latex', parent: '/tools' }]