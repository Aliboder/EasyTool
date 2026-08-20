import { Route, Routes } from "react-router-dom";
import Layout from "@/components/layout";
import Home from "@/pages/home";
import ModulePage from "@/pages/module-page";
import { modules } from "@/data/modules";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Home />} />
        {modules.map((m) => (
          <Route key={m.id} path={m.path} element={<ModulePage module={m} />} />
        ))}
        <Route path="*" element={<Home />} />
      </Route>
    </Routes>
  );
}
