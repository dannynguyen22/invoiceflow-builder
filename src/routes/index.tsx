import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, FileCode2, FileText, Image as ImageIcon, ShieldCheck } from "lucide-react";
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
      <section className="bg-ledger border-b">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 lg:grid-cols-[1.2fr_1fr] lg:py-28">
          <div>
            <p className="mb-4 text-sm font-medium uppercase tracking-widest text-primary">{t("landing.eyebrow")}</p>
            <h1 className="text-4xl font-semibold leading-tight text-foreground md:text-6xl">{t("landing.headline")}</h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">{t("landing.subhead")}</p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Button asChild size="lg">
                <Link to="/workspace">
                  {t("landing.ctaPrimary")} <ArrowRight aria-hidden />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="#how">{t("landing.ctaSecondary")}</a>
              </Button>
              <span className="text-sm text-muted-foreground">{t("landing.noSignIn")}</span>
            </div>
          </div>
          <SheetIllustration />
        </div>
      </section>

      <section id="how" className="mx-auto max-w-7xl px-4 py-16">
        <h2 className="text-3xl font-semibold">{t("landing.stepsTitle")}</h2>
        <ol className="mt-8 grid gap-px overflow-hidden rounded-lg border bg-grid-line md:grid-cols-4">
          {steps.map((s) => (
            <li key={s} className="bg-paper p-6">
              <span className="tabular text-sm text-primary">0{s}</span>
              <h3 className="mt-2 text-xl font-semibold">{t(`landing.step${s}Title`)}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{t(`landing.step${s}Body`)}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-16 md:grid-cols-2">
        <div className="rounded-lg border bg-paper p-6">
          <h2 className="text-2xl font-semibold">{t("landing.formatsTitle")}</h2>
          <p className="mt-2 text-muted-foreground">{t("landing.formatsBody")}</p>
          <div className="mt-4 flex gap-4 text-primary">
            <FileText aria-hidden /> <FileCode2 aria-hidden /> <ImageIcon aria-hidden />
          </div>
        </div>
        <div className="rounded-lg border bg-paper p-6">
          <h2 className="flex items-center gap-2 text-2xl font-semibold">
            <ShieldCheck className="text-primary" aria-hidden /> {t("landing.privacyTitle")}
          </h2>
          <p className="mt-2 text-muted-foreground">{t("landing.privacyBody")}</p>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 pb-24">
        <h2 className="text-3xl font-semibold">{t("landing.faqTitle")}</h2>
        <Accordion type="single" collapsible className="mt-6">
          {faqs.map((f) => (
            <AccordionItem key={f} value={`faq-${f}`}>
              <AccordionTrigger className="text-left">{t(`landing.faq${f}Q`)}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
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
    <div aria-hidden className="shadow-sheet self-center overflow-hidden rounded-lg border bg-paper">
      <div className="grid grid-cols-3 border-b bg-secondary text-xs font-medium text-secondary-foreground">
        {cols.map((c) => (
          <div key={c} className="border-r px-3 py-2 last:border-r-0">{t(`fields.${c}`)}</div>
        ))}
      </div>
      {rows.map((r, i) => (
        <div key={i} className="grid grid-cols-3 border-b text-sm last:border-b-0">
          {r.map((v, j) => (
            <div key={j} className={`tabular border-r px-3 py-2.5 last:border-r-0 ${v === "" ? "bg-review/40" : ""}`}>
              {v || "—"}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
