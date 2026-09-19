'use client';
import * as React from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Mail, ShieldCheck, User } from 'lucide-react';
import { DirectorName, type SupportedLocale } from '@/contracts';
import { authApi } from '@/lib/api/endpoints';
import { setAccessToken } from '@/lib/api/client';
import { isApiError } from '@/lib/api/errors';
import { useErrorMessage } from '@/lib/api/error-message';
import { useAuthStore } from '@/stores/auth';
import { useSessionGate } from '@/hooks/use-session';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/input';
import { OtpInput } from '@/components/ui/otp-input';
import { Checkbox } from '@/components/ui/switch';
import { Countdown } from '@/components/ui/countdown';
import { Logo } from '@/components/brand/logo';
import { BrandSplash } from '@/components/brand/splash';
import { LanguageSelect } from '@/features/settings/language-select';
import { FamilyBadge } from '@/design/icons';

type Step = 'email' | 'otp' | 'profile';
interface Challenge {
  challengeId: string;
  maskedEmail: string;
  resendAvailableAt: string;
  email: string;
}

const emailSchema = z.object({ email: z.string().trim().email().max(254) });
const profileSchema = z.object({
  directorName: DirectorName,
  acceptTerms: z.literal(true),
  confirmAge: z.literal(true),
  marketingConsent: z.boolean(),
});
type ProfileValues = z.input<typeof profileSchema>;

export function AuthScreen() {
  const allowed = useSessionGate('anonymous-only');
  const t = useTranslations('auth');
  const tc = useTranslations('common');
  const locale = useLocale() as SupportedLocale;
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const setSession = useAuthStore((s) => s.setSession);

  const [step, setStep] = React.useState<Step>('email');
  const [challenge, setChallenge] = React.useState<Challenge | null>(null);
  const [code, setCode] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  // Holds the challenge whose resend cooldown has elapsed (derived flag below: no state reset needed per challenge).
  const [resendReadyFor, setResendReadyFor] = React.useState<string | null>(null);

  const emailForm = useForm<z.infer<typeof emailSchema>>({
    resolver: zodResolver(emailSchema),
    defaultValues: { email: '' },
  });
  const profileForm = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      directorName: '',
      acceptTerms: false as unknown as true,
      confirmAge: false as unknown as true,
      marketingConsent: false,
    },
  });

  const consents = useWatch({ control: profileForm.control });

  React.useEffect(() => {
    if (!challenge) return;
    const ms = Math.max(0, Date.parse(challenge.resendAvailableAt) - Date.now());
    const timer = setTimeout(() => setResendReadyFor(challenge.challengeId), ms);
    return () => clearTimeout(timer);
  }, [challenge]);

  const resendReady = !!challenge && resendReadyFor === challenge.challengeId;

  const requestOtp = async (email: string) => {
    setBusy(true);
    setError(null);
    try {
      const res = await authApi.requestOtp({ email, locale });
      setChallenge({ ...res, email });
      setCode('');
      setStep('otp');
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const verify = async (otp: string, profile?: ProfileValues) => {
    if (!challenge) return;
    setBusy(true);
    setError(null);
    try {
      const result = await authApi.verifyOtp({
        challengeId: challenge.challengeId,
        code: otp,
        ...(profile ?? {}),
      });
      setAccessToken(result.accessToken, result.accessTokenExpiresAt);
      setSession(result.user);
      if (result.user.locale !== locale) void authApi.updateMe({ locale }).catch(() => undefined);
      router.replace(result.user.activeCareerId ? '/game' : '/onboarding');
    } catch (e) {
      if (isApiError(e, 'DIRECTOR_NAME_REQUIRED')) {
        setStep('profile');
        return;
      }
      if (isApiError(e, 'DIRECTOR_NAME_INVALID')) {
        profileForm.setError('directorName', { message: errorMessage(e) });
        return;
      }
      if (
        isApiError(e, 'OTP_INVALID') ||
        isApiError(e, 'OTP_EXPIRED') ||
        isApiError(e, 'OTP_TOO_MANY_ATTEMPTS')
      ) {
        setStep('otp');
        setCode('');
      }
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (!allowed) return <BrandSplash />;

  return (
    <main className="h-dvh-safe scroll-y bg-bg grid lg:grid-cols-[1.1fr_1fr]">
      {/* brand panel — desktop only */}
      <aside className="border-border bg-surface-1 relative hidden flex-col justify-between overflow-hidden border-r p-10 lg:flex">
        <div
          aria-hidden
          className="absolute inset-0 opacity-60"
          style={{
            background:
              'radial-gradient(60% 50% at 30% 20%, rgb(90 162 230 / 0.18), transparent), radial-gradient(40% 40% at 80% 90%, rgb(229 32 42 / 0.16), transparent)',
          }}
        />
        <Logo variant="stacked" className="relative mx-auto mt-10 w-[min(420px,80%)]" priority />
        <div className="relative">
          <p className="font-display text-fg max-w-md text-2xl leading-tight font-bold">{t('pitch')}</p>
          <ul className="mt-5 flex gap-2" aria-label={t('families')}>
            {(['FIRE', 'EMS', 'POLICE', 'WILDFIRE', 'ALPINE'] as const).map((f) => (
              <li key={f}>
                <FamilyBadge family={f} size={36} />
              </li>
            ))}
          </ul>
          <p className="text-subtle mt-6 text-xs">{tc('disclaimer')}</p>
        </div>
      </aside>

      <section className="pt-safe pb-safe flex min-h-full flex-col px-5 lg:px-16">
        <header className="flex h-14 shrink-0 items-center justify-between">
          {step !== 'email' ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setStep(step === 'profile' ? 'otp' : 'email');
                setError(null);
              }}
            >
              <ArrowLeft className="size-4" aria-hidden />
              {tc('back')}
            </Button>
          ) : (
            <Logo variant="horizontal" className="w-36 lg:invisible" />
          )}
          <LanguageSelect compact />
        </header>

        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 py-6">
          {step === 'email' ? (
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={emailForm.handleSubmit((v) => requestOtp(v.email))}
            >
              <div>
                <h1 className="font-display text-3xl font-extrabold">{t('email.title')}</h1>
                <p className="text-muted mt-2">{t('email.subtitle')}</p>
              </div>
              <Field
                label={t('email.label')}
                htmlFor="email"
                error={emailForm.formState.errors.email ? t('email.invalid') : null}
              >
                <Input
                  id="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder={t('email.placeholder')}
                  leading={<Mail className="size-4" />}
                  invalid={!!emailForm.formState.errors.email}
                  aria-describedby="email-error"
                  {...emailForm.register('email')}
                />
              </Field>
              {error ? (
                <p role="alert" className="text-danger text-sm">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="xl" loading={busy}>
                {t('email.submit')}
              </Button>
              <p className="text-subtle text-center text-xs">{t('email.noPassword')}</p>
            </form>
          ) : null}

          {step === 'otp' && challenge ? (
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.length === 6) void verify(code);
              }}
            >
              <div>
                <h1 className="font-display text-3xl font-extrabold">{t('otp.title')}</h1>
                <p className="text-muted mt-2">{t('otp.subtitle', { email: challenge.maskedEmail })}</p>
              </div>
              <OtpInput
                label={t('otp.label')}
                value={code}
                onChange={(v) => {
                  setCode(v);
                  setError(null);
                }}
                onComplete={(v) => void verify(v)}
                disabled={busy}
                invalid={!!error}
                autoFocus
              />
              {error ? (
                <p role="alert" className="text-danger text-center text-sm">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="xl" loading={busy} disabled={code.length !== 6}>
                {t('otp.submit')}
              </Button>
              <div className="text-muted text-center text-sm">
                {resendReady ? (
                  <Button variant="link" onClick={() => void requestOtp(challenge.email)} disabled={busy}>
                    {t('otp.resend')}
                  </Button>
                ) : (
                  <span>
                    {t('otp.resendIn')} <Countdown to={challenge.resendAvailableAt} className="text-fg" />
                  </span>
                )}
              </div>
            </form>
          ) : null}

          {step === 'profile' ? (
            <form
              noValidate
              className="flex flex-col gap-5"
              onSubmit={profileForm.handleSubmit((v) => verify(code, v))}
            >
              <div>
                <h1 className="font-display text-3xl font-extrabold">{t('profile.title')}</h1>
                <p className="text-muted mt-2">{t('profile.subtitle')}</p>
              </div>
              <Field
                label={t('profile.nameLabel')}
                htmlFor="directorName"
                hint={t('profile.nameHint')}
                error={
                  profileForm.formState.errors.directorName
                    ? profileForm.formState.errors.directorName.message &&
                      profileForm.formState.errors.directorName.type === undefined
                      ? profileForm.formState.errors.directorName.message
                      : t('profile.nameInvalid')
                    : null
                }
              >
                <Input
                  id="directorName"
                  autoComplete="nickname"
                  maxLength={24}
                  leading={<User className="size-4" />}
                  invalid={!!profileForm.formState.errors.directorName}
                  {...profileForm.register('directorName')}
                />
              </Field>
              <fieldset className="flex flex-col gap-3">
                <legend className="sr-only">{t('profile.consents')}</legend>
                {(
                  [
                    ['acceptTerms', t('profile.acceptTerms'), true],
                    ['confirmAge', t('profile.confirmAge'), true],
                    ['marketingConsent', t('profile.marketing'), false],
                  ] as const
                ).map(([name, label, required]) => (
                  <label key={name} className="text-muted flex cursor-pointer items-start gap-3 text-sm">
                    <Checkbox
                      id={name}
                      checked={!!consents[name]}
                      aria-invalid={!!profileForm.formState.errors[name]}
                      aria-required={required}
                      onCheckedChange={(c) =>
                        profileForm.setValue(name, (c === true) as never, {
                          shouldValidate: profileForm.formState.isSubmitted,
                        })
                      }
                    />
                    <span>
                      {label}
                      {required ? <span className="text-brand-hover"> *</span> : null}
                    </span>
                  </label>
                ))}
                {profileForm.formState.errors.acceptTerms || profileForm.formState.errors.confirmAge ? (
                  <p role="alert" className="text-danger text-xs">
                    {t('profile.consentsRequired')}
                  </p>
                ) : null}
              </fieldset>
              {error ? (
                <p role="alert" className="text-danger text-sm">
                  {error}
                </p>
              ) : null}
              <Button type="submit" size="xl" loading={busy}>
                <ShieldCheck className="size-5" aria-hidden />
                {t('profile.submit')}
              </Button>
            </form>
          ) : null}
        </div>
        <p className="text-subtle pb-4 text-center text-[11px] lg:hidden">{tc('disclaimer')}</p>
      </section>
    </main>
  );
}
