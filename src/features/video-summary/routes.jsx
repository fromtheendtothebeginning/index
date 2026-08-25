import VideoSummaryPage from './VideoSummaryPage'

export default [
  { path: '/tools/video-summary', element: <VideoSummaryPage /> },
]

// parent 指向既有导航项的 path：条目渲染进对应下拉，而不是顶层
export const nav = [{ label: '视频总结', path: '/tools/video-summary', parent: '/tools' }]
