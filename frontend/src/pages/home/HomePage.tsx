import { SiteNav } from './components/SiteNav'
import { Hero } from './components/Hero'
import { TrackReturn } from './components/TrackReturn'
import { Lifecycle } from './components/Lifecycle'
import { Capabilities } from './components/Capabilities'
import { WarehouseOps } from './components/WarehouseOps'
import { Intelligence } from './components/Intelligence'
import { Analytics } from './components/Analytics'
import { Recovery } from './components/Recovery'
import { Showcase } from './components/Showcase'
import { FinalCta, Process, Proof } from './components/Sections2'
import { SiteFooter } from './components/SiteFooter'
import styles from './home.module.css'

export default function HomePage() {
  return (
    <div className={styles.page}>
      <a className={styles.skip} href="#main">
        Skip to content
      </a>
      <SiteNav />
      <main id="main" tabIndex={-1}>
        <Hero />
        <TrackReturn />
        <Lifecycle />
        <Capabilities />
        <WarehouseOps />
        <Intelligence />
        <Analytics />
        <Recovery />
        <Showcase />
        <Process />
        <Proof />
        <FinalCta />
      </main>
      <SiteFooter />
    </div>
  )
}
