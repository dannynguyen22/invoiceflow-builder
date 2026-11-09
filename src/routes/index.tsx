import { createFileRoute, Link } from "@tanstack/react-router";
import { UploadCloud, FileCode2, FileText, Image as ImageIcon, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { useI18n, translate } from "@/i18n";
import { LIMITS } from "@/config/limits";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: translate("vi", "meta.homeTitle") },
      { name: "description", content: translate("vi", "meta.homeDescription") },
      { property: "og:title", content: translate("vi", "meta.homeTitle") },
      { property: "og:description", content: translate("vi", "meta.homeDescription") },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Landing,
});

function Landing() {
  const { t } = useI18n();
  const steps = [1, 2, 3, 4];
  const faqs = [1, 2, 3, 4];
  return (
    <>
      <section className="border-b bg-paper">
        <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 lg:grid-cols-[1.1fr_1fr] lg:py-16">
          <div>
            <p className="mb-3 inline-flex rounded-full bg-accent px-2.5 py-0.5 text-xs font-medium text-accent-foreground">{t("landing.eyebrow")}</p>
            <h1 className="text-[30px] font-semibold leading-tight text-foreground md:text-[44px]">{t("landing.headline")}</h1>
            <p className="mt-4 max-w-xl text-base text-muted-foreground">{t("landing.subhead")}</p>
            <div className="mt-6 flex flex-wrap items-center gap-2">
              <Button asChild size="lg">
                <Link to="/workspace">
                  <UploadCloud aria-hidden /> {t("landing.ctaPrimary")}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how">{t("landing.ctaSecondary")}</a>
              </Button>
            </div>
            <p className="mt-3 text-xs text-muted-foreground">{t("landing.noSignIn")}</p>
          </div>
          <SheetIllustration />
        </div>
      </section>

      <section id="how" className="mx-auto max-w-7xl px-4 py-12">
        <h2 className="text-xl font-semibold">{t("landing.stepsTitle")}</h2>
        <ol className="mt-5 grid gap-3 md:grid-cols-4">
          {steps.map((s) => (
            <li key={s} className="rounded-lg border bg-paper p-5">
              <span className="tabular flex size-6 items-center justify-center rounded-md bg-accent text-xs font-semibold text-accent-foreground">{s}</span>
              <h3 className="mt-3 text-sm font-semibold">{t(`landing.step${s}Title`)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t(`landing.step${s}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-12 md:grid-cols-2">
        <div className="rounded-lg border bg-paper p-5">
          <h2 className="text-base font-semibold">{t("landing.formatsTitle")}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("landing.formatsBody")}</p>
          <div className="mt-4 flex gap-3 text-muted-foreground [&_svg]:size-5">
            <FileText aria-hidden /> <FileCode2 aria-hidden /> <ImageIcon aria-hidden />
          </div>
        </div>
        <div className="rounded-lg border bg-paper p-5">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <ShieldCheck className="size-4 text-primary" aria-hidden /> {t("landing.privacyTitle")}
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("landing.privacyBody")}</p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-24">
        <h2 className="text-xl font-semibold">{t("landing.faqTitle")}</h2>
        <Accordion type="single" collapsible className="mt-4 rounded-lg border bg-paper px-4">
          {faqs.map((f) => (
            <AccordionItem key={f} value={`faq-${f}`}>
              <AccordionTrigger className="text-left text-sm">{t(`landing.faq${f}Q`)}</AccordionTrigger>
              <AccordionContent className="text-sm text-muted-foreground">
                {t(`landing.faq${f}A`, { count: LIMITS.maxFilesPerBatch })}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </section>
    </>
  );
}

function SheetIllustration() {
  const { t } = useI18n();
  const cols = ["invoice_number", "seller_tax_id", "total_amount"];
  const rows = [
    ["0001234", "0101234567", "10.800.000"],
    ["000987", "0101234567", "2.750.000"],
    ["0000055", "", "1.650.000"],
  ];
  return (
    <div aria-hidden className="self-center overflow-hidden rounded-lg border bg-paper">
      <div className="grid grid-cols-3 border-b bg-secondary text-xs font-medium text-muted-foreground">
        {cols.map((c) => (
          <div key={c} className="border-r px-3 py-2 last:border-r-0">{t(`fields.${c}`)}</div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-3 border-b text-[13px] last:border-b-0">
          {r.map((v, j) => (
            <div key={j} className={`tabular border-r px-3 py-2 last:border-r-0 ${v === "" ? "bg-review/15 shadow-[inset_2px_0_0_var(--review)]" : ""}`}>
              {v || "—"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
