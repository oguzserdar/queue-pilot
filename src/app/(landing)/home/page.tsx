import type { Metadata } from "next";
import type { ReactNode } from "react";
import Image from "next/image";
import { Badge } from "@/registry/components/badge/badge";
import { Accordion } from "@/registry/components/accordion/accordion";
import button from "@/registry/components/button/button.module.css";
import { PilotWeek } from "@/components/landing/pilot-week";
import { PixelField } from "@/components/landing/pixel-field";
import { AiStrip } from "@/components/landing/ai-strip";
import { PilotMark } from "@/components/landing/pilot-mark";
import { HandUnderline } from "@/components/landing/hand-underline";
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
  { title: "Can I run my own copy?", content: "Yes. Queue Pilot is MIT licensed. Deploy it to Vercel or run it with Docker, using your own Buffer app keys. Your copy keeps its data in your own database. The README has the steps." },
];

/** The public landing page: sections on one wrapper, Arc controls as Arc ships them. */
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
            <a className={s.quiet} href={DEMO}>Try the demo</a>
            <LinkButton href={SIGN_IN} kind="primary" size="md">Sign in with Buffer</LinkButton>
          </div>
        </div>
      </header>

      <main>
        <section className={s.hero} aria-labelledby="hero-title">
          <PixelField placement="hero" />
          <div className={[s.wrap, s.heroGrid].join(" ")}>
            <div className={s.heroCopy}>
              <h1 id="hero-title">Drafts for your Buffer queue, written from your own work, that <HandUnderline>learn from your fixes</HandUnderline>.</h1>
              <p className={s.lede}>Every AI writes a little differently, and none of them follows instructions every time. Queue Pilot checks each draft against your rules before it reaches your Buffer queue, whichever AI wrote it. Make the same fix twice and it offers to keep it as a rule.</p>
              <div className={s.ctas}>
                <LinkButton href={SIGN_IN} kind="primary" say="Sign in and I will show you your empty times.">Sign in with Buffer</LinkButton>
                <LinkButton href={DEMO} kind="secondary" say="No sign-in. Alex's sample account, the same app with sample data.">Try the demo</LinkButton>
              </div>
              <AiStrip />
            </div>
            <div className={s.heroMedia}><PixelField placement="hero" /><PilotWeek /></div>
          </div>
        </section>

        <section className={s.section} id="how" aria-labelledby="rules-title">
          <div className={[s.wrap, s.split].join(" ")}>
            <div className={s.copy}>
              <h2 id="rules-title">Your rules are enforced, not suggested</h2>
              <p>Buffer checks what each network requires. Queue Pilot checks what you require, on every draft, before it is saved to Buffer. Each rule in your playbook has one of two strengths.</p>
              <dl className={s.strengths}>
                <div>
                  <dt><Badge size="sm" tone="danger">Blocks drafts</Badge></dt>
                  <dd>A draft that breaks it is not saved to Buffer. If the check cannot run, the draft is not saved either.</dd>
                  <dd className={s.example}>No &ldquo;game-changer&rdquo;. Say what changed.</dd>
                </div>
                <div>
                  <dt><Badge size="sm" tone="warning">Flags drafts</Badge></dt>
                  <dd>A draft that breaks it is saved and flagged for you, so you see it before you approve.</dd>
                  <dd className={s.example}>Name the model and the number in the first line.</dd>
                </div>
              </dl>
              <p>Rules are judged by meaning, in any language: &ldquo;never open-source for a model&rdquo; also catches &ldquo;c&oacute;digo abierto&rdquo;. The check runs in Queue Pilot, so it is the same in ChatGPT, Claude, Grok and any app that takes an MCP connector.</p>
            </div>
            <figure className={s.chat}>
              <figcaption><span className={s.askMark} style={{ maskImage: "url(/landing/logos/grok.svg)", WebkitMaskImage: "url(/landing/logos/grok.svg)" }} aria-hidden="true" />Grok, with Queue Pilot connected</figcaption>
              <p className={s.you}>Fill next week from my newsletter.</p>
              <p className={s.qp}>Saved 5 drafts in your empty times. One was not saved: Thursday&apos;s LinkedIn post called Gemini 4 Carbon a &ldquo;game-changer&rdquo;, and your playbook blocks that.</p>
              <ul className={s.checks} aria-label="What your playbook decided">
                <li><span>Thu, LinkedIn: &ldquo;Gemini 4 Carbon is a game-changer&hellip;&rdquo;</span><Badge size="sm" tone="danger">Not saved</Badge></li>
                <li><span>Fri, LinkedIn: &ldquo;This week&apos;s biggest release&hellip;&rdquo;</span><Badge size="sm" tone="warning">Flagged</Badge></li>
                <li><span>4 drafts pass your playbook</span><Badge size="sm" tone="success">Saved</Badge></li>
              </ul>
            </figure>
          </div>
        </section>

        <section className={[s.section, s.tinted].join(" ")} aria-labelledby="learn-title">
          <div className={[s.wrap, s.stack].join(" ")}>
            <div className={s.copy}>
              <h2 id="learn-title">Fix it in Buffer twice. Keep it as a rule.</h2>
              <p>Queue Pilot reads the edits you make to its drafts in Buffer. When you make the same kind of fix twice, it finds it the next time you or your AI look, and offers a rule with your two edits as proof. Every AI you connect follows the rules you keep.</p>
            </div>
            <ol className={s.loop}>
              <li className={s.step}>
                <span className={s.meta}>Your edit in Buffer · Tue, LinkedIn</span>
                <p><del>This week&apos;s biggest release is a game-changer.</del></p>
                <p><ins>Gemini 4 Carbon ranks #1 on the Intelligence Index, at 59.</ins></p>
              </li>
              <li className={s.step}>
                <span className={s.meta}>Your edit in Buffer · Fri, LinkedIn</span>
                <p><del>A real game-changer for anyone running agents.</del></p>
                <p><ins>Claude Duet keeps working when you step away and checks with you before it acts.</ins></p>
                <span className={s.hint}>Other words, same fix. Edits are grouped by meaning.</span>
              </li>
              <li className={[s.step, s.offer].join(" ")}>
                <span className={s.meta}>Queue Pilot</span>
                <b>You made the same fix twice</b>
                <p>No &ldquo;game-changer&rdquo;. Say what changed.</p>
                <Badge size="sm" tone="success">Kept in your playbook</Badge>
              </li>
              <li className={s.step}>
                <span className={s.meta}>Next week · written in Claude</span>
                <p>GPT-6.1 Terra is OpenAI&apos;s new fast model for high-volume work and computer use.</p>
                <span className={s.check}><span>No &ldquo;game-changer&rdquo;</span><Badge size="sm" tone="success">Passes</Badge></span>
              </li>
            </ol>
          </div>
        </section>

        <section className={s.section} aria-labelledby="checks-title">
          <div className={[s.wrap, s.stack].join(" ")}>
            <div className={s.copy}>
              <h2 id="checks-title">Checked before it goes out. Watched after.</h2>
              <p>Quotes are checked against your saved source, and your kept rules are checked, before a draft is saved to Buffer. After it goes out, a copy reaches the chat you pick.</p>
            </div>
            <div className={s.pair}>
              <article className={s.panel} aria-label="Before">
                <p className={s.panelLabel}>Before it reaches Buffer</p>
                <div className={s.draft}>
                  <span className={s.meta}>Tue 12:00 · LinkedIn</span>
                  <p><mark>Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59.</mark> I want to see it on real repos before I switch.</p>
                </div>
                <ul className={s.checks}>
                  <li><span>Quote found in &ldquo;Gemini 4 Carbon: our next frontier model&rdquo;</span><Badge size="sm" tone="success">Matches</Badge></li>
                  <li><span>Your playbook, 4 rules</span><Badge size="sm" tone="success">Passes</Badge></li>
                  <li className={s.quiet}><span>Length, posting limit and channel, as Buffer would check them</span><Badge size="sm" tone="success">Fits</Badge></li>
                </ul>
              </article>
              <article className={s.panel} aria-label="After">
                <p className={s.panelLabel}>After it goes out</p>
                <div className={s.message}>
                  <span className={s.meta}>Telegram · This Week in AI · Tue 12:00 from LinkedIn</span>
                  <p>Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59. I want to see it on real repos before I switch.</p>
                </div>
                <div className={s.message}>
                  <span className={s.meta}>Discord · #social</span>
                  <p>Android Studio now lets you pick from over 40 coding agents.</p>
                </div>
                <ul className={s.checks}>
                  <li><span>In Queue Pilot: X 09:00. The image could not be loaded from its link.</span><Badge size="sm" tone="danger">Failed</Badge></li>
                </ul>
                <p className={s.panelNote}>A copy of each sent post goes to the Telegram chat or Discord channel you pick. A failed post shows Buffer&apos;s own reason in Queue Pilot.</p>
              </article>
            </div>
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
          <div className={[s.wrap, s.split].join(" ")}>
            <div className={s.copy}>
              <h2 id="oss-title">Open source. Run your own copy.</h2>
              <p>Queue Pilot is MIT licensed. This site is one deployed copy. Yours keeps its data in your own database and signs in with your own Buffer app.</p>
              <p><a href={REPO}>Code, changelog and issues on GitHub</a></p>
            </div>
            <ol className={s.loop}>
              <li className={s.step}><span className={s.meta}>1 · Buffer</span><p>Create an app client in Buffer under Settings, API, App Clients, with your address as its redirect.</p></li>
              <li className={s.step}><span className={s.meta}>2 · Database</span><p>Create a Postgres database and fill in the values from <code>.env.example</code>. Each line says how.</p></li>
              <li className={s.step}><span className={s.meta}>3 · Deploy</span><p>Deploy to Vercel, or run <code>docker compose up -d</code>. Migrations run on every start.</p></li>
              <li className={s.step}><span className={s.meta}>4 · Admin</span><p>Open <code>/admin</code>, sign in with Buffer and claim the deployment with your setup code.</p></li>
            </ol>
          </div>
        </section>

        <section className={s.band} aria-labelledby="start-title">
          <PixelField placement="band" />
          <div className={s.wrap} aria-hidden="true"><PilotMark className={s.bandPilot} /></div>
          <div className={[s.wrap, s.bandInner].join(" ")}>
            <h2 id="start-title">Fill next week from what you already shipped</h2>
            <p>Sign in with Buffer, connect your AI, and ask it to fill next week from your newsletter, blog or videos.</p>
            <div className={s.ctas}>
              <LinkButton href={SIGN_IN} kind="secondary">Sign in with Buffer</LinkButton>
              <a className={s.bandLink} href={DEMO}>Try the demo</a>
            </div>
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
