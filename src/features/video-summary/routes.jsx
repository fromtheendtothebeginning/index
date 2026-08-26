import VideoSummaryPage from './VideoSummaryPage'
import { t } from '../../i18n'

export default [
  { path: '/tools/video-summary', element: <VideoSummaryPage /> },
]

// parent 指向既有导航项的 path：条目渲染进对应下拉，而不是顶层
export const nav = [{ label: t('videoSummary.navLabel'), path: '/tools/video-summary', parent: '/tools' }]
