import type { Metadata } from "next";
import { Contact, LegalPage } from "@/components/site/legal";

export const metadata: Metadata = { title: "Privacy", description: "What Hookline keeps, why, and how to delete it." };

export default function Privacy() {
  return (
    <LegalPage title="Privacy" updated="October 16, 2026">
      <p>This page says what Hookline keeps about you, why, who else sees it, and how to delete it. If anything here is unclear, write to <Contact />.</p>

      <h2>What we keep</h2>
      <ul>
        <li><b>Your account</b>: your email address, the name you give, what you use Hookline for, and your timezone.</li>
        <li><b>Connected accounts</b>: for YouTube and TikTok, the channel or account&rsquo;s id, name and picture, your TikTok username, and the access tokens they give us, stored encrypted.</li>
        <li><b>Your Shorts</b>: the videos we make for you, your yes or no on each, titles you edit, the rendered files, and each posted Short&rsquo;s view counts.</li>
        <li><b>Your LIVE game</b>: your game settings, your answers about whether you can get gifts on a TikTok LIVE, and each session&rsquo;s numbers (rounds, gift coins seen, the most viewers playing, your top gifters&rsquo; display names and coins, and the username of the TikTok LIVE the game heard).</li>
        <li><b>Earnings</b>: daily figures from the accounts you connect, and your goals. If you add a Stripe key, it&rsquo;s a read-only restricted key, stored encrypted.</li>
        <li><b>Billing</b>: your plan and Stripe&rsquo;s customer and subscription ids. Stripe handles your card; we never see it.</li>
      </ul>

      <h2>What we do with it</h2>
      <p>Only what you can see the app doing: making and posting the Shorts you approve, running your LIVE game, showing your trends and earnings, and charging for your plan. We don&rsquo;t sell your data, and we don&rsquo;t use it for advertising.</p>

      <h2>Google and YouTube</h2>
      <p>
        When you connect YouTube, Hookline asks Google for permission to upload videos to your channel, read your channel&rsquo;s details and videos, and read your channel&rsquo;s analytics, including estimated revenue for monetized channels. We use these only to post the Shorts you approve, track how they do, and show your figures in Earnings. Hookline&rsquo;s use and transfer of information received from Google APIs follows the{" "}
        <a href="https://developers.google.com/terms/api-services-user-data-policy" target="_blank" rel="noreferrer">Google API Services User Data Policy</a>, including the Limited Use requirements. Hookline uses YouTube API Services; see{" "}
        <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube&rsquo;s Terms of Service</a> and{" "}
        <a href="https://policies.google.com/privacy" target="_blank" rel="noreferrer">Google&rsquo;s Privacy Policy</a>. You can remove Hookline&rsquo;s access at any time from your{" "}
        <a href="https://myaccount.google.com/permissions" target="_blank" rel="noreferrer">Google account&rsquo;s security settings</a>.
      </p>

      <h2>TikTok</h2>
      <p>When you connect TikTok, Hookline asks for your basic profile and username, your videos&rsquo; view counts, and permission to upload videos you approve. Your username is how Hookline checks that a LIVE the game heard was yours, so its gift coins can count in Earnings. Your LIVE game reads your LIVE&rsquo;s public events (chats, likes, gifts) through a tool on your own computer; it never has your TikTok password.</p>

      <h2>Children and teens</h2>
      <p>Hookline is for people 13 and older, and we don&rsquo;t knowingly keep anything about a child under 13. If you think a child under 13 has an account, write to <Contact /> and we&rsquo;ll delete it. If you&rsquo;re under 18, use Hookline with a parent or guardian&rsquo;s permission; any paid plan has to be theirs.</p>

      <h2>Who else sees it</h2>
      <p>The services Hookline runs on: Supabase (accounts, database and video storage), Vercel (the website), Stripe (payments), Anthropic (the facts of each video are sent to Claude to suggest a title; no personal data is included), and YouTube and TikTok when you connect them.</p>

      <h2>Deleting it</h2>
      <p>Settings, Delete account removes your account and everything above at once, cancels your plan, and deletes your rendered videos. Videos already posted stay on YouTube and TikTok, where you can delete them yourself. Disconnecting an account in Settings deletes its tokens straight away.</p>
    </LegalPage>
  );
}
