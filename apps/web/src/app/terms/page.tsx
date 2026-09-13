import type { Metadata } from "next";
import Link from "next/link";
import {
  LegalDocument,
  LegalMailto,
  LegalOperatorAddress,
  LegalOperatorLead,
  LegalSection,
} from "../legal-document";
import { LEGAL_PATHS, TERMS_SECTIONS } from "@/lib/legal";

export const metadata: Metadata = {
  title: "Terms of Service | Annotated",
  description:
    "The rules and responsibilities governing use of the Annotated public web app and Chrome extension.",
};

export default function TermsOfServicePage() {
  return (
    <LegalDocument
      eyebrow="TERMS"
      title="Terms of Service"
      lede="These Terms are the agreement between you and the operator of Annotated. They explain what the service does, what you may and may not do with it, and how responsibility is allocated between us."
      returnTo={LEGAL_PATHS.terms}
      sections={TERMS_SECTIONS}
    >
      <LegalSection id="agreement" number="01" title="Agreement to the terms">
        <p>
          By creating an account or using Annotated — including the public web
          application and the Chrome side-panel extension — you agree to these
          Terms. If you do not agree, do not use the service.
        </p>
        <p>
          If you use Annotated on behalf of an organization, you represent that
          you are authorized to bind that organization to these Terms.
        </p>
      </LegalSection>

      <LegalSection id="description" number="02" title="Description and scope of the service">
        <p>
          Annotated lets you create attributed annotations of selected article
          passages or selected audio or video ranges, and add your own
          commentary. The service consists of a public web application and a
          Chrome side-panel extension, and it includes social features such as
          public profiles, comments, follows, and votes.
        </p>
        <p>
          Annotated is currently offered worldwide as a free beta. There are no
          purchases, paid subscriptions, payment processing, refunds, or
          recurring charges at this time.
        </p>
      </LegalSection>

      <LegalSection id="beta" number="03" title="Beta status and service changes">
        <p>
          Annotated is a beta. Features may change, be added, be limited, or be
          removed, and the service may be interrupted or discontinued. Beta
          software can contain defects, and processing may fail or produce
          imperfect results.
        </p>
        <p>
          We will use reasonable efforts to give notice of significant changes
          where practical, but we do not guarantee continued availability of any
          feature or of the service as a whole.
        </p>
      </LegalSection>

      <LegalSection id="eligibility" number="04" title="Eligibility and age requirement">
        <p>
          You must be at least 18 years old to use Annotated. By using the
          service you represent that you are 18 or older and that you are not
          barred from using it under applicable law.
        </p>
      </LegalSection>

      <LegalSection id="accounts" number="05" title="Accounts and account security">
        <p>
          Accounts are created through an identity provider. Authentication
          currently uses Google. X authentication is currently disabled and
          unconfigured, and is not available. Additional identity providers may
          be offered later, with appropriate notice.
        </p>
        <p>
          You are responsible for activity that occurs under your account and for
          maintaining the security of the identity-provider account you use to
          sign in. Do not share access to your account. Notify us at{" "}
          <LegalMailto /> if you believe your account has been compromised.
        </p>
      </LegalSection>

      <LegalSection id="user-content" number="06" title="User content">
        <p>
          &quot;User content&quot; means anything you submit: annotations,
          selected article text, source URLs, source titles, publisher
          information, selected media ranges, written commentary, optional
          recorded audio commentary, comments, profile information, and messages
          you send us.
        </p>
        <p>
          You retain ownership of the content you create. We do not claim
          ownership of your user content.
        </p>
        <p>
          You are responsible for your content, including having the necessary
          rights and permissions to submit it, and for its accuracy and
          lawfulness.
        </p>
      </LegalSection>

      <LegalSection id="license" number="07" title="License granted to Annotated">
        <p>
          You grant Annotated and its operator a nonexclusive, worldwide,
          royalty-free license to host, store, reproduce, process, transcode,
          transcribe, display, distribute, and moderate the content you submit,
          only as reasonably necessary to operate, secure, improve, and present
          the service and your submitted public annotation.
        </p>
        <p>
          This license may be sublicensed only to service providers that help
          operate the service, and may be transferred only together with the
          service or business.
        </p>
        <p>The license generally ends when you delete your content, except with respect to:</p>
        <ul>
          <li>content already shared or copied by others;</li>
          <li>retention required by law;</li>
          <li>security and abuse-prevention records;</li>
          <li>dispute preservation; and</li>
          <li>routine backup overwrite.</li>
        </ul>
        <p>Annotated does not use user content to train models.</p>
      </LegalSection>

      <LegalSection id="public-content" number="08" title="Public content and attribution">
        <p>
          Annotated is a public annotation service. Public profiles, published
          annotations, attributed excerpts, source links, commentary, comments,
          and aggregate social information may be publicly visible. Public
          content may be indexed, copied, quoted, linked, or reshared by third
          parties beyond our control.
        </p>
        <p>
          Annotated preserves source attribution and original-source links. Do
          not remove, falsify, or misrepresent attribution, and do not present
          another person&apos;s work as your own.
        </p>
      </LegalSection>

      <LegalSection id="source-materials" number="09" title="Source materials and media excerpts">
        <p>
          Annotations reference material that belongs to others. You are
          responsible for ensuring that your selection, excerpt, and commentary
          are lawful and permitted.
        </p>
        <ul>
          <li>Selected hosted media ranges are between 1 and 90 seconds.</li>
          <li>Only the excerpt you selected is used as media-processing and transcription input.</li>
          <li>Raw captured source media is private, is not offered as a download, and must be deleted before an annotation is successfully published.</li>
          <li>A hosted-media annotation remains a private draft until processing is complete, the excerpt transcript is ready, and raw-media deletion is confirmed.</li>
          <li>Annotated does not provide a source-media download feature.</li>
        </ul>
        <p>
          Annotated does not authorize DRM circumvention, paywall bypass,
          access-control bypass, or copyright infringement, and excerpt features
          may not be used as a substitute for obtaining source media.
        </p>
      </LegalSection>

      <LegalSection id="acceptable-use" number="10" title="Acceptable use">
        <p>You may not use Annotated for or in connection with:</p>
        <ul>
          <li>illegal or infringing activity;</li>
          <li>content you lack permission to submit;</li>
          <li>harassment, threats, stalking, or hateful abuse;</li>
          <li>sexual exploitation or sexual content involving minors;</li>
          <li>violations of privacy, publicity, confidentiality, or data-protection rights;</li>
          <li>impersonation, fraud, or materially deceptive conduct;</li>
          <li>malware, harmful code, spam, or phishing;</li>
          <li>unauthorized access to the service or interference with another user&apos;s account;</li>
          <li>disruption of the service;</li>
          <li>burdensome automated scraping or requests;</li>
          <li>circumvention of security or technical restrictions;</li>
          <li>DRM, paywall, or access-control circumvention;</li>
          <li>reverse engineering, where that restriction is permitted by law; or</li>
          <li>misuse of excerpts as unauthorized source downloads.</li>
        </ul>
      </LegalSection>

      <LegalSection id="copyright" number="11" title="Copyright complaints">
        <p>
          We respect the rights of copyright owners. If you believe material on
          Annotated infringes your copyright, send a written complaint to{" "}
          <LegalMailto /> or to the postal address in section 23, including:
        </p>
        <ul>
          <li>identification of the copyrighted work;</li>
          <li>identification and location of the allegedly infringing material;</li>
          <li>your name and contact information;</li>
          <li>a good-faith statement that the use is not authorized;</li>
          <li>a statement that the information you submitted is accurate and that you are authorized to act on behalf of the rights owner; and</li>
          <li>your physical or electronic signature.</li>
        </ul>
        <p>
          We may remove or restrict material while we review a complaint, and we
          may contact the submitting user when appropriate. Please do not submit
          complaints in bad faith.
        </p>
      </LegalSection>

      <LegalSection id="moderation" number="12" title="Moderation and enforcement">
        <p>
          The operator may preserve, restrict, hide, remove, or disclose content
          when reasonably necessary to:
        </p>
        <ul>
          <li>comply with law;</li>
          <li>protect rights and safety;</li>
          <li>investigate abuse;</li>
          <li>address copyright or privacy complaints;</li>
          <li>maintain security; and</li>
          <li>protect service integrity.</li>
        </ul>
        <p>
          If you believe a moderation decision was a mistake, email <LegalMailto />{" "}
          and we will review it.
        </p>
      </LegalSection>

      <LegalSection id="termination" number="13" title="Suspension and termination">
        <p>
          You may stop using Annotated and request account deletion at any time
          by emailing <LegalMailto />. We may suspend or terminate access, with
          or without notice, if you materially violate these Terms, if required
          by law, or if necessary to protect users, third parties, or the
          service.
        </p>
        <p>
          Sections that by their nature should survive termination — including
          user content license limitations, disclaimers, limitation of liability,
          indemnification, and governing law — survive.
        </p>
      </LegalSection>

      <LegalSection id="third-parties" number="14" title="Third-party services and source websites">
        <p>
          Annotated works alongside source websites, media platforms, browser
          software, and identity providers that we do not control. Their
          content, availability, and terms are their own, and your use of them
          is governed by their agreements. A link or excerpt is not an
          endorsement.
        </p>
      </LegalSection>

      <LegalSection id="privacy" number="15" title="Privacy">
        <p>
          Our{" "}
          <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link>
          {" "}explains what information we collect and how we use it, and it
          forms part of your agreement with us.
        </p>
      </LegalSection>

      <LegalSection id="feedback" number="16" title="Feedback">
        <p>
          If you send suggestions, ideas, or feedback about Annotated, we may
          use them without restriction or obligation to you. Please do not send
          confidential information as feedback.
        </p>
      </LegalSection>

      <LegalSection id="disclaimers" number="17" title="Disclaimers">
        <p>
          The service is provided &quot;as is&quot; and &quot;as available.&quot;
          It is a beta and may change, fail, or be discontinued. We do not
          guarantee continuous, secure, or error-free availability, and we do
          not guarantee that processing or transcription will be accurate or
          complete.
        </p>
        <p>
          Annotated does not endorse or verify every user statement or source.
          Source websites and third-party content remain controlled by their
          owners. Annotated does not make a legal determination that your
          excerpt is fair use, licensed, or otherwise lawful; you are
          responsible for your content, permissions, accuracy, and use.
        </p>
        <p>
          To the maximum extent permitted by law, we disclaim implied warranties
          of merchantability, fitness for a particular purpose, and
          non-infringement. Nothing in these Terms limits warranties or rights
          that cannot legally be disclaimed, and some jurisdictions do not allow
          certain disclaimers, so parts of this section may not apply to you.
        </p>
      </LegalSection>

      <LegalSection id="liability" number="18" title="Limitation of liability">
        <p>
          To the maximum extent permitted by law, Annotated and its operator
          will not be liable for indirect, incidental, special, consequential,
          exemplary, or punitive damages, or for lost profits, lost data, or
          loss of goodwill, arising out of or relating to the service.
        </p>
        <p>
          To the maximum extent permitted by law, total liability for all claims
          relating to the service is limited to the greater of (a) US $100 or
          (b) the amount you paid for the service during the 12 months preceding
          the event giving rise to the claim. The service is currently free, so
          that amount is generally zero.
        </p>
        <p>
          These limits do not apply to liability that cannot legally be excluded
          or limited, do not waive non-waivable consumer rights, and do not
          remove mandatory remedies available to you under applicable local law.
        </p>
      </LegalSection>

      <LegalSection id="indemnification" number="19" title="Indemnification">
        <p>
          To the extent permitted by law, you agree to indemnify and hold
          harmless Annotated and its operator from third-party claims, damages,
          and reasonable costs arising out of:
        </p>
        <ul>
          <li>content you submit;</li>
          <li>your violation of another person&apos;s rights;</li>
          <li>your unlawful conduct; or</li>
          <li>your material violation of these Terms.</li>
        </ul>
        <p>
          This obligation does not apply to the extent a claim results from our
          own conduct, and it does not limit mandatory consumer protections
          available to you.
        </p>
      </LegalSection>

      <LegalSection id="governing-law" number="20" title="Governing law and venue">
        <p>
          These Terms are governed by the laws of the State of South Carolina,
          excluding its conflict-of-law rules. The state and federal courts
          serving York County, South Carolina have exclusive jurisdiction and
          venue over disputes relating to these Terms or the service, and you
          and we consent to that jurisdiction.
        </p>
        <p>
          If mandatory consumer law in your place of residence gives you the
          right to a different governing law, forum, or remedy, that right
          applies and this section does not take it away. These Terms contain no
          arbitration clause and no class-action waiver.
        </p>
      </LegalSection>

      <LegalSection id="changes" number="21" title="Changes to the terms">
        <p>
          We may update these Terms as the service evolves. When we do, we will
          change the &quot;Last updated&quot; date above and provide additional
          notice where required or appropriate. Continued use of Annotated after
          an update means the updated Terms apply to you. If you do not agree,
          stop using the service and request account deletion.
        </p>
      </LegalSection>

      <LegalSection id="general" number="22" title="General provisions">
        <ul>
          <li>
            <strong>Entire agreement.</strong> These Terms and the{" "}
            <Link href={LEGAL_PATHS.privacy}>Privacy Policy</Link> are the
            entire agreement between you and us regarding the service.
          </li>
          <li>
            <strong>Severability.</strong> If a provision is unenforceable, the
            rest remains in effect and the provision is limited to the minimum
            extent necessary.
          </li>
          <li>
            <strong>No waiver.</strong> Not enforcing a provision is not a
            waiver of it.
          </li>
          <li>
            <strong>Assignment.</strong> You may not assign these Terms without
            our consent. We may assign them together with the service or
            business.
          </li>
          <li>
            <strong>No third-party beneficiaries.</strong> These Terms do not
            create rights for anyone other than you and us.
          </li>
          <li>
            <strong>Force majeure.</strong> Neither party is responsible for
            delays or failures caused by events beyond its reasonable control.
          </li>
          <li>
            <strong>Notices.</strong> We may send notices to the email address
            associated with your account or post them within the service. Send
            notices to us at <LegalMailto /> or the postal address below.
          </li>
        </ul>
      </LegalSection>

      <LegalSection id="contact" number="23" title="Contact information">
        <p><LegalOperatorLead /></p>
        <LegalOperatorAddress />
      </LegalSection>
    </LegalDocument>
  );
}
