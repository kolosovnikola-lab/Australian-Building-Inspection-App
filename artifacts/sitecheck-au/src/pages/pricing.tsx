import { useMemo, useState } from 'react';
import { ArrowRight, Check, ChevronDown, Database, FileCheck2, HardHat, Headphones, Languages, ShieldCheck, Sparkles, Users, X } from 'lucide-react';
import { Link } from 'wouter';

type BillingPeriod = 'monthly' | 'annual';
type FeatureValue = string | boolean;

type Plan = {
  id: 'solo' | 'team' | 'practice';
  name: string;
  kicker: string;
  description: string;
  monthly: { price: number; reports: string; ai: string };
  annual: { total: number; monthlyEquivalent: number; reports: string; ai: string };
  seats: string;
  storage: string;
  accent: string;
  featured?: boolean;
};

const plans: Plan[] = [
  {
    id: 'solo',
    name: 'Solo',
    kicker: 'For the inspector on the tools',
    description: 'A focused workbench for independent inspectors who need every observation accounted for.',
    monthly: { price: 39, reports: '12 reports / month', ai: '40 AI assists / month' },
    annual: { total: 390, monthlyEquivalent: 32.5, reports: '150 reports / year', ai: '500 AI assists / year' },
    seats: '1 inspector',
    storage: '10 GB evidence storage',
    accent: 'teal',
  },
  {
    id: 'team',
    name: 'Team',
    kicker: 'For a growing inspection team',
    description: 'Shared standards, consistent reporting and enough room for a busy local practice.',
    monthly: { price: 109, reports: '45 reports / month', ai: '200 AI assists / month' },
    annual: { total: 1090, monthlyEquivalent: 90.83, reports: '600 reports / year', ai: '2,400 AI assists / year' },
    seats: '5 inspector seats',
    storage: '100 GB evidence storage',
    accent: 'ochre',
    featured: true,
  },
  {
    id: 'practice',
    name: 'Practice',
    kicker: 'For premium operators',
    description: 'A polished operating layer for firms that want higher capacity and white-glove support.',
    monthly: { price: 249, reports: '120 reports / month', ai: '600 AI assists / month' },
    annual: { total: 2490, monthlyEquivalent: 207.5, reports: '1,800 reports / year', ai: '8,000 AI assists / year' },
    seats: '15 inspector seats',
    storage: '500 GB evidence storage',
    accent: 'navy',
  },
];

const comparisonRows: Array<{
  label: string;
  detail?: string;
  icon: typeof FileCheck2;
  values: Record<Plan['id'], FeatureValue>;
}> = [
  { label: 'Inspection reports', detail: 'Allowance follows your billing period', icon: FileCheck2, values: { solo: '12 / month', team: '45 / month', practice: '120 / month' } },
  { label: 'Inspector seats', detail: 'Named seats with workspace access', icon: Users, values: { solo: '1', team: '5', practice: '15' } },
  { label: 'Evidence storage', detail: 'Original photos and report evidence', icon: Database, values: { solo: '10 GB', team: '100 GB', practice: '500 GB' } },
  { label: 'AI assistance', detail: 'Drafting and finding summaries; human review stays in control', icon: Sparkles, values: { solo: '40 / month', team: '200 / month', practice: '600 / month' } },
  { label: 'Client sharing', detail: 'Secure, read-only report links', icon: ShieldCheck, values: { solo: 'Included', team: 'Included', practice: 'Included' } },
  { label: 'Field workflows', detail: 'Capture, scan, standards and offline-ready drafts', icon: HardHat, values: { solo: 'Core workflow', team: 'Team workflow', practice: 'Advanced workflow' } },
  { label: 'Support', detail: 'Help when a report needs to go out', icon: Headphones, values: { solo: 'Email', team: 'Priority email', practice: 'Priority + onboarding' } },
  { label: 'Translation review', detail: 'Review assisted translations before delivery', icon: Languages, values: { solo: false, team: 'Add-on', practice: 'Included' } },
];

const addOns = [
  {
    id: 'storage',
    name: 'Evidence storage',
    description: 'Keep more original photos and supporting files in the same evidence trail.',
    monthly: '$12 / month',
    annual: '$120 / year',
    availability: 'Team and Practice',
  },
  {
    id: 'translation',
    name: 'Translation review pack',
    description: 'A review queue for teams delivering client summaries in another language.',
    monthly: '$28 / month',
    annual: '$280 / year',
    availability: 'Team add-on · Practice included',
  },
  {
    id: 'onboarding',
    name: 'Practice onboarding',
    description: 'A guided setup for standards, report language and your first live workflow.',
    monthly: 'One-off $320',
    annual: 'One-off $320',
    availability: 'Practice',
  },
];

function Price({ plan, period }: { plan: Plan; period: BillingPeriod }) {
  if (period === 'monthly') {
    return <><span className="text-4xl font-semibold tracking-[-0.04em]">${plan.monthly.price}</span><span className="mb-1 text-sm text-muted-foreground">/ month</span></>;
  }
  return (
    <div className="flex flex-col">
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-[-0.04em]">${plan.annual.monthlyEquivalent.toFixed(2)}</span>
        <span className="mb-1 text-sm text-muted-foreground">/ month equivalent</span>
      </div>
      <span className="mt-1 text-xs text-muted-foreground">billed ${plan.annual.total.toLocaleString('en-AU')} yearly</span>
    </div>
  );
}

export function PricingPage() {
  const [period, setPeriod] = useState<BillingPeriod>('monthly');
  const activePeriodLabel = period === 'monthly' ? 'monthly' : 'annual';
  const periodRows = useMemo(() => comparisonRows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      solo: row.label === 'Inspection reports' ? (period === 'monthly' ? '12 / month' : '150 / year') : row.values.solo,
      team: row.label === 'Inspection reports' ? (period === 'monthly' ? '45 / month' : '600 / year') : row.values.team,
      practice: row.label === 'Inspection reports' ? (period === 'monthly' ? '120 / month' : '1,800 / year') : row.values.practice,
      ...(row.label === 'AI assistance' ? {
        solo: period === 'monthly' ? '40 / month' : '500 / year',
        team: period === 'monthly' ? '200 / month' : '2,400 / year',
        practice: period === 'monthly' ? '600 / month' : '8,000 / year',
      } : {}),
    },
  })), [period]);

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="border-b border-border/80 bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-[70px] max-w-[1240px] items-center justify-between px-5 md:px-8">
          <Link href="/" data-testid="link-pricing-brand" className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-primary-foreground"><HardHat size={19} strokeWidth={2.4} /></span>
            <span className="text-sm font-semibold tracking-tight">SiteCheck <span className="text-primary">AU</span><span className="ml-2 hidden font-mono text-[10px] font-normal uppercase tracking-[.16em] text-muted-foreground sm:inline">field workbench</span></span>
          </Link>
          <nav aria-label="Pricing navigation" className="flex items-center gap-2">
            <Link href="/" data-testid="link-pricing-workspace" className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:inline-flex">Back to workspace</Link>
            <Link href="/sign-in" data-testid="link-pricing-sign-in" className="btn-secondary">Sign in</Link>
          </nav>
        </div>
      </header>

      <main>
        <section className="site-grid relative overflow-hidden border-b border-border/80">
          <div className="absolute -right-24 -top-28 h-72 w-72 rounded-full bg-accent/10 blur-3xl" aria-hidden="true" />
          <div className="mx-auto max-w-[1240px] px-5 pb-14 pt-16 md:px-8 md:pb-20 md:pt-24">
            <div className="max-w-3xl animate-rise-in">
              <div className="eyebrow">Plans for evidence that holds up</div>
              <h1 data-testid="text-pricing-heading" className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.06] tracking-[-0.045em] sm:text-6xl">Choose the workbench that fits your inspection day.</h1>
              <p data-testid="text-pricing-intro" className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground">SiteCheck AU keeps observations, standards context and client-ready reports in one evidence-first workflow. Start small, then add capacity when your practice earns it.</p>
            </div>
            <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="inline-flex w-fit rounded-lg border border-border bg-card p-1 shadow-sm" role="group" aria-label="Billing period">
                <button type="button" onClick={() => setPeriod('monthly')} aria-pressed={period === 'monthly'} data-testid="button-billing-monthly" className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${period === 'monthly' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Monthly</button>
                <button type="button" onClick={() => setPeriod('annual')} aria-pressed={period === 'annual'} data-testid="button-billing-annual" className={`rounded-md px-4 py-2 text-sm font-semibold transition-colors ${period === 'annual' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>Annual <span className={period === 'annual' ? 'text-primary-foreground/75' : 'text-primary'}>save 2 months</span></button>
              </div>
              <p data-testid="text-billing-period-note" className="max-w-md text-sm leading-relaxed text-muted-foreground"><span className="font-semibold text-foreground">You are viewing {activePeriodLabel} billing.</span> Prices and report or AI allowances below follow this selection.</p>
            </div>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 py-12 md:px-8 md:py-16" aria-labelledby="plans-heading">
          <div className="mb-6 flex items-end justify-between gap-4">
            <div><div className="eyebrow">Three clear paths</div><h2 id="plans-heading" className="mt-2 text-2xl font-semibold tracking-tight">A plan for the way you inspect</h2></div>
            <p className="hidden max-w-xs text-right text-xs leading-relaxed text-muted-foreground sm:block">All plans include secure client report sharing and the core evidence trail.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {plans.map((plan, index) => (
              <article key={plan.id} data-testid={`card-plan-${plan.id}`} className={`relative flex flex-col rounded-xl border bg-card p-6 shadow-sm transition-transform duration-200 hover:-translate-y-1 ${plan.featured ? 'border-primary/60 ring-1 ring-primary/15' : 'border-card-border'}`} style={{ animationDelay: `${index * 80}ms` }}>
                {plan.featured && <div data-testid="badge-plan-recommended" className="absolute -top-3 left-5 rounded-full bg-accent px-3 py-1 font-mono text-[10px] font-medium uppercase tracking-[.12em] text-accent-foreground">Most chosen</div>}
                <div className={`mb-5 h-1 w-12 rounded-full ${plan.accent === 'ochre' ? 'bg-accent' : plan.accent === 'navy' ? 'bg-foreground' : 'bg-primary'}`} />
                <div className="eyebrow">{plan.kicker}</div>
                <h3 data-testid={`text-plan-name-${plan.id}`} className="mt-2 text-2xl font-semibold tracking-tight">{plan.name}</h3>
                <p className="mt-3 min-h-[58px] text-sm leading-relaxed text-muted-foreground">{plan.description}</p>
                <div data-testid={`text-plan-price-${plan.id}`} className="mt-6 min-h-[62px]"><Price plan={plan} period={period} /></div>
                <div className="mt-5 space-y-3 border-t border-border pt-5 text-sm">
                  <div data-testid={`text-plan-reports-${plan.id}`} className="flex items-center gap-2"><FileCheck2 size={15} className="text-primary" /> <span className="font-medium">{period === 'monthly' ? plan.monthly.reports : plan.annual.reports}</span></div>
                  <div className="flex items-center gap-2"><Users size={15} className="text-primary" /> <span>{plan.seats}</span></div>
                  <div className="flex items-center gap-2"><Database size={15} className="text-primary" /> <span>{plan.storage}</span></div>
                  <div data-testid={`text-plan-ai-${plan.id}`} className="flex items-center gap-2"><Sparkles size={15} className="text-primary" /> <span>{period === 'monthly' ? plan.monthly.ai : plan.annual.ai}</span></div>
                </div>
                <Link href="/sign-up" data-testid={`link-plan-sign-up-${plan.id}`} className={`mt-7 w-full ${plan.featured ? 'btn-primary' : 'btn-secondary'}`}>Create a workspace <ArrowRight size={15} /></Link>
                <p className="mt-3 text-center text-[11px] text-muted-foreground">No purchase flow here. Start with an account and review your fit.</p>
              </article>
            ))}
          </div>
        </section>

        <section className="border-y border-border/80 bg-muted/35" aria-labelledby="comparison-heading">
          <div className="mx-auto max-w-[1240px] px-5 py-12 md:px-8 md:py-16">
            <div className="max-w-2xl"><div className="eyebrow">At a glance</div><h2 id="comparison-heading" className="mt-2 text-2xl font-semibold tracking-tight">Compare the work that matters in the field</h2><p className="mt-3 text-sm leading-relaxed text-muted-foreground">The difference between plans is capacity and care around the workflow, not access to a watered-down report.</p></div>
            <div className="mt-8 overflow-x-auto rounded-xl border border-border bg-card shadow-sm">
              <table className="w-full min-w-[760px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-border bg-muted/45">
                    <th scope="col" className="w-[34%] px-5 py-4 text-xs font-semibold uppercase tracking-[.12em] text-muted-foreground">Capability</th>
                    {plans.map((plan) => <th key={plan.id} scope="col" className="px-4 py-4 text-sm font-semibold">{plan.name}<span className="mt-1 block font-mono text-[10px] font-normal uppercase tracking-[.12em] text-muted-foreground">{period === 'monthly' ? 'monthly' : 'annual'}</span></th>)}
                  </tr>
                </thead>
                <tbody>
                  {periodRows.map((row) => {
                    const Icon = row.icon;
                    return <tr key={row.label} data-testid={`row-comparison-${row.label.toLowerCase().replaceAll(' ', '-')}`} className="border-b border-border/70 last:border-0">
                      <th scope="row" className="px-5 py-4 align-top font-medium"><span className="flex items-center gap-2"><Icon size={15} className="shrink-0 text-primary" />{row.label}</span>{row.detail && <span className="mt-1 block pl-[23px] text-xs font-normal leading-relaxed text-muted-foreground">{row.detail}</span>}</th>
                      {plans.map((plan) => <td key={plan.id} data-testid={`cell-${row.label.toLowerCase().replaceAll(' ', '-')}-${plan.id}`} className="px-4 py-4 align-top text-sm">{typeof row.values[plan.id] === 'boolean' ? (row.values[plan.id] ? <Check size={16} className="text-primary" aria-label="Included" /> : <X size={16} className="text-muted-foreground/60" aria-label="Not included" />) : row.values[plan.id]}</td>)}
                    </tr>;
                  })}
                </tbody>
              </table>
            </div>
            <p data-testid="text-comparison-footnote" className="mt-4 text-xs leading-relaxed text-muted-foreground">Annual report and AI allowances are available across the year; monthly allowances reset each month. Storage is a live workspace allowance.</p>
          </div>
        </section>

        <section className="mx-auto max-w-[1240px] px-5 py-12 md:px-8 md:py-16" aria-labelledby="addons-heading">
          <div className="grid gap-10 lg:grid-cols-[.8fr_1.2fr] lg:items-start">
            <div><div className="eyebrow">Optional, not hidden</div><h2 id="addons-heading" className="mt-2 text-2xl font-semibold tracking-tight">Add capacity only when your practice needs it.</h2><p className="mt-3 max-w-md text-sm leading-relaxed text-muted-foreground">Add-ons sit outside the plan comparison so your base allowance stays easy to understand. Availability follows the plan tier shown here.</p></div>
            <div className="divide-y divide-border rounded-xl border border-border bg-card shadow-sm">
              {addOns.map((addOn) => <div key={addOn.id} data-testid={`card-addon-${addOn.id}`} className="grid gap-3 p-5 sm:grid-cols-[1fr_auto] sm:items-center">
                <div><div className="flex items-center gap-2 font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">{addOn.id === 'storage' ? <Database size={14} /> : addOn.id === 'translation' ? <Languages size={14} /> : <Headphones size={14} />}</span>{addOn.name}</div><p className="mt-2 text-sm leading-relaxed text-muted-foreground">{addOn.description}</p><p className="mt-2 font-mono text-[10px] uppercase tracking-[.1em] text-primary">{addOn.availability}</p></div>
                <div className="text-left sm:text-right"><div data-testid={`text-addon-price-${addOn.id}`} className="text-sm font-semibold">{period === 'monthly' ? addOn.monthly : addOn.annual}</div><div className="mt-1 text-xs text-muted-foreground">{addOn.id === 'onboarding' ? 'one-off service' : 'selected billing period'}</div></div>
              </div>)}
            </div>
          </div>
        </section>

        <section className="border-t border-border/80 bg-sidebar text-sidebar-foreground">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-5 py-12 md:flex-row md:items-center md:justify-between md:px-8 md:py-14">
            <div><div className="eyebrow text-sidebar-foreground/50">Ready when you are</div><h2 className="mt-2 max-w-xl text-2xl font-semibold tracking-tight">Bring your next inspection into a cleaner evidence trail.</h2><p className="mt-3 max-w-xl text-sm leading-relaxed text-sidebar-foreground/65">Create an account to explore the workbench. Plan selection and billing can be reviewed with your team when the fit is clear.</p></div>
            <div className="flex shrink-0 flex-wrap gap-3"><Link href="/sign-up" data-testid="link-pricing-final-sign-up" className="btn-primary">Create an account <ArrowRight size={15} /></Link><Link href="/sign-in" data-testid="link-pricing-final-sign-in" className="inline-flex items-center justify-center rounded-md border border-sidebar-border px-4 py-2.5 text-sm font-semibold text-sidebar-foreground transition-colors hover:bg-sidebar-accent">Sign in</Link></div>
          </div>
        </section>
      </main>
      <footer className="border-t border-border bg-background px-5 py-7 md:px-8">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"><span>SiteCheck AU · Australian inspection workbench</span><span>Prices shown in Australian dollars.</span></div>
      </footer>
    </div>
  );
}