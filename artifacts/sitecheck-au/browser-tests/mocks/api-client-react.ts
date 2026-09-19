import { useSyncExternalStore } from 'react';

type GlossaryTerm = {
  id: number;
  term: string;
  suggestedMeaning: string;
  active: boolean;
};
type GlossaryEvent = {
  id: number;
  glossaryTermId: number;
  action: 'added' | 'edited' | 'retired' | 'restored';
  term: string;
  suggestedMeaning: string;
  previousTerm: string | null;
  previousSuggestedMeaning: string | null;
  actorDisplayName: string;
  happenedAt: string;
};

let terms: GlossaryTerm[] = [
  {
    id: 1,
    term: 'efflorescence',
    suggestedMeaning: 'white salt deposits on the surface',
    active: true,
  },
];
let nextId = 2;
let nextEventId = 1;
let history: GlossaryEvent[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export const getHealthCheckQueryKey = () => ['health'];
export const getListClientLanguageGlossaryQueryKey = () => ['client-language-glossary'];
export const getListManagedClientLanguageGlossaryQueryKey = () => ['managed-client-language-glossary'];
export const getListClientLanguageGlossaryHistoryQueryKey = () => ['client-language-glossary-history'];

export function useHealthCheck() {
  return { isError: false, isLoading: false };
}

export function useListManagedClientLanguageGlossary() {
  const data = useSyncExternalStore(subscribe, () => terms);
  return { data, isLoading: false, isError: false };
}

export function useListClientLanguageGlossaryHistory() {
  const data = useSyncExternalStore(subscribe, () => history);
  return { data, isLoading: false, isError: false };
}

export function useCreateClientLanguageGlossaryTerm() {
  return {
    isPending: false,
    mutate(
      request: { data: { term: string; suggestedMeaning: string } },
      callbacks: { onSuccess: () => void; onError: () => void },
    ) {
      if (!request.data.term || !request.data.suggestedMeaning) {
        callbacks.onError();
        return;
      }
      const created = { id: nextId++, ...request.data, active: true };
      terms = [...terms, created];
      history = [{
        id: nextEventId++,
        glossaryTermId: created.id,
        action: 'added',
        term: created.term,
        suggestedMeaning: created.suggestedMeaning,
        previousTerm: null,
        previousSuggestedMeaning: null,
        actorDisplayName: 'Test Manager',
        happenedAt: new Date().toISOString(),
      }, ...history];
      emit();
      callbacks.onSuccess();
    },
  };
}

export function useUpdateClientLanguageGlossaryTerm() {
  return {
    isPending: false,
    mutate(
      request: {
        id: number;
        data: Partial<Pick<GlossaryTerm, 'term' | 'suggestedMeaning' | 'active'>>;
      },
      callbacks: { onSuccess: () => void; onError: () => void },
    ) {
      if (
        ('term' in request.data && !request.data.term)
        || ('suggestedMeaning' in request.data && !request.data.suggestedMeaning)
      ) {
        callbacks.onError();
        return;
      }
      const current = terms.find((term) => term.id === request.id);
      if (!current) {
        callbacks.onError();
        return;
      }
      const updated = { ...current, ...request.data };
      const action = request.data.active !== undefined && request.data.active !== current.active
        ? request.data.active ? 'restored' : 'retired'
        : 'edited';
      terms = terms.map((term) => term.id === request.id ? updated : term);
      history = [{
        id: nextEventId++,
        glossaryTermId: updated.id,
        action,
        term: updated.term,
        suggestedMeaning: updated.suggestedMeaning,
        previousTerm: action === 'edited' ? current.term : null,
        previousSuggestedMeaning: action === 'edited' ? current.suggestedMeaning : null,
        actorDisplayName: 'Test Manager',
        happenedAt: new Date().toISOString(),
      }, ...history];
      emit();
      callbacks.onSuccess();
    },
  };
}