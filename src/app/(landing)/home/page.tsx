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
  { title: "Which AI do I need?", content: "The one you already use every day. Queue Pilot is built to work inside Claude, ChatGPT and Grok, coding agents like Claude Code, Codex and Cursor, and any app that can add a remote MCP server. Your AI writes on the plan you already pay for; Queue Pilot gives it your week, your sources and your rules." },
  { title: "Does it post on its own?", content: "No. Queue Pilot saves drafts in Buffer and never schedules on its own. A draft is scheduled only when you approve it: in the app, in Buffer, or by telling your AI yes to the drafts it showed you. In Settings you can let your AI schedule when you ask without the extra confirm step, or keep scheduling to yourself only. A draft that breaks a blocking rule is refused either way." },
  { title: "Can I use it without an AI app?", content: "Yes. Write my week drafts your empty times with Queue Pilot's own AI, within a small daily allowance, or with your own API key in Settings. You review and approve in the app, the same as with a connected AI." },
  { title: "How do I connect a coding agent?", content: <>Copy one line from the Connect page and send it to Claude Code, Codex or Cursor. The agent fetches its <a href="/agent-setup/prompt.md" target="_blank" rel="noopener noreferrer">setup instructions</a>, installs the Queue Pilot skills and adds the connector, and you finish by signing in with Buffer.</> },
  { title: "How is this different from Buffer's MCP?", content: "Buffer checks what each network requires, like length and posting limits; Queue Pilot checks what you require. Buffer's MCP lets your AI read and write posts in Buffer. Queue Pilot works alongside it: it checks every draft against your playbook before saving it, whichever AI wrote it, adds your sources with checked quotes, and learns rules from your own edits. It is an independent open-source app, not made by Buffer." },
  { title: "Where do the posts come from?", content: "From what you already published: your newsletter, blog or RSS feed, YouTube videos through their transcripts, and pages you add. Each fact taken from a source carries the quote it came from, matched word for word against the saved copy. Your AI can also search the web and read pages through Exa." },
  { title: "Will it sound like AI?", content: "It writes from your own posts and the examples you picked, and your playbook refuses the phrases you have cut before. You still read every draft, and it goes out from your Buffer account under your name, like any post you write; Queue Pilot adds no label of its own." },
  { title: "Can my team review it, and what does it learn?", content: "Share a draft for review, or let teammates leave notes on it in Buffer. Make the same fix twice, or leave a note, and Queue Pilot offers it as a rule for that account. Nothing changes until you keep it, and a kept rule is checked on every draft, whichever AI writes it." },
  { title: "Which networks?", content: "Every network Buffer supports. Drafts fit each network's length, and daily posting limits are checked before saving. Networks that need an image or video, like Instagram, TikTok or YouTube, need one added before you approve. A locked or paused channel is named, with the reason, instead of drafted. Connect a Telegram channel or Discord server and Queue Pilot copies each post Buffer publishes there, once per post." },
  { title: "What can it change in my Buffer, and how do I stop it?", content: "It saves drafts, edits or deletes only drafts it made, and schedules a draft when you approve it. It can also add notes, tags and ideas when you ask. A post you wrote yourself is never touched. In Settings you can remove an AI app, sign out your other browsers, or delete your account and everything Queue Pilot kept; revoking Queue Pilot in Buffer ends its Buffer access." },
  { title: "How does it use Buffer's API?", content: <>Drafts are saved with Buffer's createPost as drafts, edited with editPost, and team review uses Buffer's own Notes, Tags and Ideas. It keeps one saved copy of your queue, so moving between screens costs no requests, and a refresh is one request. Buffer has no webhooks, so it refreshes when the copy is over five minutes old. Every request is counted against one shared budget and pauses before Buffer's limit. In our test with 3 channels, a whole first session, writing a week of 15 drafts, took 13 requests. <a href={`${REPO}#how-it-uses-buffers-api`} target="_blank" rel="noopener noreferrer">How it uses the Buffer API</a> has the details.</> },
  { title: "What does it cost?", content: "Nothing. Queue Pilot is free and open source, MIT licensed, and a connected AI writes on the plan you already have." },
  { title: "What does it keep, and who sees it?", content: <>It keeps your playbook, voice notes, sources and a record of what each draft was checked against. API keys and sign-in tokens are stored encrypted. Your drafts and sources also go to the AI that writes them: your connected AI app under your own account, or the AI provider Queue Pilot uses. The <a href="/privacy">privacy notice</a> lists every service that receives data.</> },
  { title: "Can I run my own copy?", content: <>Yes. Queue Pilot is MIT licensed. Deploy it to Vercel or run it with Docker, using your own Buffer app keys. Your copy keeps its data in your own database, and keys for YouTube transcripts (Supadata), web search (Exa), Telegram and Discord go in its admin page. The <a href={`${REPO}#readme`} target="_blank" rel="noopener noreferrer">README</a> has the steps.</> },
  { title: "Where do I get help?", content: <>Open an issue on <a href={`${REPO}/issues`} target="_blank" rel="noopener noreferrer">GitHub</a>. Report a security problem privately, as the <a href={`${REPO}/blob/main/SECURITY.md`} target="_blank" rel="noopener noreferrer">security policy</a> describes, and see what is planned in the <a href={`${REPO}/blob/main/ROADMAP.md`} target="_blank" rel="noopener noreferrer">roadmap</a>.</> },
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
            <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
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
              <p><a href={REPO} target="_blank" rel="noopener noreferrer">Code, changelog and issues on GitHub</a></p>
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
            <a href={`${REPO}#how-it-uses-buffers-api`} target="_blank" rel="noopener noreferrer">How it uses the Buffer API</a>
            <a href={`${REPO}/blob/main/CHANGELOG.md`} target="_blank" rel="noopener noreferrer">Changelog</a>
            <a href={REPO} target="_blank" rel="noopener noreferrer">GitHub</a>
          </nav>
        </div>
      </footer>
    </div>
  );
}
