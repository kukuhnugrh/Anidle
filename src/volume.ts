// One song volume for the whole site (OP/ED rounds, Database, admin review), kept in localStorage.
import { useSyncExternalStore } from 'react';

export interface Volume {
  /** 0–1. */
  level: number;
  muted: boolean;
}

const KEY = 'anidle:volume';
const DEFAULT: Volume = { level: 0.7, muted: false };

function load(): Volume {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object' && 'level' in v && typeof v.level === 'number' && v.level >= 0 && v.level <= 1)
      return { level: v.level, muted: 'muted' in v && v.muted === true };
  } catch {
    // Storage blocked or a broken value: fall back to the default.
  }
  return DEFAULT;
}

let current = load();
const listeners = new Set<() => void>();
/** Song players that never enter the page, so the document listeners in `syncPageAudio` can't see them. */
const detached = new Set<HTMLAudioElement>();

export function applyVolume(el: HTMLMediaElement) {
  if (el.volume !== current.level) el.volume = current.level;
  if (el.muted !== current.muted) el.muted = current.muted;
}

export function setVolume(next: Partial<Volume>) {
  const v = { ...current, ...next };
  if (v.level === current.level && v.muted === current.muted) return;
  current = v;
  try {
    localStorage.setItem(KEY, JSON.stringify(v));
  } catch {
    // Not persisted, still applied for this visit.
  }
  for (const el of detached) applyVolume(el);
  for (const el of document.querySelectorAll('audio')) applyVolume(el);
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const snapshot = () => current;
export const useVolume = () => useSyncExternalStore(subscribe, snapshot);

/** A detached song player on the shared volume; hand it back with `releaseAudio` when done. */
export function songAudio(src: string): HTMLAudioElement {
  const audio = new Audio(src);
  applyVolume(audio);
  detached.add(audio);
  return audio;
}

export function releaseAudio(audio: HTMLAudioElement) {
  audio.pause();
  detached.delete(audio);
}

/**
 * Puts every in-page <audio> on the shared volume as soon as it is added (before its own controls can be
 * touched), and turns a change made with a player's own volume/mute control into the shared volume.
 * Videos are left alone: clue clips play muted. Returns the cleanup.
 */
export function syncPageAudio(): () => void {
  const apply = (node: Node) => {
    if (node instanceof HTMLAudioElement) applyVolume(node);
    else if (node instanceof Element) for (const el of node.querySelectorAll('audio')) applyVolume(el);
  };
  apply(document.body);
  const observer = new MutationObserver((records) => {
    for (const r of records) r.addedNodes.forEach(apply);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  // Read at dispatch time, so the events our own applyVolume queues match `current` and do nothing.
  const onChange = (e: Event) => {
    if (e.target instanceof HTMLAudioElement) setVolume({ level: e.target.volume, muted: e.target.muted });
  };
  document.addEventListener('volumechange', onChange, true);
  return () => {
    observer.disconnect();
    document.removeEventListener('volumechange', onChange, true);
  };
}
