import { Routes, Route } from 'react-router-dom'
import legacyRoutes from './legacyRoutes'

const featureMods = import.meta.glob('./features/*/routes.{js,jsx}', { eager: true })

const featureRoutes = Object.values(featureMods).flatMap(mod => mod.default || [])

export const navItems = Object.values(featureMods)
  .flatMap(mod => mod.nav || [])
  .filter(item => item && item.label && item.path)

export function AppRoutes() {
  return (
    <Routes>
      {[...legacyRoutes, ...featureRoutes].map(({ path, element }) => (
        <Route key={path} path={path} element={element} />
      ))}
    </Routes>
  )
}
