import Link from "next/link";

import { GradientMesh } from "@/components/brand/GradientMesh";
import { Wordmark } from "@/components/brand/Wordmark";
import { ArrowRight } from "@/components/ui/ArrowRight";
import { EyebrowLabel } from "@/components/ui/EyebrowLabel";
import { PillButton } from "@/components/ui/PillButton";
import { colors } from "@/lib/tokens";

/**
 * Route-level 404 screen — the `/app/not-found.tsx` boundary.
 *
 * Same layout, four variants by content. The tone is calm dead-end (steel
 * grey pill, NOT urgent red) — a 404 is not an emergency for the donor.
 *
 * Designed in `designs-boundary-screens/designs/screen-not-found.jsx`.
 */

export type NotFoundVariant =
  | "unknown_route"
  | "unknown_campaign"
  | "expired_session"
  | "unknown_receipt";

interface VariantContent {
  eyebrow: string;
  subhead: string;
}

const VARIANTS: Record<NotFoundVariant, VariantContent> = {
  unknown_route: {
    eyebrow: "404 · This page doesn’t exist",
    subhead:
      "You probably followed a link to somewhere we don’t have a page. Nothing’s broken on your end. If you completed a donation, the receipt is still public on Base — it doesn’t live behind any URL we control.",
  },
  unknown_campaign: {
    eyebrow: "404 · Campaign not found",
    subhead:
      "That campaign either doesn’t exist or has ended. The funds raised through it are still on-chain and verifiable — every donation’s receipt URL keeps working forever, independent of the campaign page.",
  },
  expired_session: {
    eyebrow: "404 · Processing session expired",
    subhead:
      "Processing sessions clear from our cache after a few hours. If your donation actually completed, the receipt was published to Base and is permanently findable by transaction hash. Use “find a receipt” below.",
  },
  unknown_receipt: {
    eyebrow: "404 · Receipt not found",
    subhead:
      "We couldn’t find a donation at that transaction hash on Base. Either the URL has a typo, or the hash belongs to a different contract — only transfers through TransparentDonationRouter resolve to a Philotimo receipt.",
  },
};

interface ExitCard {
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly cta: string;
  readonly variant: "primary" | "ghost";
  readonly href: string;
}

const EXIT_CARDS: readonly ExitCard[] = [
  {
    eyebrow: "Most people want",
    title: "Start a new donation",
    body: "Browse the curated set of verified 501(c)(3) campaigns. Card or Apple Pay; the on-chain side runs itself.",
    cta: "Choose a charity",
    variant: "primary",
    href: "/",
  },
  {
    eyebrow: "I had one in flight",
    title: "Find an existing receipt",
    body: "Look up a published receipt by transaction hash or by the email we sent it to. Receipts on Base live forever — nothing of yours has been deleted.",
    cta: "Recover a receipt",
    variant: "ghost",
    // Recovery flow is a later epic. Mailto placeholder until then.
    href: "mailto:hello@philotimo.app?subject=Recover%20a%20receipt",
  },
  {
    eyebrow: "I’m just curious",
    title: "How Philotimo works",
    body: "The 5-stage route from your card to a verified charity’s fund — every hop public, every fee on-chain, no custody in the middle.",
    cta: "Read how it works",
    variant: "ghost",
    href: "/#how-it-works",
  },
];

interface NotFoundScreenProps {
  variant?: NotFoundVariant;
}

export function NotFoundScreen({
  variant = "unknown_route",
}: NotFoundScreenProps) {
  const content = VARIANTS[variant];

  return (
    <div
      style={{
        background: colors.canvas,
        color: colors.ink,
        fontFamily:
          '"Inter", "SF Pro Display", -apple-system, system-ui, sans-serif',
        fontWeight: 300,
        fontFeatureSettings: '"ss01"',
        minHeight: "100%",
      }}
    >
      <NotFoundHero content={content} />
      <NotFoundExits />
      <NotFoundBrokenLinkCard />
      <NotFoundFooter />
    </div>
  );
}

function NotFoundHero({ content }: { content: VariantContent }) {
  return (
    <div
      style={{ position: "relative", overflow: "hidden", paddingBottom: 40 }}
    >
      <GradientMesh height={420} opacity={0.6} />

      {/* Top nav — wordmark + a calm "Page not found" pill (steel, NOT urgent). */}
      <div
        style={{
          position: "absolute",
          top: 28,
          left: 0,
          right: 0,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "0 24px",
          maxWidth: 880,
          margin: "0 auto",
          zIndex: 2,
        }}
      >
        <Wordmark size={15} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "5px 11px",
            background: "rgba(255,255,255,0.7)",
            border: `1px solid ${colors.hairline}`,
            backdropFilter: "blur(6px)",
            borderRadius: 9999,
            fontSize: 11,
            color: colors.inkMute,
            letterSpacing: "-0.1px",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 9999,
              background: colors.steel,
            }}
          />
          Page not found
        </span>
      </div>

      <div
        style={{
          position: "relative",
          zIndex: 1,
          maxWidth: 880,
          margin: "0 auto",
          padding: "128px 24px 8px",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            padding: "6px 12px",
            background: colors.canvas,
            border: `1px solid ${colors.hairline}`,
            borderRadius: 9999,
            marginBottom: 28,
          }}
        >
          <EyebrowLabel>{content.eyebrow}</EyebrowLabel>
        </div>

        <h1
          style={{
            margin: 0,
            fontSize: 48,
            fontWeight: 300,
            letterSpacing: "-0.96px",
            lineHeight: 1.05,
            color: colors.ink,
            textWrap: "pretty",
            maxWidth: 720,
          }}
        >
          That link doesn&rsquo;t lead{" "}
          <span
            style={{
              backgroundImage:
                "linear-gradient(transparent 68%, rgba(83,58,253,0.18) 68%, rgba(83,58,253,0.18) 92%, transparent 92%)",
            }}
          >
            anywhere
          </span>
          .
        </h1>

        <p
          style={{
            margin: "22px 0 0",
            fontSize: 17,
            fontWeight: 300,
            color: colors.inkDeep,
            letterSpacing: "-0.1px",
            lineHeight: 1.5,
            maxWidth: 680,
          }}
        >
          {content.subhead}
        </p>
      </div>
    </div>
  );
}

function NotFoundExits() {
  return (
    <section
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "32px 24px 8px",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3, 1fr)",
          gap: 14,
        }}
      >
        {EXIT_CARDS.map((exit) => (
          <NotFoundExitCard key={exit.title} exit={exit} />
        ))}
      </div>
    </section>
  );
}

function NotFoundExitCard({ exit }: { exit: ExitCard }) {
  const isPrimary = exit.variant === "primary";
  return (
    <a
      href={exit.href}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: "24px 22px 22px",
        background: colors.canvas,
        border: `1px solid ${isPrimary ? colors.primary : colors.hairline}`,
        borderRadius: 12,
        textDecoration: "none",
        color: "inherit",
        boxShadow: isPrimary
          ? "0 8px 24px rgba(0,55,112,0.08)"
          : "0 1px 3px rgba(0,55,112,0.06)",
        transition: "all .15s ease",
        minHeight: 220,
        justifyContent: "space-between",
      }}
    >
      <div>
        <EyebrowLabel color={isPrimary ? colors.irisPress : colors.inkMute}>
          {exit.eyebrow}
        </EyebrowLabel>
        <h3
          style={{
            margin: "10px 0 8px",
            fontSize: 20,
            fontWeight: 300,
            letterSpacing: "-0.2px",
            color: colors.ink,
          }}
        >
          {exit.title}
        </h3>
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: colors.inkDeep,
            letterSpacing: "-0.1px",
            lineHeight: 1.5,
          }}
        >
          {exit.body}
        </p>
      </div>
      <div style={{ display: "inline-flex" }}>
        {/* The card itself is the link — render the pill as a non-interactive
            `<span>` so we don't nest a `<button>` inside the anchor (invalid
            HTML5, double tab stop, screen-reader double-affordance). */}
        <PillButton
          variant={isPrimary ? "primary" : "ghost"}
          size="sm"
          icon={<ArrowRight color={isPrimary ? "#fff" : colors.ink} />}
          presentation
        >
          {exit.cta}
        </PillButton>
      </div>
    </a>
  );
}

function NotFoundBrokenLinkCard() {
  return (
    <section
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "20px 24px 56px",
      }}
    >
      <div
        style={{
          background: colors.cream,
          borderRadius: 12,
          padding: "20px 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ maxWidth: 540 }}>
          <EyebrowLabel color={colors.inkDeep}>
            Was this our fault?
          </EyebrowLabel>
          <h4
            style={{
              margin: "6px 0 4px",
              fontSize: 16,
              fontWeight: 300,
              letterSpacing: "-0.15px",
              color: colors.ink,
            }}
          >
            Report a broken link.
          </h4>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: colors.inkDeep,
              letterSpacing: "-0.1px",
              lineHeight: 1.45,
            }}
          >
            Tell us where you came from &mdash; it&rsquo;s the quickest way for
            us to fix campaign URLs that got published with a typo. No form,
            just a one-line email.
          </p>
        </div>
        <PillButton
          href="mailto:hello@philotimo.app?subject=Broken%20link"
          variant="dark"
          size="md"
        >
          hello@philotimo.app
        </PillButton>
      </div>
    </section>
  );
}

function NotFoundFooter() {
  return (
    <footer
      style={{
        maxWidth: 880,
        margin: "0 auto",
        padding: "16px 24px 40px",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          color: colors.inkMute,
          fontSize: 12,
          letterSpacing: "-0.1px",
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <Wordmark size={12} color={colors.inkMute} />
        <div style={{ display: "flex", gap: 18 }}>
          <Link
            href="/#how-it-works"
            style={{ color: colors.primary, textDecoration: "none" }}
          >
            What is Philotimo?
          </Link>
          <a
            href="mailto:hello@philotimo.app"
            style={{ color: colors.inkMute, textDecoration: "none" }}
          >
            Contact
          </a>
        </div>
      </div>
    </footer>
  );
}
