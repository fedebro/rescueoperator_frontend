import * as React from 'react';
import { render, type RenderOptions } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/it.json';

/** Renders with the Italian messages; a missing message fails the test instead of silently rendering the key. */
export function renderWithIntl(ui: React.ReactElement, options?: RenderOptions) {
  return render(ui, {
    wrapper: ({ children }) => (
      <NextIntlClientProvider
        locale="it"
        messages={messages}
        timeZone="Europe/Rome"
        onError={(e) => {
          throw e;
        }}
      >
        {children}
      </NextIntlClientProvider>
    ),
    ...options,
  });
}
