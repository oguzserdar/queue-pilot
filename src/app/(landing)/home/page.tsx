import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import { Accordion } from "@/registry/components/accordion/accordion";
import button from "@/registry/components/button/button.module.css";
import { PilotWeek } from "@/components/landing/pilot-week";
import { PixelField } from "@/components/landing/pixel-field";
import { AiStrip } from "@/components/landing/ai-strip";
import { HandUnderline } from "@/components/landing/hand-underline";
import { SetupScene } from "@/components/landing/setup-scene";
import { PixelHero } from "@/components/landing/pixel-hero";
import { DraftTour, SameFixTour } from "@/components/landing/draft-tour";
import { demoWeek } from "@/lib/demo-data";
import { countOpenSlots } from "@/lib/week-model";
import { exampleApprovals, exampleEvidence, exampleNotes, exampleRules, exampleTags, exampleWriting } from "@/lib/example-week-extras";
import s from "./page.module.css";

export const metadata: Metadata = {
  title: "Queue Pilot",
  description: "The AI you already use fills the empty times in your Buffer week with drafts from your own work, and every draft is checked against your rules before it reaches Buffer, whichever AI wrote it.",
  // Kept out of search until v0.9 launches the homepage.
  robots: { index: false },
  // Signed out, `/` serves this page (src/proxy.ts); /home is only where its file lives.
  alternates: { canonical: "/" },
};

const SIGN_IN = "/sign-in";
const DEMO = "/demo";
const REPO = "https://github.com/oguzserdar/queue-pilot";

/** A link drawn with Arc's own button styles, unchanged. */
function LinkButton({ href, kind, size = "lg", say, children }: { href: string; kind: "primary" | "secondary"; size?: "md" | "lg"; say?: string; children: ReactNode }) {
  return <a className={[button.button, button[kind], button[size]].join(" ")} href={href} data-pilot-say={say}>{children}</a>;
}

const faq = [
  { title: "How is this different from Buffer's MCP?", content: "Buffer checks what each network requires, like length and posting limits. Queue Pilot checks what you require. Buffer's MCP lets your AI read and write posts in Buffer; Queue Pilot works alongside it and checks every draft against your playbook before saving it, whichever AI wrote it. It also adds your sources with checked quotes and the rules learned from your own edits." },
  { title: "Does it post on its own?", content: "No. Queue Pilot saves drafts and never schedules on its own. By default your AI shows you the exact drafts and schedules them only after you say yes in the chat. In Settings you can drop that yes step, or keep scheduling for yourself only." },
  { title: "Will it sound like AI?", content: "Your AI reads the posts you picked as your voice before it writes, and your playbook catches the phrases you have cut before." },
  { title: "What does it cost?", content: "Queue Pilot is free and open source. A connected AI writes on the plan you already have. Without one, the hosted copy writes with its own AI within a small daily allowance, or you can add your own API key." },
  { title: "Which networks?", content: "Every channel Buffer can post to. Drafts are written to each network's length, and daily posting limits are checked before saving. A locked or paused channel is named, with the reason, instead of drafted." },
  { title: "What can it change in my Buffer?", content: "It saves drafts, edits or deletes only drafts it made, and schedules a draft when you approve it. A post you wrote yourself is never touched." },
  { title: "Is Queue Pilot made by Buffer?", content: "No. It is an independent open-source app built on the Buffer API for Buffer Commit. You sign in with your own Buffer account." },
  { title: "Can I stop it?", content: "Yes. In Settings you can remove an AI app, sign out your other browsers, or delete your account and everything Queue Pilot kept." },
  { title: "Does it work with Telegram, Discord or videos?", content: "Yes. After Buffer publishes a post, Queue Pilot can post the same text in your Telegram channel and Discord channel. It can also draft from YouTube videos through their transcripts, read with Supadata, and your AI can search the web and read pages through Exa. On your own copy, add those two keys in /admin." },
  { title: "Can I run my own copy?", content: <>Yes. Queue Pilot is MIT licensed. Deploy it to Vercel or run it with Docker, using your own Buffer app keys. Your copy keeps its data in your own database. The <a href={`${REPO}#readme`}>README</a> has the steps.</> },
];

/** The public landing page: sections on one wrapper, Arc controls as Arc ships them. */
/** The demo week's props, exactly as the demo's own Next week page passes them. */
function demoWeekProps() {
  const ids = demoWeek.posts.filter((p) => p.status === "draft").map((p) => p.id);
  return { week: demoWeek, evidence: exampleEvidence, notesPreview: exampleNotes(ids), tagsPreview: exampleTags(ids), rules: exampleRules, writing: exampleWriting, writeCount: countOpenSlots(demoWeek), approvals: exampleApprovals };
}

/** The homepage, drawn with the app's real components (the hero plays a scripted walkthrough). */
export default function HomePage() {
  return (
    <div className={s.page}>
      <header className={s.header}>
        <div className={[s.wrap, s.headerRow].join(" ")}>
          <a className={s.brand} href="/"><Image src="/icon.svg" alt="" width={26} height={26} />Queue Pilot</a>
          <nav className={s.nav} aria-label="Main">
            <a href="#how">How it works</a>
            <a href="#questions">Questions</a>
            <a href="#run-your-own">Run your own</a>
            <a href={REPO}>GitHub</a>
          </nav>
          <div className={s.headerActions}>
            <a className={s.quiet} href={DEMO} data-pilot-say="No sign-in. Alex's sample account, the same app with sample data.">Try the demo</a>
            <LinkButton href={SIGN_IN} kind="primary" size="md" say="Sign in and I will show you your empty times.">Sign in with Buffer</LinkButton>
          </div>
        </div>
      </header>

      <main>
        <section className={s.hero} aria-labelledby="hero-title">
          <PixelField placement="hero" />
          <div className={[s.wrap, s.heroStack].join(" ")}>
            <div className={s.heroCopy}>
              <h1 id="hero-title">Your Buffer week, written from <HandUnderline>your own work</HandUnderline>.</h1>
              <p className={s.lede}>The AI you already use drafts posts from what you publish: your newsletter, blog or videos. Queue Pilot checks each one against your rules before it reaches Buffer.</p>
              <div className={s.ctas}>
                <LinkButton href={SIGN_IN} kind="primary" say="Sign in and I will show you your empty times.">Sign in with Buffer</LinkButton>
                <LinkButton href={DEMO} kind="secondary" say="No sign-in. Alex's sample account, the same app with sample data.">Try the demo</LinkButton>
              </div>
            </div>
            <PilotWeek week={false} className={s.heroPilot} />
            <div className={s.heroArt}><PixelHero week={demoWeek} /></div>
          </div>
        </section>

        <section className={s.strip} aria-label="Works in">
          <div className={s.wrap}><AiStrip /></div>
        </section>

        <section className={s.section} id="how" aria-labelledby="how-title">
          <div className={[s.wrap, s.stack].join(" ")}>
            <div className={s.copy}>
              <h2 id="how-title">How a draft reaches Buffer</h2>
            </div>
            <ol className={s.flow}>
              <li><b>Ask your AI</b><p>&ldquo;Fill next week from my latest posts.&rdquo; In Claude, ChatGPT, Grok or any MCP app.</p></li>
              <li><b>Queue Pilot checks each draft</b><p>Quotes against your source, then your rules. A blocking rule stops the save.</p></li>
              <li><b>You approve</b><p>Drafts wait in Buffer. Approve them in Queue Pilot, in Buffer or in your AI chat.</p></li>
            </ol>
            <figure className={[s.shot, s.liveShot].join(" ")}>
              <DraftTour {...demoWeekProps()} showDraft="d1" />
            </figure>
          </div>
        </section>

        <section className={[s.section, s.tinted].join(" ")} aria-labelledby="learn-title">
          <div className={[s.wrap, s.split].join(" ")}>
            <div className={s.copy}>
              <h2 id="learn-title">Fix it twice. Keep it as a rule.</h2>
              <p>Make the same edit in Buffer twice and Queue Pilot offers it as a rule, for every AI you use.</p>
            </div>
            <figure className={[s.shot, s.cardShot, s.liveShot].join(" ")}>
              <SameFixTour />
            </figure>
          </div>
        </section>

        <section className={s.section} id="questions" aria-labelledby="faq-title">
          <div className={[s.wrap, s.split].join(" ")}>
            <div className={s.copy}>
              <h2 id="faq-title">Questions</h2>
              <p>What Queue Pilot does with your Buffer, your AI and your posts.</p>
            </div>
            <Accordion items={faq} size="lg" />
          </div>
        </section>

        <section className={[s.section, s.tinted].join(" ")} id="run-your-own" aria-labelledby="oss-title">
          <div className={[s.wrap, s.stack].join(" ")}>
            <div className={s.copy}>
              <h2 id="oss-title">Open source. Run your own copy.</h2>
              <p>Queue Pilot is MIT licensed. This site is one deployed copy. Yours keeps its data in your own database and signs in with your own Buffer app.</p>
              <p><a href={REPO}>Code, changelog and issues on GitHub</a></p>
            </div>
            <ol className={s.loop}>
              <li className={s.step}><SetupScene step={0} className={s.stepArt} /><span className={s.meta}>Buffer</span><p>Add an app client in Buffer's API settings, with your address as its redirect.</p></li>
              <li className={s.step}><SetupScene step={1} className={s.stepArt} /><span className={s.meta}>Database</span><p>Create a Postgres database, then fill in <code>.env.example</code>. Each line says how.</p></li>
              <li className={s.step}><SetupScene step={2} className={s.stepArt} /><span className={s.meta}>Deploy</span><p>Deploy to Vercel, or run <code>docker compose up -d</code>. Migrations run on every start.</p></li>
              <li className={s.step}><SetupScene step={3} className={s.stepArt} /><span className={s.meta}>Admin</span><p>Open <code>/admin</code>, sign in with Buffer and claim it with your setup code.</p></li>
            </ol>
          </div>
        </section>

        <section className={s.band} aria-labelledby="start-title" data-pilot-scope="">
          <PixelField placement="band" />
          <div className={[s.wrap, s.bandInner].join(" ")}>
            <h2 id="start-title">Fill next week from what you already shipped</h2>
            <p>Sign in with Buffer, connect your AI, and ask it to fill next week from your newsletter, blog or videos.</p>
            <div className={s.ctas}>
              <LinkButton href={SIGN_IN} kind="secondary" say="Sign in and I will show you your empty times.">Sign in with Buffer</LinkButton>
              <a className={s.bandLink} href={DEMO} data-pilot-say="No sign-in. Alex's sample account, the same app with sample data.">Try the demo</a>
            </div>
            <PilotWeek week={false} tone="light" className={s.bandPilot} />
          </div>
        </section>
      </main>

      <footer className={s.footer}>
        <div className={[s.wrap, s.footerRow].join(" ")}>
          <span className={s.brand}><Image src="/icon.svg" alt="" width={22} height={22} />Queue Pilot</span>
          <span className={s.fine}>Not made by Buffer. An entry in Buffer Commit. MIT licensed.</span>
          <nav className={s.nav} aria-label="Footer">
            <a href={`${REPO}#how-it-uses-buffers-api`}>How it uses the Buffer API</a>
            <a href={`${REPO}/blob/main/CHANGELOG.md`}>Changelog</a>
            <a href={REPO}>GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
