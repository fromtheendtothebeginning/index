import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { ContactIcon, UiIcon } from '../components/Icons'
import { t } from '../i18n'
import './ToolHomePage.css'

function ToolHomePage() {
  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main">
        <header className="tool-header">
          <h1 className="tool-title">{t('toolHome.title')}</h1>
          <p className="tool-subtitle">{t('toolHome.subtitle')}</p>
        </header>

        <div className="tool-cards">
          <Link to="/tools/video-parse" className="tool-card-link">
            <div className="tool-card-icon"><ContactIcon icon="bilibili" className="tool-brand-icon" /></div>
            <div className="tool-card-info">
              <h2 className="tool-card-name">{t('toolHome.videoParse.name')}</h2>
              <p className="tool-card-desc">{t('toolHome.videoParse.desc')}</p>
            </div>
            <span className="tool-card-arrow">→</span>
          </Link>

          <Link to="/tools/video-summary" className="tool-card-link">
            <div className="tool-card-icon"><UiIcon name="video-summary" size={28} className="tool-brand-icon" /></div>
            <div className="tool-card-info">
              <h2 className="tool-card-name">{t('toolHome.videoSummary.name')}</h2>
              <p className="tool-card-desc">{t('toolHome.videoSummary.desc')}</p>
            </div>
            <span className="tool-card-arrow">→</span>
          </Link>

          <Link to="/tools/img2latex" className="tool-card-link">
            <div className="tool-card-icon"><UiIcon name="img2latex" size={28} className="tool-brand-icon" /></div>
            <div className="tool-card-info">
              <h2 className="tool-card-name">{t('toolHome.img2latex.name')}</h2>
              <p className="tool-card-desc">{t('toolHome.img2latex.desc')}</p>
            </div>
            <span className="tool-card-arrow">→</span>
          </Link>

          <Link to="/tools/campus-service" className="tool-card-link">
            <div className="tool-card-icon"><UiIcon name="campus" size={28} className="tool-brand-icon" /></div>
            <div className="tool-card-info">
              <h2 className="tool-card-name">{t('toolHome.campusService.name')}</h2>
              <p className="tool-card-desc">{t('toolHome.campusService.desc')}</p>
            </div>
            <span className="tool-card-arrow">→</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default ToolHomePage