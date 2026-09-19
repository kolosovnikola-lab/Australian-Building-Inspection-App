import { type ReactNode } from 'react';
import { ClerkProvider, Show, SignIn, SignUp } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Switch, Redirect, useLocation, Router as WouterRouter, Link } from 'wouter';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SiteShell } from '@/components/site-shell';
import { DashboardPage } from '@/pages/dashboard';
import { InspectionsPage } from '@/pages/inspections';
import { InspectionDetailPage } from '@/pages/inspection-detail';
import { FindingFormPage } from '@/pages/finding-form';
import { ScanPage } from '@/pages/scan';
import { StandardsPage } from '@/pages/standards';
import { SharedReportPage } from '@/pages/shared-report';
import { PricingPage } from '@/pages/pricing';
import { ClientLanguageGlossaryPage } from '@/pages/client-language-glossary';
import { CacheInvalidator } from '@/components/cache-invalidator';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;

function stripBase(path: string) {
  return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path;
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function LandingPage() {
  return <div className="min-h-[100dvh] bg-background px-6 py-12">
    <div className="mx-auto flex max-w-5xl flex-col items-center justify-center gap-8 py-20 text-center">
      <img src={`${basePath}/logo.svg`} className="h-16 w-16" alt="SiteCheck AU" />
      <div><div className="eyebrow">Australian inspection workbench</div><h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-6xl">Evidence-first inspections.<br />Client-safe reports.</h1></div>
      <p className="max-w-2xl text-lg text-muted-foreground">Securely capture findings, trace references and control exactly what clients can see.</p>
      <div className="flex flex-wrap justify-center gap-3"><Link href="/sign-in" data-testid="link-landing-sign-in" className="btn-primary">Inspector sign in</Link><Link href="/sign-up" data-testid="link-landing-sign-up" className="btn-secondary">Create account</Link><Link href="/pricing" data-testid="link-landing-pricing" className="btn-secondary">View plans</Link></div>
    </div>
  </div>;
}

function InspectorApp() {
  return <SiteShell><Switch>
    <Route path="/" component={DashboardPage} />
    <Route path="/inspections" component={InspectionsPage} />
    <Route path="/inspections/:id/scan" component={ScanPage} />
    <Route path="/inspections/:id/findings/new" component={FindingFormPage} />
    <Route path="/inspections/:id" component={InspectionDetailPage} />
    <Route path="/standards" component={StandardsPage} />
    <Route path="/client-language-glossary" component={ClientLanguageGlossaryPage} />
    <Route component={NotFound} />
  </Switch></SiteShell>;
}

function AppRoutes() {
  const [location] = useLocation();
  if (location.startsWith('/reports/')) {
    return <RoutedErrorBoundary><Switch><Route path="/reports/:token" component={SharedReportPage} /><Route component={NotFound} /></Switch></RoutedErrorBoundary>;
  }
  return <RoutedErrorBoundary><Switch>
    <Route path="/pricing" component={PricingPage} />
    <Route path="/sign-in/*?">{() => <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>}</Route>
    <Route path="/sign-up/*?">{() => <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>}</Route>
    <Route path="/*?">{() => <><Show when="signed-in"><InspectorApp /></Show><Show when="signed-out">{location === '/' ? <LandingPage /> : <Redirect to="/" />}</Show></>}</Route>
  </Switch></RoutedErrorBoundary>;
}

function ClerkRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl}
    appearance={{ theme: shadcn, cssLayerName: 'clerk', options: { logoPlacement: 'inside', logoImageUrl: `${window.location.origin}${basePath}/logo.svg`, logoLinkUrl: basePath || '/' }, variables: { colorPrimary: '#287f78', colorForeground: '#17343a', colorMutedForeground: '#647678', colorBackground: '#fffdf8', colorInput: '#ffffff', colorInputForeground: '#17343a', colorDanger: '#b42318', colorNeutral: '#d8dfdb', fontFamily: 'Inter, sans-serif', borderRadius: '0.6rem' } }}
    signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}
    localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to your SiteCheck AU workspace' } }, signUp: { start: { title: 'Create your inspector account', subtitle: 'Secure your inspections and client reports' } } }}
    routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><CacheInvalidator /><TooltipProvider><AppRoutes /><Toaster /></TooltipProvider></QueryClientProvider>
  </ClerkProvider>;
}

export default function App() {
  return <WouterRouter base={basePath}><ClerkRoutes /></WouterRouter>;
}