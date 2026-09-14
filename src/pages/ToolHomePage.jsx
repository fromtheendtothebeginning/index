import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { UiIcon } from '../components/Icons'
import { t } from '../i18n'
import './ToolHomePage.css'

function ToolHomePage() {
  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <main className="section tool-home">
        <div className="section-inner">
          <header className="section-head">
            <div className="section-head-meta">
              <span className="folio">01</span>
              <span className="label">Tools</span>
            </div>
            <h1 className="section-title">{t('toolHome.title')}</h1>
            <p className="section-desc">{t('toolHome.subtitle')}</p>
          </header>

          <div className="tool-index">
            <Link to="/tools/img2latex" className="tool-entry">
              <span className="tool-entry-icon"><UiIcon name="img2latex" size={22} /></span>
              <div className="tool-entry-info">
                <h2 className="tool-entry-name">{t('toolHome.img2latex.name')}</h2>
                <p className="tool-entry-desc">{t('toolHome.img2latex.desc')}</p>
              </div>
              <span className="tool-entry-arrow" aria-hidden="true">→</span>
            </Link>

            <Link to="/tools/campus-service" className="tool-entry">
              <span className="tool-entry-icon"><UiIcon name="campus" size={22} /></span>
              <div className="tool-entry-info">
                <h2 className="tool-entry-name">{t('toolHome.campusService.name')}</h2>
                <p className="tool-entry-desc">{t('toolHome.campusService.desc')}</p>
              </div>
              <span className="tool-entry-arrow" aria-hidden="true">→</span>
            </Link>
          </div>
        </div>
      </main>
    </div>
  )
}

export default ToolHomePage
