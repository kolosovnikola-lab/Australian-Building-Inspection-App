import { useEffect, useRef } from 'react';
import { useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { clearTranslationReviewDraftsOnAccountChange } from '@/pages/report-translation-review';

export function CacheInvalidator() {
  const { addListener } = useClerk();
  const client = useQueryClient();
  const previous = useRef<string | null | undefined>(undefined);

  useEffect(() => addListener(({ user }) => {
    const id = user?.id ?? null;
    if (clearTranslationReviewDraftsOnAccountChange(window.localStorage, previous.current, id)) {
      client.clear();
    }
    previous.current = id;
  }), [addListener, client]);

  return null;
}