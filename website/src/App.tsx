import { Nav } from "./components/nav";
import { Hero } from "./components/hero";
import { StatsTicker } from "./components/stats-ticker";
import { TechMarquee } from "./components/tech-marquee";
import { Bento } from "./components/bento";
import { DeepDive } from "./components/deep-dive";
import { Hotkeys } from "./components/hotkeys";
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
      <main>
        <Hero />
        <StatsTicker />
        <TechMarquee />
        <Bento />
        <DeepDive />
        <Hotkeys />
        <Pillars />
        <LocalData />
        <DevZone />
        <Screenshots />
        <Changelog />
        <Faq />
        <Download />
        <VersionBar />
      </main>
      <Footer />
    </ToastProvider>
  );
}
