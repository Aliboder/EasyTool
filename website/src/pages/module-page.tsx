import { Link } from "react-router-dom";
import { ArrowLeft, KeyRound } from "lucide-react";
import type { Module } from "@/data/modules";
import { modules } from "@/data/modules";
import BlurText from "@/components/bits/BlurText";
import Reveal from "@/components/reveal";

export default function ModulePage({ module }: { module: Module }) {
  const idx = modules.findIndex((m) => m.id === module.id);
  const prev = modules[(idx - 1 + modules.length) % modules.length];
  const next = modules[(idx + 1) % modules.length];

  return (
    <div>
      {/* HERO */}
      <section className="border-b border-rule">
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-16 md:grid-cols-12 md:py-24">
          <div className="md:col-span-8">
            <Link
              to="/"
              className="inline-flex items-center gap-1.5 text-sm text-ink-3 transition-colors hover:text-ultra"
            >
              <ArrowLeft className="size-4" />
              返回首页
            </Link>
            <p className="kicker mt-8 mb-6">
              {module.no} · {module.kicker}
            </p>
            <BlurText
              text={module.heroTitle}
              animateBy="characters"
              delay={45}
              direction="top"
              as="h1"
              className="font-display text-4xl font-bold leading-tight tracking-tight text-ink md:text-6xl"
            />
            <p className="mt-7 max-w-xl text-lg leading-relaxed text-ink-2">{module.lead}</p>
          </div>
          <aside className="md:col-span-4 md:pl-8">
            <dl className="border-l-2 border-ultra pl-5 text-sm">
              {module.specs.map((s) => (
                <div key={s.label} className="mb-4 flex items-baseline justify-between gap-4">
                  <dt className="text-ink-3">{s.label}</dt>
                  <dd className="num text-right font-mono text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </section>

      {/* BODY */}
      <section className="border-b border-rule">
        <div className="mx-auto grid max-w-6xl gap-12 px-5 py-16 md:grid-cols-12">
          <div className="md:col-span-4">
            <p className="kicker mb-3">Overview</p>
            <h2 className="font-display text-2xl font-bold text-ink">模块说明</h2>
          </div>
          <div className="space-y-5 md:col-span-8">
            {module.body.map((p, i) => (
              <Reveal key={i} as="p" className="text-base leading-loose text-ink-2">
                {p}
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURES */}
      <section className="border-b border-rule">
        <div className="mx-auto max-w-6xl px-5 py-16">
          <Reveal className="mb-10 flex items-baseline justify-between border-b-2 border-ink pb-3">
            <p className="kicker">Features</p>
          </Reveal>
          <div className="grid gap-px bg-rule md:grid-cols-2 lg:grid-cols-3">
            {module.features.map((f, i) => (
              <Reveal key={f.title} as="div" className="bg-paper p-7">
                <span className="num font-display text-3xl font-bold text-rule">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="mt-3 font-display text-lg font-bold text-ink">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-ink-2">{f.desc}</p>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* HOTKEY CTA */}
      <section className="border-b border-rule">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-6 px-5 py-12">
          <div className="flex items-center gap-4">
            <span className="inline-flex size-12 items-center justify-center border-2 border-ink">
              <KeyRound className="size-5 text-ultra" />
            </span>
            <div>
              <p className="kicker">Hotkey</p>
              <p className="mt-1 text-lg font-medium text-ink">{module.hotkeyLabel}</p>
            </div>
          </div>
          <p className="num border-2 border-ink bg-paper px-6 py-3 font-mono text-xl font-semibold text-ultra">
            {module.hotkey}
          </p>
        </div>
      </section>

      {/* PAGINATION */}
      <section>
        <div className="mx-auto grid max-w-6xl gap-px bg-rule px-5 py-16 md:grid-cols-2">
          <Link to={prev.path} className="group bg-paper p-8 transition-colors hover:bg-paper-2">
            <p className="kicker mb-3">← 上一模块</p>
            <p className="font-display text-2xl font-bold text-ink">
              <span className="num mr-3 text-rule transition-colors group-hover:text-ultra">{prev.no}</span>
              {prev.name}
            </p>
          </Link>
          <Link
            to={next.path}
            className="group bg-paper p-8 text-right transition-colors hover:bg-paper-2"
          >
            <p className="kicker mb-3">下一模块 →</p>
            <p className="font-display text-2xl font-bold text-ink">
              <span className="num mr-3 text-rule transition-colors group-hover:text-ultra">{next.no}</span>
              {next.name}
            </p>
          </Link>
        </div>
      </section>
    </div>
  );
}
