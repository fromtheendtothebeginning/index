import { Navigate } from 'react-router-dom'
import HomePage from './pages/HomePage'
import AuthPage from './pages/AuthPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import BlogListPage from './pages/BlogListPage'
import BlogDetailPage from './pages/BlogDetailPage'
import BlogEditorPage from './pages/BlogEditorPage'
import ProjectListPage from './pages/ProjectListPage'
import ProjectDetailPage from './pages/ProjectDetailPage'
import ProjectEditorPage from './pages/ProjectEditorPage'
import LeetCodePage from './pages/LeetCodePage'
import ProfileEdit from './pages/ProfileEdit'
import AdminPage from './pages/AdminPage'
import MyPage from './pages/MyPage'
import ToolHomePage from './pages/ToolHomePage'

export default [
  { path: '/', element: <HomePage /> },
  { path: '/auth', element: <AuthPage /> },
  { path: '/login', element: <Navigate to="/auth" replace /> },
  { path: '/reset-password', element: <ResetPasswordPage /> },
  { path: '/blogs', element: <BlogListPage /> },
  { path: '/blogs/new', element: <BlogEditorPage /> },
  { path: '/blogs/:id', element: <BlogDetailPage /> },
  { path: '/blogs/:id/edit', element: <BlogEditorPage /> },
  { path: '/projects', element: <ProjectListPage /> },
  { path: '/projects/new', element: <ProjectEditorPage /> },
  { path: '/projects/:id', element: <ProjectDetailPage /> },
  { path: '/projects/:id/edit', element: <ProjectEditorPage /> },
  { path: '/leetcode', element: <LeetCodePage /> },
  { path: '/tools', element: <ToolHomePage /> },
  { path: '/profile', element: <ProfileEdit /> },
  { path: '/admin', element: <AdminPage /> },
  { path: '/my', element: <MyPage /> },
]
