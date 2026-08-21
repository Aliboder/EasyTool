import { Nav } from "./components/nav";
import { Hero } from "./components/hero";
import { Bento } from "./components/bento";
import { DeepDive } from "./components/deep-dive";
import { Hotkeys } from "./components/hotkeys";
import { Pillars } from "./components/pillars";
import { LocalData } from "./components/local-data";
import { Screenshots } from "./components/screenshots";
import { Download } from "./components/download";
import { VersionBar } from "./components/version-bar";
import { Footer } from "./components/footer";

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Bento />
        <DeepDive />
        <Hotkeys />
        <Pillars />
        <LocalData />
        <Screenshots />
        <Download />
        <VersionBar />
      </main>
      <Footer />
    </>
  );
}
