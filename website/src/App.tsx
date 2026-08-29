import { Nav } from "./components/nav";
import { Hero } from "./components/hero";
import { StatsTicker } from "./components/stats-ticker";
import { TechMarquee } from "./components/tech-marquee";
import { Bento } from "./components/bento";
import { DeepDive } from "./components/deep-dive";
import { Workflows } from "./components/workflows";
import { Pillars } from "./components/pillars";
import { LocalData } from "./components/local-data";
import { DevZone } from "./components/dev-zone";
import { Screenshots } from "./components/screenshots";
import { Changelog } from "./components/changelog";
import { Faq } from "./components/faq";
import { Download } from "./components/download";
import { VersionBar } from "./components/version-bar";
import { Footer } from "./components/footer";
import { ScrollProgress } from "./components/scroll-progress";
import { ToastProvider } from "./components/toast";

export default function App() {
  return (
    <ToastProvider>
      <ScrollProgress />
      <Nav />
      <main className="relative">
        <div className="relative z-10">
          <Hero />
          <StatsTicker />
          <TechMarquee />
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-b from-zinc-900/50 to-transparent pointer-events-none" />
            <Bento />
          </div>
          <DeepDive />
          <div className="section-divider mx-auto max-w-6xl" />
          <Workflows />
          <div className="section-divider mx-auto max-w-6xl" />
          <Pillars />
          <LocalData />
          <DevZone />
          <Screenshots />
          <Changelog />
          <div className="section-divider mx-auto max-w-6xl" />
          <Faq />
          <Download />
          <VersionBar />
        </div>
      </main>
      <Footer />
    </ToastProvider>
  );
}
