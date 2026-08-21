import { Nav } from "./components/nav";
import { Hero } from "./components/hero";
import { Bento } from "./components/bento";
import { Pillars } from "./components/pillars";
import { Screenshots } from "./components/screenshots";
import { VersionBar } from "./components/version-bar";
import { Footer } from "./components/footer";

export default function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <Bento />
        <Pillars />
        <Screenshots />
        <VersionBar />
      </main>
      <Footer />
    </>
  );
}
