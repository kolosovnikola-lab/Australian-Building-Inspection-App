import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import * as Network from 'expo-network';
import {
  completeFindingMediaUpload,
  createFinding,
  requestFindingMediaUpload,
  type FindingInput,
  type VisionFinding,
} from '@workspace/api-client-react';
import {
  queueStorageKey,
  readCurrentAccountQueue,
  removePreviousAccountQueue,
} from '@/lib/account-security';

export type QueueStatus = 'local_only' | 'uploading' | 'verified' | 'failed';
export type QueueContentType = 'image/jpeg' | 'image/png' | 'image/webp';
export type LocalFileState = 'available' | 'missing';

export interface QueuedFinding {
  id: string;
  inspectionId: number;
  inspectionTitle: string;
  imageUri: string;
  finding: VisionFinding;
  capturedAt: string;
  classification: 'client_report' | 'private_evidence';
  area?: string;
  note?: string;
  fileName: string;
  contentType: QueueContentType;
  localFileState: LocalFileState;
  sha256?: string;
  sizeBytes?: number;
  findingId?: number;
  objectPath?: string;
  uploadUrl?: string;
  uploadExpiresAt?: string;
  progress: number;
  status: QueueStatus;
  lastError?: string;
}

interface QueueContextValue {
  queue: QueuedFinding[];
  addFinding: (item: Omit<QueuedFinding, 'id' | 'status' | 'capturedAt' | 'fileName' | 'contentType' | 'localFileState' | 'progress'>) => Promise<void>;
  removeFinding: (id: string) => Promise<void>;
  clearQueue: () => Promise<void>;
  retryFinding: (id: string) => Promise<void>;
  replaceFindingPhoto: (id: string, imageUri: string) => Promise<void>;
  syncAll: () => Promise<void>;
}

const QueueContext = createContext<QueueContextValue | undefined>(undefined);

const MAX_QUEUE_SIZE = 5;
const AUTO_RESUME_COOLDOWN_MS = 30_000;

function hasUsableConnection(state: Network.NetworkState) {
  return state.isConnected === true && state.isInternetReachable !== false;
}

function contentTypeForUri(uri: string): QueueContentType {
  const extension = uri.split('?')[0].split('.').pop()?.toLowerCase();
  if (extension === 'png') return 'image/png';
  if (extension === 'webp') return 'image/webp';
  return 'image/jpeg';
}

function fileNameForUri(uri: string, id: string, contentType: QueueContentType) {
  const rawName = decodeURIComponent(uri.split('?')[0].split('/').pop() || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (rawName && /\.(jpe?g|png|webp)$/i.test(rawName)) return rawName.slice(0, 255);
  return `${id}.${contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg'}`;
}

function hexDigest(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clampProgress(progress: number | undefined) {
  return Math.max(0, Math.min(100, Math.round(progress ?? 0)));
}

function normalizeQueueItem(value: unknown): QueuedFinding | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<QueuedFinding>;
  if (
    typeof item.id !== 'string'
    || typeof item.inspectionId !== 'number'
    || typeof item.inspectionTitle !== 'string'
    || typeof item.imageUri !== 'string'
    || !item.finding
    || typeof item.capturedAt !== 'string'
  ) {
    return null;
  }
  const contentType = item.contentType === 'image/png' || item.contentType === 'image/webp'
    ? item.contentType
    : 'image/jpeg';
  const status: QueueStatus = item.status === 'uploading' || item.status === 'verified' || item.status === 'failed'
    ? item.status
    : 'local_only';
  return {
    id: item.id,
    inspectionId: item.inspectionId,
    inspectionTitle: item.inspectionTitle,
    imageUri: item.imageUri,
    finding: item.finding,
    capturedAt: item.capturedAt,
    classification: item.classification === 'private_evidence' ? 'private_evidence' : 'client_report',
    area: item.area,
    note: item.note,
    fileName: item.fileName || fileNameForUri(item.imageUri, item.id, contentType),
    contentType,
    localFileState: item.localFileState === 'missing' ? 'missing' : 'available',
    sha256: item.sha256,
    sizeBytes: item.sizeBytes,
    findingId: item.findingId,
    objectPath: item.objectPath,
    uploadUrl: item.uploadUrl,
    uploadExpiresAt: item.uploadExpiresAt,
    progress: status === 'verified' ? 100 : clampProgress(item.progress),
    status,
    lastError: item.lastError,
  };
}

function findingInputForQueueItem(item: QueuedFinding): FindingInput {
  const limitation = item.finding.limitation.trim();
  return {
    creationRequestId: item.id,
    area: item.area?.trim() || 'Camera review',
    subCategory: 'Camera suggestion',
    category: item.finding.category,
    title: item.finding.label.trim(),
    location: item.finding.locationHint.trim() || item.area?.trim() || 'Not specified',
    severity: item.finding.suggestedSeverity,
    pestRelevance: item.finding.category === 'pest' ? 'further_investigation' : 'not_applicable',
    observed: `${item.note?.trim() ? `${item.note.trim()}\n\n` : ''}${item.finding.observation.trim()}${limitation ? `\n\nCamera limitation: ${limitation}` : ''}`,
    standardRef: 'Inspector review required',
    standardTitle: 'Camera analysis is not a standards assessment',
    requirement: 'Confirm the applicable requirement during inspector review.',
    tolerance: 'Not assessed by camera analysis.',
    assessment: 'monitor',
    recommendation: item.finding.recommendation.trim(),
    clientExplanation: null,
    backupDestination: 'app_only',
  };
}

function uploadBlob(
  uploadUrl: string,
  blob: Blob,
  contentType: QueueContentType,
  sha256: string,
  onProgress: (progress: number) => void,
) {
  return new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.timeout = 120_000;
    request.setRequestHeader('Content-Type', contentType);
    request.setRequestHeader('x-goog-meta-sha256', sha256);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error(`Storage upload failed (${request.status})`));
      }
    };
    request.onerror = () => reject(new Error('Storage upload could not reach App Storage.'));
    request.ontimeout = () => reject(new Error('Storage upload timed out. Check connectivity and retry.'));
    request.send(blob);
  });
}

export function QueueProvider({
  children,
  userId,
}: {
  children: React.ReactNode;
  userId: string | null;
}) {
  const [queue, setQueue] = useState<QueuedFinding[]>([]);
  const queueRef = useRef<QueuedFinding[]>([]);
  const previousUserId = useRef<string | null>(null);
  const loadVersion = useRef(0);
  const syncingIds = useRef(new Set<string>());
  const queueLoaded = useRef(false);
  const usableConnection = useRef<boolean | null>(null);
  const autoResumeInFlight = useRef(false);
  const lastAutoResumeAt = useRef(0);

  useEffect(() => {
    const version = ++loadVersion.current;
    const nextKey = queueStorageKey(userId);
    const oldUserId = previousUserId.current;
    previousUserId.current = userId;
    queueLoaded.current = false;
    usableConnection.current = null;
    autoResumeInFlight.current = false;
    lastAutoResumeAt.current = 0;
    queueRef.current = [];
    setQueue([]);

    void removePreviousAccountQueue(AsyncStorage, oldUserId, userId);
    if (!nextKey) return;

    void loadQueue(nextKey, version);
  }, [userId]);

  const loadQueue = async (storageKey: string, version: number) => {
    try {
      const stored = await readCurrentAccountQueue(
        AsyncStorage,
        storageKey.slice('@sitecheck_queue:'.length),
      );
      if (stored && version === loadVersion.current) {
        const parsed = JSON.parse(stored) as unknown;
        const items = Array.isArray(parsed)
          ? parsed.map(normalizeQueueItem).filter((item): item is QueuedFinding => Boolean(item))
          : [];
        const recoveredItems = items.map((item) => item.status === 'uploading'
          ? {
              ...item,
              status: 'failed' as const,
              lastError: item.lastError || 'Upload was interrupted. Retry to resume.',
            }
          : item);
        queueRef.current = recoveredItems;
        setQueue(recoveredItems);
        if (recoveredItems.some((item, index) => item !== items[index])) {
          void AsyncStorage.setItem(storageKey, JSON.stringify(recoveredItems));
        }
      }
    } catch (e) {
      console.error('Failed to load queue', e);
    } finally {
      if (version === loadVersion.current) {
        queueLoaded.current = true;
        try {
          const state = await Network.getNetworkStateAsync();
          usableConnection.current = hasUsableConnection(state);
          if (usableConnection.current) void autoResumeEligibleItems();
        } catch (error) {
          console.error('Failed to check network state', error);
        }
      }
    }
  };

  const saveQueue = async (newQueue: QueuedFinding[]) => {
    if (!userId) {
      throw new Error('Sign in before saving inspection evidence.');
    }
    try {
      queueRef.current = newQueue;
      setQueue(newQueue);
      await AsyncStorage.setItem(queueStorageKey(userId)!, JSON.stringify(newQueue));
    } catch (e) {
      console.error('Failed to save queue', e);
      throw e;
    }
  };

  const updateFinding = async (id: string, changes: Partial<QueuedFinding>) => {
    const nextQueue = queueRef.current.map((item) => item.id === id ? { ...item, ...changes } : item);
    await saveQueue(nextQueue);
    return nextQueue.find((item) => item.id === id);
  };

  const addFinding = async (item: Omit<QueuedFinding, 'id' | 'status' | 'capturedAt' | 'fileName' | 'contentType' | 'localFileState' | 'progress'>) => {
    const id = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const contentType = contentTypeForUri(item.imageUri);
    const newFinding: QueuedFinding = {
      ...item,
      id,
      capturedAt: new Date().toISOString(),
      fileName: fileNameForUri(item.imageUri, id, contentType),
      contentType,
      localFileState: 'available',
      progress: 0,
      status: 'local_only',
    };

    const newQueue = [newFinding, ...queueRef.current];
    if (newQueue.length > MAX_QUEUE_SIZE) {
      // Keep within limit
      newQueue.pop();
    }
    await saveQueue(newQueue);
  };

  const syncFinding = async (id: string) => {
    if (syncingIds.current.has(id)) return;
    const initial = queueRef.current.find((item) => item.id === id);
    if (!initial || initial.status === 'verified') return;
    syncingIds.current.add(id);
    try {
      let item = await updateFinding(id, {
        status: 'uploading',
        progress: Math.max(initial.progress, 2),
        lastError: undefined,
      });
      if (!item) throw new Error('Queued finding is no longer available.');

      const localResponse = await fetch(item.imageUri);
      if (!localResponse.ok) throw new Error('The captured photo is no longer available on this device.');
      const blob = await localResponse.blob();
      const bytes = await blob.arrayBuffer();
      const sha256 = item.sha256 ?? hexDigest(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, bytes));
      const sizeBytes = item.sizeBytes ?? bytes.byteLength;
      item = await updateFinding(id, {
        sha256,
        sizeBytes,
        localFileState: 'available',
        progress: Math.max(item.progress, 10),
      }) ?? item;

      if (!item.findingId) {
        const created = await createFinding(item.inspectionId, findingInputForQueueItem(item));
        item = await updateFinding(id, { findingId: created.id, progress: Math.max(item.progress, 20) }) ?? item;
      }

      const uploadIsReusable = Boolean(
        item.uploadUrl
        && item.objectPath
        && item.uploadExpiresAt
        && new Date(item.uploadExpiresAt).getTime() > Date.now() + 10_000,
      );
      if (!uploadIsReusable) {
        const upload = await requestFindingMediaUpload(item.inspectionId, {
          findingId: item.findingId!,
          classification: item.classification,
          contentType: item.contentType,
          sizeBytes,
          sha256,
        });
        item = await updateFinding(id, {
          objectPath: upload.objectPath,
          uploadUrl: upload.uploadUrl,
          uploadExpiresAt: upload.expiresAt,
          progress: Math.max(item.progress, 25),
        }) ?? item;
      }

      let lastPersistedProgress = item.progress;
      let progressWrite = Promise.resolve();
      await uploadBlob(item.uploadUrl!, blob, item.contentType, sha256, (ratio) => {
        const progress = 25 + Math.round(ratio * 50);
        if (progress >= lastPersistedProgress + 5 || progress >= 75) {
          lastPersistedProgress = progress;
          progressWrite = progressWrite.then(() => updateFinding(id, { progress }).then(() => undefined));
        }
      });
      await progressWrite;
      item = await updateFinding(id, { progress: 80 }) ?? item;

      await completeFindingMediaUpload(item.inspectionId, {
        findingId: item.findingId!,
        classification: item.classification,
        objectPath: item.objectPath!,
        fileName: item.fileName,
        contentType: item.contentType,
        sizeBytes,
        sha256,
      });
      await updateFinding(id, {
        status: 'verified',
        progress: 100,
        lastError: undefined,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Upload failed. Retry when connectivity returns.';
      await updateFinding(id, {
        status: 'failed',
        lastError: message,
        localFileState: message.includes('photo is no longer available') ? 'missing' : 'available',
      });
      throw error;
    } finally {
      syncingIds.current.delete(id);
    }
  };

  const retryFinding = async (id: string) => {
    await syncFinding(id);
  };

  const replaceFindingPhoto = async (id: string, imageUri: string) => {
    const item = queueRef.current.find((queuedItem) => queuedItem.id === id);
    if (!item) throw new Error('Queued finding is no longer available.');
    if (item.localFileState !== 'missing' || item.status === 'uploading' || item.status === 'verified') {
      throw new Error('Only missing local photos can be replaced.');
    }
    const contentType = contentTypeForUri(imageUri);
    await updateFinding(id, {
      imageUri,
      capturedAt: new Date().toISOString(),
      fileName: fileNameForUri(imageUri, id, contentType),
      contentType,
      localFileState: 'available',
      sha256: undefined,
      sizeBytes: undefined,
      objectPath: undefined,
      uploadUrl: undefined,
      uploadExpiresAt: undefined,
      progress: item.findingId ? 20 : 0,
      status: 'local_only',
      lastError: undefined,
    });
  };

  const syncAll = async () => {
    const pending = queueRef.current.filter((item) =>
      item.status !== 'verified' && item.localFileState !== 'missing');
    await Promise.allSettled(pending.map((item) => syncFinding(item.id)));
  };

  const autoResumeEligibleItems = async () => {
    if (!userId || !queueLoaded.current || autoResumeInFlight.current) return;
    const now = Date.now();
    if (now - lastAutoResumeAt.current < AUTO_RESUME_COOLDOWN_MS) return;
    const eligibleIds = queueRef.current
      .filter((item) =>
        (item.status === 'local_only' || item.status === 'failed')
        && item.localFileState === 'available')
      .map((item) => item.id);
    if (eligibleIds.length === 0) return;
    autoResumeInFlight.current = true;
    lastAutoResumeAt.current = now;
    try {
      await Promise.allSettled(eligibleIds.map((id) => syncFinding(id)));
    } finally {
      autoResumeInFlight.current = false;
    }
  };

  useEffect(() => {
    if (!userId) return;
    const subscription = Network.addNetworkStateListener((state) => {
      const isUsable = hasUsableConnection(state);
      const wasUsable = usableConnection.current;
      usableConnection.current = isUsable;
      if (isUsable && wasUsable === false) {
        void autoResumeEligibleItems();
      }
    });
    return () => subscription.remove();
  }, [userId]);

  const removeFinding = async (id: string) => {
    const newQueue = queueRef.current.filter(item => item.id !== id);
    await saveQueue(newQueue);
  };

  const clearQueue = async () => {
    if (!userId) {
      queueRef.current = [];
      setQueue([]);
      return;
    }
    queueRef.current = [];
    setQueue([]);
    await AsyncStorage.removeItem(queueStorageKey(userId)!);
  };

  return (
    <QueueContext.Provider value={{ queue, addFinding, removeFinding, clearQueue, retryFinding, replaceFindingPhoto, syncAll }}>
      {children}
    </QueueContext.Provider>
  );
}

export function useQueue() {
  const context = useContext(QueueContext);
  if (!context) {
    throw new Error('useQueue must be used within a QueueProvider');
  }
  return context;
}
