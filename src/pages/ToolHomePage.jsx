import { Link } from 'react-router-dom'
import Navbar from '../components/Navbar'
import { ContactIcon } from '../components/Icons'
import './ToolHomePage.css'

function ToolHomePage() {
  return (
    <div className="tool-page">
      <Navbar activePage="tools" />
      <div className="tool-main">
        <header className="tool-header">
          <h1 className="tool-title">工具</h1>
          <p className="tool-subtitle">实用小工具，助力效率与创作（需登录）</p>
        </header>

        <div className="tool-cards">
          <Link to="/tools/video-parse" className="tool-card-link">
            <div className="tool-card-icon"><ContactIcon icon="bilibili" className="tool-brand-icon" /></div>
            <div className="tool-card-info">
              <h2 className="tool-card-name">视频解析</h2>
              <p className="tool-card-desc">解析 B站视频信息与清晰度，并下载为 mp4</p>
            </div>
            <span className="tool-card-arrow">→</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

export default ToolHomePage