import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalDocument,
  LegalMailto,
  LegalOperatorAddress,
  LegalOperatorLead,
  LegalSection,
} from "../legal-document";
import { LEGAL_PATHS, PRIVACY_SECTIONS } from "@/lib/legal";
import {
  getPublicPageStructuredData,
  PRIVACY_HEADING,
  PRIVACY_LEDE,
} from "@/lib/discoverability";

export const metadata: Metadata = {
  title: "Privacy Policy | Annotated",
  description:
    "How Annotated collects, uses, stores, shares, and protects information for the public web app and Chrome extension.",
  alternates: { canonical: LEGAL_PATHS.privacy },
};

export default function PrivacyPolicyPage() {
  return (
    <LegalDocument
      eyebrow="PRIVACY"
      title={PRIVACY_HEADING}
      lede={PRIVACY_LEDE}
      returnTo={LEGAL_PATHS.privacy}
      sections={PRIVACY_SECTIONS}
      structuredData={getPublicPageStructuredData(LEGAL_PATHS.privacy)}
    >
      <LegalSection id="scope" number="01" title="Scope">
        <p>
          This Privacy Policy applies to the Annotated public web application,
          including these legal pages, and the Annotated Chrome side-panel
          extension. Annotated is currently offered worldwide as a free beta.
        </p>
        <p>
          It does not apply to the websites, publishers, media platforms, or
          identity providers you interact with outside Annotated. Those services
          are governed by their own privacy policies.
        </p>
      </LegalSection>

      <LegalSection id="who-operates-annotated" number="02" title="Who operates Annotated">
        <p><LegalOperatorLead /></p>
        <p>
          For questions about this policy, or to make a privacy request, email{" "}
          <LegalMailto />.
        </p>
      </LegalSection>

      <LegalSection id="information-we-collect" number="03" title="Information we collect">
        <h3>Account and identity information</h3>
        <p>
          When you create an account, we receive information from your identity
          provider. Authentication currently uses Google. Account information may
          include an identity-provider identifier, email address, name, username
          or public handle, and a profile image supplied by you or by the
          provider.
        </p>
        <p>
          X authentication is currently disabled and unconfigured, and is not
          available. See the conditional disclosure in this section below.
        </p>

        <h3>Profile information</h3>
        <p>
          Your profile may include your display name, username or public handle,
          avatar or profile image, and identity details supplied by your sign-in
          provider. Profile information is generally public.
        </p>

        <h3>Annotation and source information</h3>
        <p>
          When you create an annotation, we collect the content you submit and
          the context needed to attribute it. This may include selected article
          text, source URLs, source titles, publishers, selected media ranges,
          and your written commentary.
        </p>

        <h3>Hosted-media information</h3>
        <p>
          If you annotate audio or video, we process the range you selected.
          Selected hosted media ranges are between 1 and 90 seconds. Only the
          user-selected excerpt is used as media-processing and transcription
          input.
        </p>
        <p>
          Raw captured source media is private, is not offered as a download, and
          must be deleted before an annotation is successfully published. A
          hosted-media annotation remains a private draft until the playable
          excerpt is ready and raw-media deletion is confirmed. The excerpt
          transcript is added when it is ready.
        </p>

        <h3>Optional recorded audio commentary</h3>
        <p>
          You may optionally record spoken commentary to accompany an annotation.
          Recording is initiated by you. If you record commentary, the recording
          and any resulting processed output are handled as part of your
          annotation content.
        </p>

        <h3>Comments, follows, and votes</h3>
        <p>
          We collect the comments you post, the accounts you follow, and the
          votes you cast. Comments and aggregate social information may be
          publicly visible. Your individual follow and voting records are not
          published as such merely because aggregate counts are displayed.
        </p>

        <h3>Communications and support requests</h3>
        <p>
          If you email us, we receive your message, your email address, and any
          information you include, and we keep it as needed to respond and to
          maintain a record of the request.
        </p>

        <h3>Technical, security, and diagnostic information</h3>
        <p>
          Operating the service generates technical information. Our hosting and
          security providers may process an IP address, device and browser
          characteristics, request and error logs, and security or
          abuse-prevention signals. An IP address may inherently indicate a broad
          region, but Annotated does not request precise location and does not
          intentionally collect or infer your location. We use this information
          to keep the service running, secure, and reliable.
        </p>

        <h3>Conditional disclosure regarding X authentication</h3>
        <p>
          X authentication is currently disabled and unconfigured. If X sign-in
          is enabled later, Annotated may receive an X account identifier,
          display name, username, profile image, and confirmed email address when
          X makes those fields available. That information would be used only to
          authenticate you, establish or restore the correct Annotated account,
          prevent fraud, and maintain account security.
        </p>
        <p>
          Annotated does not intend to request access to tweets, direct messages,
          follows, likes, contacts, advertising information, or permission to
          publish to X. Annotated does not use X data for advertising or model
          training. Annotated will update this policy and complete required
          configuration and testing before making X sign-in publicly available.
          These practices are conditional and are not active today.
        </p>
        <p>
          Additional identity providers may be offered later, with appropriate
          notice and policy updates.
        </p>
      </LegalSection>

      <LegalSection id="chrome-extension" number="04" title="Chrome extension and active-page behavior">
        <p>
          The Annotated Chrome extension is designed to access the active page or
          to perform a capture that you initiate. It is not designed to collect
          general browsing history, and it does not continuously read every page
          you visit or monitor unrelated browsing.
        </p>
        <p>Extension capabilities include:</p>
        <ul>
          <li>a side panel for creating and reviewing annotations;</li>
          <li>active-tab access to the page you are annotating;</li>
          <li>local and session storage for drafts, preferences, and session recovery;</li>
          <li>on-demand scripts that run when you act on a page;</li>
          <li>identity, to sign you in;</li>
          <li>tab capture and offscreen recording, used only when you initiate capture of selected source media; and</li>
          <li>recording capabilities, where applicable, when you initiate optional recorded audio commentary.</li>
        </ul>
        <p>
          Annotated does not continuously monitor your browsing activity.
          Information collected through the extension is the information
          described in this policy: what you select, what you write or record,
          and the source context needed for attribution.
        </p>
      </LegalSection>

      <LegalSection id="sources-of-information" number="05" title="Sources of information">
        <p>We receive information from:</p>
        <ul>
          <li>you, when you create an account, annotate, comment, record, or contact us;</li>
          <li>your identity provider, when you sign in;</li>
          <li>the pages and media you choose to annotate, limited to the passage or range you selected and its source context; and</li>
          <li>our own systems and service providers, through technical, security, and diagnostic records generated in the course of operating the service.</li>
        </ul>
      </LegalSection>

      <LegalSection id="how-we-use-information" number="06" title="How we use information">
        <p>We use information to:</p>
        <ul>
          <li>create and maintain your account and authenticate you;</li>
          <li>create, process, store, publish, and display your annotations, excerpts, commentary, and comments;</li>
          <li>process and transcribe the excerpt you selected;</li>
          <li>preserve source attribution and original-source links;</li>
          <li>operate social features such as profiles, comments, follows, and votes;</li>
          <li>respond to your questions, support requests, and privacy requests;</li>
          <li>maintain security, prevent fraud and abuse, moderate content, and enforce our Terms;</li>
          <li>diagnose problems, monitor reliability, and improve the service; and</li>
          <li>comply with legal obligations and protect rights, safety, and service integrity.</li>
        </ul>
      </LegalSection>

      <LegalSection id="legal-bases" number="07" title="Legal bases for processing">
        <p>
          Where a law such as the GDPR or UK GDPR applies to you, we rely on the
          following legal bases:
        </p>
        <ul>
          <li>
            <strong>Contractual necessity</strong> — to create and maintain your
            account and to deliver the service functions you request, including
            publishing your annotations.
          </li>
          <li>
            <strong>Legitimate interests</strong> — to operate, secure, and
            improve the service, prevent fraud and abuse, moderate content, and
            provide support, balanced against your rights and expectations.
          </li>
          <li>
            <strong>Consent</strong> — where an optional feature or your
            jurisdiction requires it. You may withdraw consent at any time;
            withdrawal does not affect processing already carried out.
          </li>
          <li>
            <strong>Compliance with legal obligations</strong> — where we are
            required to retain or disclose information.
          </li>
          <li>
            <strong>Protection of rights, safety, and service integrity</strong>
            {" "}— including vital interests where applicable.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="public-information" number="08" title="Public information">
        <p>
          Annotated is a public annotation service. Public profiles, published
          annotations, attributed excerpts, source links, commentary, comments,
          and aggregate social information may be publicly visible.
        </p>
        <p>
          Public content may be indexed, copied, quoted, linked, or reshared by
          third parties beyond Annotated&apos;s control. Deleting content from
          Annotated does not delete copies that others have already made.
        </p>
        <p>
          Individual follow and voting records are not published merely because
          aggregate counts are displayed. Please consider carefully what you
          include in public content.
        </p>
      </LegalSection>

      <LegalSection id="ai-assisted-processing" number="09" title="AI-assisted excerpt processing">
        <p>
          Annotated uses AI only to process or transcribe the excerpt you
          selected. Only the user-selected excerpt is used as media-processing
          and transcription input.
        </p>
        <p>Annotated does not use user content to train models.</p>
        <p>
          A processed excerpt and an excerpt-only transcript may remain with the
          annotation until deletion, removal, or the end of the applicable
          retention purpose.
        </p>
      </LegalSection>

      <LegalSection id="service-providers" number="10" title="Service providers and disclosures">
        <p>
          We use a small number of service providers to run Annotated. They
          process information only for the relevant service functions described
          below, and they are governed by their own contractual and privacy
          terms.
        </p>
        <ul>
          <li>Supabase — authentication, database services, and storage.</li>
          <li>Google — authentication and cloud-processing infrastructure.</li>
          <li>OpenAI — transcription of selected excerpts.</li>
          <li>Vercel — hosting for the Annotated web application, including these legal pages.</li>
          <li>Other narrowly scoped hosting, security, monitoring, and communications providers that may be added as the service evolves.</li>
        </ul>
        <p>
          We do not claim that every provider holds a specific certification or
          offers a specific contractual provision. We may also disclose
          information when reasonably necessary to comply with law or valid legal
          process, to enforce our Terms, to investigate abuse or security
          incidents, or in connection with a merger, acquisition, or transfer of
          the service or business, in which case this policy continues to apply
          to the transferred information until it is updated.
        </p>
      </LegalSection>

      <LegalSection id="no-sale" number="11" title="No sale, targeted advertising, or unauthorized marketing">
        <ul>
          <li>Annotated does not sell personal information.</li>
          <li>Annotated does not share personal information for cross-context behavioral advertising.</li>
          <li>Annotated does not use targeted advertising.</li>
          <li>
            Annotated does not send marketing communications without a separate
            opt-in. We may still send service and security messages related to
            your account.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="cookies" number="12" title="Cookies and browser storage">
        <p>
          Essential cookies, local storage, or session storage may be used for
          authentication, security, drafts, preferences, and session recovery. No
          advertising cookies are intentionally used, and the Annotated web
          application does not intentionally set nonessential cookies.
        </p>
        <p>
          Blocking or clearing this storage may sign you out or discard unsaved
          drafts and preferences.
        </p>
      </LegalSection>

      <LegalSection id="retention" number="13" title="Retention">
        <p>
          We keep information for as long as needed for the purpose it was
          collected, and then delete it or retain it only where a legal,
          security, or dispute-related reason applies.
        </p>
        <ul>
          <li>Account and profile information is retained while your account is active and for a reasonable period afterward.</li>
          <li>Raw media from abandoned or incomplete uploads is generally deleted after 24 hours.</li>
          <li>Processing may retry for no more than 72 hours, followed by no more than 24 additional hours for a deliberate retry, before raw media is deleted.</li>
          <li>Raw captured source media must be deleted before an annotation is successfully published, and it is never offered as a download.</li>
          <li>A processed excerpt and excerpt-only transcript may remain with the annotation until deletion, removal, or the end of the applicable retention purpose.</li>
          <li>Technical, security, and abuse-prevention records are retained for a limited period appropriate to their purpose.</li>
          <li>Backups are overwritten on a routine cycle, so deleted information may persist briefly in backups after removal from the live service.</li>
        </ul>
      </LegalSection>

      <LegalSection id="security" number="14" title="Security">
        <p>
          We use reasonable administrative, technical, and organizational
          safeguards to protect information. Public clients do not contain
          privileged database or service credentials. Provider access tokens,
          signed upload URLs, signed playback URLs, and transient media-delivery
          URLs are not intentionally exposed publicly or logged.
        </p>
        <p>
          No system can guarantee absolute security. If you believe your account
          or content has been compromised, email <LegalMailto />.
        </p>
      </LegalSection>

      <LegalSection id="international-transfers" number="15" title="International data transfers">
        <p>
          Annotated is operated from the United States. Information may be
          processed in the United States and in other locations where our
          service providers operate. Laws in those locations may differ from the
          laws of your home jurisdiction.
        </p>
        <p>
          Where legally required, appropriate safeguards will be used for
          international transfers. We do not claim a specific transfer
          certification or framework.
        </p>
      </LegalSection>

      <LegalSection id="privacy-rights" number="16" title="Privacy rights and requests">
        <p>
          You may email <LegalMailto /> to request, as applicable:
        </p>
        <ul>
          <li>confirmation of processing;</li>
          <li>access to your information;</li>
          <li>correction of inaccurate information;</li>
          <li>a portable export;</li>
          <li>account deletion;</li>
          <li>content deletion;</li>
          <li>restriction of processing;</li>
          <li>objection to processing;</li>
          <li>withdrawal of consent; and</li>
          <li>appeal of a denied privacy request.</li>
        </ul>
        <p>
          Identity verification may be required. We target completion of verified
          deletion requests within 30 days. Authorized agents may submit requests
          where applicable, subject to verification.
        </p>
        <p>Exceptions may apply, including for:</p>
        <ul>
          <li>legal obligations;</li>
          <li>fraud and security records;</li>
          <li>dispute preservation;</li>
          <li>public-content context;</li>
          <li>content already reshared by others; and</li>
          <li>routine backup overwrite.</li>
        </ul>
        <p>
          You may also complain to your applicable local privacy or
          data-protection authority. We have not appointed a Data Protection
          Officer, an EU or UK representative, or a California agent.
        </p>
      </LegalSection>

      <LegalSection id="us-state-disclosures" number="17" title="United States state privacy disclosures">
        <p>
          Several U.S. states give residents privacy rights. This section
          describes our practices for those residents. We do not claim that
          Annotated necessarily meets every state statute&apos;s applicability
          threshold; where a law applies, we honor it.
        </p>
        <p>
          <strong>Categories collected:</strong> identifiers (such as an
          identity-provider identifier, email address, name, and username),
          profile and account information, user content (annotations, selected
          article text, source information, commentary, optional recorded audio
          commentary, comments), social information (follows and votes), audio or
          visual information contained in a selected excerpt or recorded
          commentary, and internet and device activity related to your use of the
          service (including an IP address processed by hosting and security
          providers, which may inherently indicate a broad region).
        </p>
        <p>
          <strong>Purposes:</strong> providing and securing the service,
          authenticating users, processing and publishing annotations,
          transcription of selected excerpts, support, moderation, fraud and
          abuse prevention, service improvement, and legal compliance.
        </p>
        <p>
          <strong>Categories of recipients:</strong> authentication, database,
          and storage providers; cloud-processing infrastructure providers;
          transcription providers; hosting, security, monitoring, and
          communications providers; and, where required, legal or governmental
          recipients. Public content is also disclosed to the public by design.
        </p>
        <p>
          <strong>No sale or targeted advertising:</strong> Annotated does not
          sell personal information, and does not share personal information for
          cross-context behavioral advertising.
        </p>
        <p>
          <strong>Your rights:</strong> depending on your state, you may have
          rights to access or confirm processing, correct inaccuracies, delete
          personal information, obtain a portable copy, opt out of sale, targeted
          advertising, or certain profiling, limit use of sensitive personal
          information, and appeal a denied request. Some rights depend on your
          jurisdiction. We will not discriminate against you for exercising them.
          Submit requests and appeals to <LegalMailto />.
        </p>
      </LegalSection>

      <LegalSection id="eea-uk" number="18" title="EEA, United Kingdom, Switzerland, and similar jurisdictions">
        <p>
          If you are in the EEA, the United Kingdom, Switzerland, or a
          jurisdiction with similar law, you may have rights of access,
          rectification, erasure, restriction, objection, and data portability,
          and the right to withdraw consent where processing is based on consent.
          Our legal bases are described in section 7.
        </p>
        <p>
          To exercise these rights, email <LegalMailto />. You may also lodge a
          complaint with your local supervisory authority. We have not appointed
          an EU or UK representative, and this policy does not claim formal
          certification of compliance with any particular framework.
        </p>
      </LegalSection>

      <LegalSection id="children" number="19" title="Children">
        <p>
          Annotated is for adults. The minimum age is 18. Annotated is not
          directed to children, and we do not knowingly collect information from
          anyone under 18. If we learn that an account belongs to someone under
          18, we will terminate it and delete associated information as
          appropriate. If you believe a minor has created an account, email{" "}
          <LegalMailto />.
        </p>
      </LegalSection>

      <LegalSection id="third-party-sites" number="20" title="Third-party websites and identity providers">
        <p>
          Annotated links to original sources and works alongside the websites
          and media platforms you annotate. Those sites, their publishers, and
          your identity provider are independent of Annotated and are governed by
          their own terms and privacy policies. We do not control their
          practices, and this policy does not apply to them.
        </p>
      </LegalSection>

      <LegalSection id="policy-changes" number="21" title="Changes to this policy">
        <p>
          We may update this policy as the service evolves. When we do, we will
          change the &quot;Last updated&quot; date above. Material changes are
          posted prospectively and take effect going forward, not retroactively,
          and we will provide additional notice where required or appropriate,
          such as before enabling a new identity provider. Where applicable law
          requires consent to a material change, we will request your consent
          before that change applies to you.
        </p>
      </LegalSection>

      <LegalSection id="contact" number="22" title="Contact information">
        <p><LegalOperatorLead /></p>
        <LegalOperatorAddress />
        <p>
          See also the <Link href={LEGAL_PATHS.terms}>Terms of Service</Link>.
        </p>
      </LegalSection>
    </LegalDocument>
  );
}
